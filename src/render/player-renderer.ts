import { assets } from '../assets/asset-registry';
import type { Player, Direction } from '../engine/player';

/** Player colors matching the original Atomic Bomberman */
export const PLAYER_COLORS: string[] = [
  '#FFFFFF', // Player 1: White
  '#FF0000', // Player 2: Red
  '#0000FF', // Player 3: Blue
  '#00CC00', // Player 4: Green
  '#FFFF00', // Player 5: Yellow
  '#00FFFF', // Player 6: Cyan
  '#FF8800', // Player 7: Orange
  '#AA00FF', // Player 8: Purple
  '#888888', // Player 9: Gray
  '#FF88CC', // Player 10: Pink
];

/**
 * Hue-rotate offsets (degrees) to shift the base green sprite to each player color.
 * Base sprite hue is ~120° (green).
 */
const PLAYER_HUE_SHIFTS: number[] = [
  -120,  // P1: White (desaturate handled separately)
   240,  // P2: Red (120° → 360°/0°)
   120,  // P3: Blue (120° → 240°)
     0,  // P4: Green (no shift)
   -60,  // P5: Yellow (120° → 60°)
    60,  // P6: Cyan (120° → 180°)
   -90,  // P7: Orange (120° → 30°)
   150,  // P8: Purple (120° → 270°)
  -120,  // P9: Gray (desaturate)
   -80,  // P10: Pink (120° → 330°-ish)
];

interface LoadedPlayerAnimation {
  frames: HTMLCanvasElement[];
  hotspots: { x: number; y: number }[];
}

interface ImportedPlayerSprites {
  stand: LoadedPlayerAnimation;
  walk: LoadedPlayerAnimation;
  shadow: LoadedPlayerAnimation | null;
}

const STAND_FRAME_BY_DIRECTION: Record<Exclude<Direction, 'none'>, number> = {
  right: 0,
  up: 1,
  down: 2,
  left: 3,
};
const WALK_GROUP_BY_DIRECTION: Record<Exclude<Direction, 'none'>, number> = {
  right: 0,
  up: 1,
  down: 2,
  left: 3,
};
const WALK_FRAMES_PER_DIRECTION = 15;
const WALK_CYCLE_FPS = 14;
const PLAYER_SPRITE_HEIGHT_TILES = 2;

export class PlayerRenderer {
  private assetLoadStarted = false;
  private importedSprites: ImportedPlayerSprites | null = null;

  constructor() {
    this.ensureImportedSprites();
  }

