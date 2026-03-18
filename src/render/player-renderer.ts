import { assets } from '../assets/asset-registry';
import type { Player, Direction } from '../engine/player';
import { DEATH_ANIM_DURATION } from '../engine/player';

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

const DIRECTION_INDEX: Record<Exclude<Direction, 'none'>, number> = {
  right: 0,
  up: 1,
  down: 2,
  left: 3,
};
const WALK_FRAMES_PER_DIRECTION = 15;
const WALK_CYCLE_FPS = 14;
const PLAYER_SPRITE_HEIGHT_TILES = 2;

export class PlayerRenderer {
  private importedSprites: ImportedPlayerSprites | null = null;
  readonly loaded: Promise<void>;

  constructor() {
    this.loaded = this.loadSprites().catch(() => {});
  }

  private async loadSprites(): Promise<void> {
    const [stand, walk, shadow] = await Promise.all([
      assets.getAnimation('STAND.ANI'),
      assets.getAnimation('WALK.ANI'),
      assets.getAnimation('SHADOW.ANI').catch(() => null),
    ]);

    if (stand.frames.length > 0 && walk.frames.length > 0) {
      this.importedSprites = { stand, walk, shadow };
    }
  }

  /** Draw a player on the grid using fractional grid coordinates. */
  renderPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    tileW: number,
    tileH: number,
    elapsedTime = 0,
  ): void {
    // Fully dead (animation finished) — don't render at all
    if (!player.alive && player.deathTimer <= 0) return;
    if (!this.importedSprites) return;

    const cx = player.x * tileW + tileW / 2;
    const cy = player.y * tileH + tileH / 2;

    // Death animation progress: 1.0 = just died, 0.0 = animation complete
    const deathProgress = player.isDeathAnimating()
      ? player.deathTimer / DEATH_ANIM_DURATION
      : 0;

    // During death animation, apply transform effects
    if (player.isDeathAnimating()) {
      // Flash/blink: rapid toggling. Skip rendering on "off" frames during first half
      const blinkRate = 12; // blinks per second
      const blinkPhase = Math.sin((DEATH_ANIM_DURATION - player.deathTimer) * blinkRate * Math.PI * 2);
      if (deathProgress > 0.4 && blinkPhase < -0.3) return;

      ctx.save();
      // Fade out: opacity goes from 1.0 to 0.0 over the animation
      ctx.globalAlpha = Math.max(0, deathProgress);

      // Spin and shrink: rotate and scale down
      const rotation = (1 - deathProgress) * Math.PI * 2; // full rotation over duration
      const scale = 0.3 + 0.7 * deathProgress; // shrink from 100% to 30%
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    this.renderImportedPlayer(ctx, player, cx, cy, tileH, elapsedTime);

    if (player.isDeathAnimating()) ctx.restore();
  }

  private renderImportedPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    cx: number,
    cy: number,
    tileH: number,
    elapsedTime: number,
  ): void {
    if (!this.importedSprites) return;

    const frameData = player.moving
      ? this.selectWalkFrame(this.importedSprites.walk, player.facing, elapsedTime)
      : this.selectStandFrame(this.importedSprites.stand, player.facing);

    if (!frameData) return;

    // Compute a uniform scale from the player sprite height
    const playerSpriteH = Math.max(1, frameData.frame.height);
    const targetHeight = tileH * PLAYER_SPRITE_HEIGHT_TILES;
    const spriteScale = targetHeight / playerSpriteH;

    // Draw shadow scaled to roughly one tile wide
    const shadowFrame = this.importedSprites.shadow?.frames[0];
    const shadowHotspot = this.importedSprites.shadow?.hotspots[0];
    if (shadowFrame && shadowHotspot) {
      const shadowScale = (tileH * 1.2) / Math.max(1, shadowFrame.width);
      this.drawScaledFrame(ctx, shadowFrame, shadowHotspot, cx, cy, shadowScale, false, 0.1);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (!player.alive) {
      // Death animation or static dead state — grayscale the sprite
      ctx.filter = 'grayscale(1) brightness(0.7)';
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
    if (animation.frames.length === 0) return null;

    const direction = facing === 'none' ? 'down' : facing;
    const frameIndex = Math.min(
      animation.frames.length - 1,
      DIRECTION_INDEX[direction],
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
    if (animation.frames.length === 0) return null;

    const direction = facing === 'none' ? 'down' : facing;
    const groupIndex = DIRECTION_INDEX[direction];
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
