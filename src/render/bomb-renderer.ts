import type { Bomb, Explosion } from '../engine/bomb';
import { loadAnimationWithFallback } from './render-utils';
import { PLAYER_COLORS } from './player-renderer';

/**
 * EXPLODE.ANI / FLAME.ANI frame layout (5 animation frames each):
 *  0- 4: END   - right end cap
 *  5- 9: ENDU  - up end cap
 * 10-14: SQUARE - center (bomb origin)
 * 15-19: STREAM - horizontal stream
 * 20-24: STRMU  - vertical stream
 * 25-29: ENDD  - down end cap
 * 30-34: ENDL  - left end cap
 */
const FLAME_FRAMES_PER_TYPE = 5;
const FLAME_RIGHT_END = 0;
const FLAME_UP_END = 5;
const FLAME_CENTER = 10;
const FLAME_H_STREAM = 15;
const FLAME_V_STREAM = 20;
const FLAME_DOWN_END = 25;
const FLAME_LEFT_END = 30;

const EXPLOSION_DURATION = 0.5;

/** Base animation speed for bomb sprites (frames per second) when fuse is full. */
const BOMB_ANIM_FPS_BASE = 6;
/** Maximum speed near detonation. Kept subtle to avoid "fast ticking" feel. */
const BOMB_ANIM_FPS_MAX = 8;
/** Full fuse duration in seconds; must match BOMB_FUSE in bomb.ts. */
const BOMB_FUSE_DURATION = 2.0;

/** Max players we pre-tint bomb frames for */
const MAX_PLAYERS = 10;

/** Parse a hex color string like '#FF00CC' into [r, g, b] 0-255 */
function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/**
 * Recolor a sprite frame using fpc_atomic's LoadColorTabledImage algorithm.
 * Only pixels where green is the dominant channel get recolored to the player's
 * color. Shadows, outlines, and highlights are left untouched.
 *
 * playerR/G/B are in 0-255 range; the algorithm normalises internally.
 */