  /** Draw a player on the grid using fractional grid coordinates. */
  renderPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    tileW: number,
    tileH: number,
    elapsedTime = 0,
  ): void {
    this.ensureImportedSprites();

    const cx = player.x * tileW + tileW / 2;
    const cy = player.y * tileH + tileH / 2;
    const radius = Math.min(tileW, tileH) * 0.35;
    const color = PLAYER_COLORS[player.index] || '#FFF';

    // Only attempt imported sprites if they loaded with valid, non-empty frames
    try {
      if (this.importedSprites &&
          this.importedSprites.stand.frames.length >= 4 &&
          this.hasVisiblePixels(this.importedSprites.stand.frames[0]) &&
          this.renderImportedPlayer(ctx, player, cx, cy, tileH, elapsedTime)) {
        return;
      }
    } catch {
      // Fall through to circle rendering on any error
    }

    if (!player.alive) {
      // Dead player: gray circle with X eyes
      this.renderDeadPlayer(ctx, cx, cy, radius, player.index);
      return;
    }

    // Body circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Dark outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight (small white circle in upper-left for 3D effect)
    ctx.beginPath();
    ctx.arc(cx - radius * 0.25, cy - radius * 0.25, radius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();

    // Player number label
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.floor(radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(player.index + 1), cx, cy + 1);

    // Facing direction indicator (small triangle)
    this.renderFacingIndicator(ctx, cx, cy, radius, player.facing);
  }

  private ensureImportedSprites(): void {
    if (this.assetLoadStarted) return;
    this.assetLoadStarted = true;

    void Promise.all([
      assets.getAnimation('STAND.ANI'),
      assets.getAnimation('WALK.ANI'),
      assets.getAnimation('SHADOW.ANI').catch(() => null),
    ]).then(([stand, walk, shadow]) => {
      if (stand.frames.length === 0 || walk.frames.length === 0) {
        return;
      }

      this.importedSprites = { stand, walk, shadow };
    }).catch(() => {
      // Missing player assets are expected before the user imports original files.
    });
  }

  private renderImportedPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    cx: number,
    cy: number,
    tileH: number,
    elapsedTime: number,
  ): boolean {
    if (!this.importedSprites) {
      return false;
    }

    const frameData = player.moving
      ? this.selectWalkFrame(this.importedSprites.walk, player.facing, elapsedTime)
      : this.selectStandFrame(this.importedSprites.stand, player.facing);

    if (!frameData) {
      return false;
    }

    // Compute a uniform scale from the player sprite height
    const playerSpriteH = Math.max(1, frameData.frame.height);
    const targetHeight = tileH * PLAYER_SPRITE_HEIGHT_TILES;
    const spriteScale = targetHeight / playerSpriteH;

    // Draw shadow scaled to roughly one tile wide
    const shadowFrame = this.importedSprites.shadow?.frames[0];
    const shadowHotspot = this.importedSprites.shadow?.hotspots[0];
    if (shadowFrame && shadowHotspot) {
      const shadowScale = (tileH * 1.2) / Math.max(1, shadowFrame.width);
      this.drawScaledFrame(ctx, shadowFrame, shadowHotspot, cx, cy, shadowScale, false, 0.4);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (!player.alive) {
      ctx.filter = 'grayscale(1) brightness(0.7)';
      ctx.globalAlpha = 0.9;
    } else {
      const hueShift = PLAYER_HUE_SHIFTS[player.index] ?? 0;
      if (player.index === 0 || player.index === 8) {
        // White/Gray players: desaturate + brighten
        ctx.filter = `saturate(0) brightness(${player.index === 0 ? 1.6 : 1.0})`;
      } else if (hueShift !== 0) {
        ctx.filter = `hue-rotate(${hueShift}deg)`;
      }
    }
    this.drawScaledFrame(ctx, frameData.frame, frameData.hotspot, cx, cy, spriteScale, true);
    ctx.restore();

    if (!player.alive) {
      this.renderDeadEyes(ctx, cx, cy - tileH * 0.35, tileH * 0.12);
    }

    return true;
  }

  private drawScaledFrame(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
    hotspot: { x: number; y: number },
    cx: number,
    cy: number,
    scale: number,
    pixelated: boolean,
    alpha = 1.0,
  ): void {
    const drawWidth = frame.width * scale;
    const drawHeight = frame.height * scale;
    const drawX = cx - hotspot.x * scale;
    const drawY = cy - hotspot.y * scale;

    ctx.save();
    ctx.imageSmoothingEnabled = !pixelated;
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
  }

  private selectStandFrame(
    animation: LoadedPlayerAnimation,
    facing: Direction,
  ): { frame: HTMLCanvasElement; hotspot: { x: number; y: number } } | null {
    if (animation.frames.length === 0) {
      return null;
    }

    const direction = facing === 'none' ? 'down' : facing;
    const frameIndex = Math.min(
      animation.frames.length - 1,
      STAND_FRAME_BY_DIRECTION[direction],
    );

    return {
      frame: animation.frames[frameIndex],
      hotspot: animation.hotspots[frameIndex] ?? animation.hotspots[0] ?? { x: 0, y: 0 },
    };
  }

  private selectWalkFrame(
    animation: LoadedPlayerAnimation,
    facing: Direction,
    elapsedTime: number,
  ): { frame: HTMLCanvasElement; hotspot: { x: number; y: number } } | null {
    if (animation.frames.length === 0) {
      return null;
    }

    const direction = facing === 'none' ? 'down' : facing;
    const groupIndex = WALK_GROUP_BY_DIRECTION[direction];
    const offset = Math.floor(elapsedTime * WALK_CYCLE_FPS) % WALK_FRAMES_PER_DIRECTION;
    const frameIndex = Math.min(
      animation.frames.length - 1,
      groupIndex * WALK_FRAMES_PER_DIRECTION + offset,
    );

    return {
      frame: animation.frames[frameIndex],
      hotspot: animation.hotspots[frameIndex] ?? animation.hotspots[0] ?? { x: 0, y: 0 },
    };
  }

  /** Draw a small triangle on the edge of the player circle showing facing direction. */
  private renderFacingIndicator(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    facing: Direction,
  ): void {
    if (facing === 'none') return;

    const triSize = radius * 0.3;
    const dist = radius + triSize * 0.5;
    let angle = 0;

    switch (facing) {
      case 'up':    angle = -Math.PI / 2; break;
      case 'down':  angle =  Math.PI / 2; break;
      case 'left':  angle =  Math.PI;     break;
      case 'right': angle =  0;           break;
    }

    const tipX = cx + Math.cos(angle) * dist;
    const tipY = cy + Math.sin(angle) * dist;
    const baseAngle1 = angle + Math.PI * 0.75;
    const baseAngle2 = angle - Math.PI * 0.75;
    const b1x = tipX + Math.cos(baseAngle1) * triSize;
    const b1y = tipY + Math.sin(baseAngle1) * triSize;
    const b2x = tipX + Math.cos(baseAngle2) * triSize;
    const b2y = tipY + Math.sin(baseAngle2) * triSize;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(b1x, b1y);
    ctx.lineTo(b2x, b2y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Draw a dead player: grayed out with X eyes. */
  private renderDeadPlayer(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    index: number,
  ): void {
    // Gray body
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#666';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // X eyes
    const eyeSize = radius * 0.2;
    const eyeOffsetX = radius * 0.3;
    const eyeOffsetY = radius * 0.15;

    ctx.strokeStyle = '#C00';
    ctx.lineWidth = 2;

    // Left eye X
    ctx.beginPath();
    ctx.moveTo(cx - eyeOffsetX - eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx - eyeOffsetX + eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.moveTo(cx - eyeOffsetX + eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx - eyeOffsetX - eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.stroke();

    // Right eye X
    ctx.beginPath();
    ctx.moveTo(cx + eyeOffsetX - eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx + eyeOffsetX + eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.moveTo(cx + eyeOffsetX + eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx + eyeOffsetX - eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.stroke();

    // Player number (dimmed)
    ctx.fillStyle = '#999';
    ctx.font = `bold ${Math.floor(radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), cx, cy + radius * 0.35);
  }

  /** Check if an HTMLCanvasElement has any non-transparent pixels. Cached per canvas. */
  private visibleCache = new WeakMap<HTMLCanvasElement, boolean>();
  private hasVisiblePixels(canvas: HTMLCanvasElement): boolean {
    if (this.visibleCache.has(canvas)) return this.visibleCache.get(canvas)!;
    try {
      if (canvas.width === 0 || canvas.height === 0) {
        this.visibleCache.set(canvas, false);
        return false;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) { this.visibleCache.set(canvas, false); return false; }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          this.visibleCache.set(canvas, true);
          return true;
        }
      }
    } catch {
      // Cross-origin or other error
    }
    this.visibleCache.set(canvas, false);
    return false;
  }

  private renderDeadEyes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
  ): void {
    const eyeOffsetX = size * 1.5;

    ctx.strokeStyle = '#C00';
    ctx.lineWidth = Math.max(1.5, size * 0.3);

    for (const offset of [-eyeOffsetX, eyeOffsetX]) {
      ctx.beginPath();
      ctx.moveTo(cx + offset - size, cy - size);
      ctx.lineTo(cx + offset + size, cy + size);
      ctx.moveTo(cx + offset + size, cy - size);
      ctx.lineTo(cx + offset - size, cy + size);
      ctx.stroke();
    }
  }
}
