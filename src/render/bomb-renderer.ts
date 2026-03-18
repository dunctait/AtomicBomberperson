import type { Bomb, Explosion, BombArc } from '../engine/bomb';
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
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export class BombRenderer {
  /** Per-player tinted bomb frames: tintedBombFrames[playerIndex][frameIndex] */
  private tintedBombFrames: HTMLCanvasElement[][] | null = null;
  private flameFrames: HTMLCanvasElement[] | null = null;
  /** Per-player tinted flame frames: tintedFlameFrames[playerIndex][frameIndex] */
  private tintedFlameFrames: HTMLCanvasElement[][] | null = null;
  readonly loaded: Promise<void>;

  constructor() {
    this.loaded = this.loadSprites().catch(() => {});
  }

  private async loadSprites(): Promise<void> {
    const [bombAnim, flameAnim] = await Promise.all([
      loadAnimationWithFallback('BOMB.ANI', 'BOMBS.ANI', 1),
      loadAnimationWithFallback('EXPLODE.ANI', 'FLAME.ANI', 35),
    ]);

    if (bombAnim) {
      this.generateTintedFrames(bombAnim.frames);
    }
    if (flameAnim) {
      this.flameFrames = flameAnim.frames;
      this.generateTintedFlameFrames(flameAnim.frames);
    }
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

  /** Pre-generate per-player color-tinted flame frame sets */
  private generateTintedFlameFrames(frames: HTMLCanvasElement[]): void {
    this.tintedFlameFrames = [];
    for (let p = 0; p < MAX_PLAYERS; p++) {
      const color = PLAYER_COLORS[p] ?? '#53d8fb';
      const [r, g, b] = parseHexColor(color);
      this.tintedFlameFrames.push(frames.map((frame) => tintFrame(frame, r, g, b)));
    }
  }

  private getBombAnimationSpeed(bombTimer: number): number {
    const fuseProgress = 1 - Math.max(0, Math.min(1, bombTimer / BOMB_FUSE_DURATION));
    return BOMB_ANIM_FPS_BASE + (BOMB_ANIM_FPS_MAX - BOMB_ANIM_FPS_BASE) * fuseProgress;
  }

  private getExplosionBaseFrame(exp: Explosion): number {
    if (exp.direction === 'center') return FLAME_CENTER;

    if (!exp.isEnd) {
      return exp.direction === 'left' || exp.direction === 'right'
        ? FLAME_H_STREAM
        : FLAME_V_STREAM;
    }

    switch (exp.direction) {
      case 'right': return FLAME_RIGHT_END;
      case 'up':    return FLAME_UP_END;
      case 'down':  return FLAME_DOWN_END;
      case 'left':  return FLAME_LEFT_END;
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
    if (!this.tintedBombFrames) return;

    for (const bomb of bombs) {
      if (bomb.exploded) continue;

      let cx: number;
      let cy: number;
      let arcHeight = 0;

      if (bomb.arc && bomb.arc.elapsed < bomb.arc.duration) {
        // In-flight: interpolate position along arc
        const t = bomb.arc.elapsed / bomb.arc.duration;
        cx = (bomb.arc.startCol + (bomb.arc.endCol - bomb.arc.startCol) * t) * tileW + tileW / 2;
        cy = (bomb.arc.startRow + (bomb.arc.endRow - bomb.arc.startRow) * t) * tileH + tileH / 2;
        // Parabolic arc height: peaks at t=0.5
        const dist = Math.abs(bomb.arc.endCol - bomb.arc.startCol) + Math.abs(bomb.arc.endRow - bomb.arc.startRow);
        arcHeight = 4 * t * (1 - t) * Math.max(tileH, dist * tileH * 0.5);
      } else {
        cx = (bomb.col + bomb.slideX) * tileW + tileW / 2;
        cy = (bomb.row + bomb.slideY) * tileH + tileH / 2;
      }

      // Pick the pre-tinted frame set for this player
      const playerFrames = this.tintedBombFrames[
        Math.min(bomb.owner, this.tintedBombFrames.length - 1)
      ];

      const fuseElapsed = Math.max(0, BOMB_FUSE_DURATION - bomb.timer);
      const fps = this.getBombAnimationSpeed(bomb.timer);
      const frameIndex = Math.floor(fuseElapsed * fps) % playerFrames.length;
      const frame = playerFrames[frameIndex];
      const scale = Math.min(tileW, tileH) / Math.max(1, Math.max(frame.width, frame.height));
      const drawW = frame.width * scale;
      const drawH = frame.height * scale;
      const drawX = cx - drawW / 2;
      const drawY = cy - drawH / 2 - arcHeight;

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      // Draw a shadow on the ground when in flight
      if (arcHeight > 0) {
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.ellipse(cx, cy + drawH * 0.3, drawW * 0.4, drawH * 0.15, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.drawImage(frame, drawX, drawY, drawW, drawH);
      ctx.restore();
    }
  }

  /** Draw all explosions */
  renderExplosions(
    ctx: CanvasRenderingContext2D,
    explosions: Explosion[],
    tileW: number,
    tileH: number,
  ): void {
    if (!this.flameFrames) return;

    for (const exp of explosions) {
      const x = exp.col * tileW;
      const y = exp.row * tileH;

      const playerIndex = Math.min(exp.owner, (this.tintedFlameFrames?.length ?? 1) - 1);
      const frames = this.tintedFlameFrames?.[playerIndex] ?? this.flameFrames;
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
  }
}