function tintFrame(
  source: HTMLCanvasElement,
  playerR: number,
  playerG: number,
  playerB: number,
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Convert 0-255 player color to 0-100 scale to match fpc_atomic's PlayerColor range
  const pr = (playerR / 255) * 100;
  const pg = (playerG / 255) * 100;
  const pb = (playerB / 255) * 100;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;

    const sr = data[i];
    const sg = data[i + 1];
    const sb = data[i + 2];

    // Only recolor pixels where green is the dominant channel
    if (sg > sr && sg > sb) {
      const n = ((sr + sb) / 2) | 0;   // base/neutral color
      const k = sg - n;                  // extra green = colorable amount

      let nr = n + ((k * pr) / 100) | 0;
      let ng = n + ((k * pg) / 100) | 0;
      let nb = n + ((k * pb) / 100) | 0;

      // Normalize if any channel overflows
      const m = Math.max(nr, ng, nb);
      if (m > 255) {
        nr = ((nr * 255) / m) | 0;
        ng = ((ng * 255) / m) | 0;
        nb = ((nb * 255) / m) | 0;
      }

      data[i]     = Math.min(255, nr);
      data[i + 1] = Math.min(255, ng);
      data[i + 2] = Math.min(255, nb);
    }
    // Non-green-dominant pixels are left completely untouched
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export class BombRenderer {
  /** Original untinted bomb frames */
  private bombFrames: HTMLCanvasElement[] | null = null;
  /** Per-player tinted bomb frames: tintedBombFrames[playerIndex][frameIndex] */
  private tintedBombFrames: HTMLCanvasElement[][] | null = null;
  private flameFrames: HTMLCanvasElement[] | null = null;
  private loadStarted = false;

  constructor() {
    this.loadSprites();
  }

  private loadSprites(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;

    // Try BOMB.ANI first; fall back to BOMBS.ANI if it is not available.
    void loadAnimationWithFallback('BOMB.ANI', 'BOMBS.ANI', 1).then((anim) => {
      if (anim) {
        this.bombFrames = anim.frames;
        this.generateTintedFrames(anim.frames);
      }
    });

    void loadAnimationWithFallback('EXPLODE.ANI', 'FLAME.ANI', 35).then((anim) => {
      if (anim) this.flameFrames = anim.frames;
    });
  }

  /** Pre-generate per-player color-tinted bomb frame sets */
  private generateTintedFrames(frames: HTMLCanvasElement[]): void {
    this.tintedBombFrames = [];
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const color = PLAYER_COLORS[p] ?? '#53d8fb';
      const [r, g, b] = parseHexColor(color);
      this.tintedBombFrames.push(frames.map((frame) => tintFrame(frame, r, g, b)));
    }
  }

  private getFuseProgress(bombTimer: number): number {
    return 1 - Math.max(0, Math.min(1, bombTimer / BOMB_FUSE_DURATION));
  }

  private getBombAnimationSpeed(bombTimer: number): number {
    const fuseProgress = this.getFuseProgress(bombTimer);
    // Very subtle fuse ramp: mostly steady, slightly faster near detonation.
    return BOMB_ANIM_FPS_BASE + (BOMB_ANIM_FPS_MAX - BOMB_ANIM_FPS_BASE) * fuseProgress;
  }

  private getExplosionBaseFrame(exp: Explosion): number {
    if (exp.direction === 'center') {
      return FLAME_CENTER;
    }

    if (!exp.isEnd) {
      return exp.direction === 'left' || exp.direction === 'right'
        ? FLAME_H_STREAM
        : FLAME_V_STREAM;
    }

    switch (exp.direction) {
      case 'right':
        return FLAME_RIGHT_END;
      case 'up':
        return FLAME_UP_END;
      case 'down':
        return FLAME_DOWN_END;
      case 'left':
        return FLAME_LEFT_END;
    }
  }

  /** Draw all bombs */
  renderBombs(
    ctx: CanvasRenderingContext2D,
    bombs: Bomb[],
    tileW: number,
    tileH: number,
    time: number,
  ): void {
    for (const bomb of bombs) {
      if (bomb.exploded) continue;

      const cx = (bomb.col + bomb.slideX) * tileW + tileW / 2;
      const cy = (bomb.row + bomb.slideY) * tileH + tileH / 2;

      if (this.tintedBombFrames) {
        this.renderImportedBomb(ctx, cx, cy, tileW, tileH, time, bomb.timer, bomb.owner);
      } else {
        this.renderFallbackBomb(ctx, cx, cy, tileW, tileH, time, bomb.timer, bomb.owner);
      }
    }
  }

  private renderImportedBomb(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
    time: number,
    bombTimer: number,
    owner: number,
  ): void {
    // Pick the pre-tinted frame set for this player
    const playerFrames = this.tintedBombFrames![
      Math.min(owner, this.tintedBombFrames!.length - 1)
    ];

    const fuseElapsed = Math.max(0, BOMB_FUSE_DURATION - bombTimer);
    const fps = this.getBombAnimationSpeed(bombTimer);
    const frameIndex = Math.floor(fuseElapsed * fps) % playerFrames.length;
    const frame = playerFrames[frameIndex];
    // Scale bomb sprite to fit within one tile while preserving aspect ratio.
    const scale = Math.min(tileW, tileH) / Math.max(1, Math.max(frame.width, frame.height));
    const drawW = frame.width * scale;
    const drawH = frame.height * scale;
    // Use geometric centering for bomb placement so bomb and explosion origins align.
    const drawX = cx - drawW / 2;
    const drawY = cy - drawH / 2;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  /**
   * Fallback bomb rendering using canvas primitives.
   * Pulse speed increases as the fuse burns down to mirror the imported-sprite behavior.
   */
  private renderFallbackBomb(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tileW: number,
    tileH: number,
    time: number,
    bombTimer: number,
    owner: number,
  ): void {
    const pulseSpeed = this.getBombAnimationSpeed(bombTimer);
    const pulsePhase = Math.sin(time * pulseSpeed);
    const scale = 0.7 + 0.3 * (0.5 + 0.5 * pulsePhase);
    const radius = Math.min(tileW, tileH) * 0.35 * scale;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, radius * 0.9, radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Bomb body
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    const ownerColor = PLAYER_COLORS[owner] ?? '#53d8fb';
    ctx.fillStyle = ownerColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.arc(cx - radius * 0.25, cy - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();

    // Fuse spark
    const sparkX = cx + radius * 0.3;
    const sparkY = cy - radius * 0.8;
    const sparkSize = 2 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
    ctx.fillStyle = pulsePhase > 0 ? '#FFD700' : '#FF4500';
    ctx.fill();
  }

  /** Draw all explosions */
  renderExplosions(
    ctx: CanvasRenderingContext2D,
    explosions: Explosion[],
    tileW: number,
    tileH: number,
  ): void {
    for (const exp of explosions) {
      const x = exp.col * tileW;
      const y = exp.row * tileH;

      if (this.flameFrames) {
        this.renderImportedFlame(ctx, x, y, tileW, tileH, exp);
      } else {
        this.renderFallbackFlame(ctx, x, y, tileW, tileH, exp);
      }
    }
  }

  private renderImportedFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tileW: number,
    tileH: number,
    exp: Explosion,
  ): void {
    const frames = this.flameFrames!;
    const baseIndex = this.getExplosionBaseFrame(exp);

    const progress = 1 - (exp.timer / EXPLOSION_DURATION);
    const animFrame = Math.min(
      FLAME_FRAMES_PER_TYPE - 1,
      Math.floor(progress * FLAME_FRAMES_PER_TYPE),
    );
    const frameIndex = Math.min(frames.length - 1, baseIndex + animFrame);

    const frame = frames[frameIndex];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x, y, tileW, tileH);
    ctx.restore();
  }

  private renderFallbackFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tileW: number,
    tileH: number,
    exp: Explosion,
  ): void {
    const intensity = exp.timer / EXPLOSION_DURATION;

    if (exp.direction === 'center') {
      const gradient = ctx.createRadialGradient(
        x + tileW / 2,
        y + tileH / 2,
        0,
        x + tileW / 2,
        y + tileH / 2,
        tileW * 0.5,
      );
      gradient.addColorStop(0, `rgba(255, 255, 200, ${intensity})`);
      gradient.addColorStop(0.5, `rgba(255, 200, 50, ${intensity})`);
      gradient.addColorStop(1, `rgba(255, 80, 0, ${intensity * 0.8})`);
      ctx.fillStyle = gradient;
    } else {
      const gradient = ctx.createRadialGradient(
        x + tileW / 2,
        y + tileH / 2,
        0,
        x + tileW / 2,
        y + tileH / 2,
        tileW * 0.5,
      );
      gradient.addColorStop(0, `rgba(255, 220, 50, ${intensity})`);
      gradient.addColorStop(0.6, `rgba(255, 120, 0, ${intensity * 0.9})`);
      gradient.addColorStop(1, `rgba(200, 30, 0, ${intensity * 0.7})`);
      ctx.fillStyle = gradient;
    }

    const margin = 2;
    ctx.fillRect(x + margin, y + margin, tileW - margin * 2, tileH - margin * 2);

    ctx.fillStyle = `rgba(255, 255, 180, ${intensity * 0.6})`;
    if (exp.direction === 'left' || exp.direction === 'right' || exp.direction === 'center') {
      ctx.fillRect(x + margin, y + tileH * 0.3, tileW - margin * 2, tileH * 0.4);
    }
    if (exp.direction === 'up' || exp.direction === 'down' || exp.direction === 'center') {
      ctx.fillRect(x + tileW * 0.3, y + margin, tileW * 0.4, tileH - margin * 2);
    }
  }
}
