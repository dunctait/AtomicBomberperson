import type { Bomb, Explosion } from '../engine/bomb';
import { assets } from '../assets/asset-registry';

/**
 * EXPLODE.ANI / FLAME.ANI frame layout (5 animation frames each):
 *  0- 4: END   — right end cap
 *  5- 9: ENDU  — up end cap
 * 10-14: SQUARE — center (bomb origin)
 * 15-19: STREAM — horizontal stream
 * 20-24: STRMU  — vertical stream
 * 25-29: ENDD  — down end cap
 * 30-34: ENDL  — left end cap
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
const BOMB_ANIM_FPS = 8;

export class BombRenderer {
  private bombFrames: HTMLCanvasElement[] | null = null;
  private bombHotspots: { x: number; y: number }[] | null = null;
  private flameFrames: HTMLCanvasElement[] | null = null;
  private loadStarted = false;

  constructor() {
    this.loadSprites();
  }

  private loadSprites(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;

    void assets.getAnimation('BOMBS.ANI').then((anim) => {
      if (anim.frames.length > 0) {
        this.bombFrames = anim.frames;
        this.bombHotspots = anim.hotspots;
      }
    }).catch(() => {});

    // Try EXPLODE.ANI first; fall back to FLAME.ANI if it is not available.
    // Both files share the same 7-group × 5-frame layout defined by the
    // FLAME_* constants above.
    void assets.getAnimation('EXPLODE.ANI').then((anim) => {
      if (anim.frames.length >= 35) {
        this.flameFrames = anim.frames;
      }
    }).catch(() => {
      // EXPLODE.ANI not found — try FLAME.ANI as fallback sprite source
      void assets.getAnimation('FLAME.ANI').then((anim) => {
        if (anim.frames.length >= 35) {
          this.flameFrames = anim.frames;
        }
      }).catch(() => {});
    });
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

      const cx = bomb.col * tileW + tileW / 2;
      const cy = bomb.row * tileH + tileH / 2;

      if (this.bombFrames && this.bombHotspots) {
        this.renderImportedBomb(ctx, cx, cy, tileW, tileH, time);
      } else {
        this.renderFallbackBomb(ctx, cx, cy, tileW, tileH, time);
      }
    }
  }

  private renderImportedBomb(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    tileW: number, tileH: number,
    time: number,
  ): void {
    const frames = this.bombFrames!;
    const hotspots = this.bombHotspots!;
    const frameIndex = Math.floor(time * BOMB_ANIM_FPS) % frames.length;
    const frame = frames[frameIndex];
    const hotspot = hotspots[frameIndex] ?? hotspots[0];

    // Scale bomb to fit within a tile
    const scale = tileH / Math.max(1, frame.height);
    const drawW = frame.width * scale;
    const drawH = frame.height * scale;
    const drawX = cx - hotspot.x * scale;
    const drawY = cy - hotspot.y * scale;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  private renderFallbackBomb(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    tileW: number, tileH: number,
    time: number,
  ): void {
    const pulseSpeed = 4 + (2.0) * 6;
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
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
    ctx.strokeStyle = '#000';
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
    x: number, y: number,
    tileW: number, tileH: number,
    exp: Explosion,
  ): void {
    const frames = this.flameFrames!;

    // Pick the base frame index based on direction and end/stream
    let baseIndex: number;
    if (exp.direction === 'center') {
      baseIndex = FLAME_CENTER;
    } else if (exp.isEnd) {
      switch (exp.direction) {
        case 'right': baseIndex = FLAME_RIGHT_END; break;
        case 'up':    baseIndex = FLAME_UP_END; break;
        case 'down':  baseIndex = FLAME_DOWN_END; break;
        case 'left':  baseIndex = FLAME_LEFT_END; break;
      }
    } else {
      // Stream (middle) — horizontal or vertical
      baseIndex = (exp.direction === 'left' || exp.direction === 'right')
        ? FLAME_H_STREAM
        : FLAME_V_STREAM;
    }

    // Pick animation frame based on timer progress (0.5s → 0.0s)
    const progress = 1 - (exp.timer / EXPLOSION_DURATION);
    const animFrame = Math.min(FLAME_FRAMES_PER_TYPE - 1, Math.floor(progress * FLAME_FRAMES_PER_TYPE));
    const frameIndex = Math.min(frames.length - 1, baseIndex + animFrame);

    const frame = frames[frameIndex];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, x, y, tileW, tileH);
    ctx.restore();
  }

  private renderFallbackFlame(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tileW: number, tileH: number,
    exp: Explosion,
  ): void {
    const intensity = exp.timer / 0.5;

    if (exp.direction === 'center') {
      const gradient = ctx.createRadialGradient(
        x + tileW / 2, y + tileH / 2, 0,
        x + tileW / 2, y + tileH / 2, tileW * 0.5,
      );
      gradient.addColorStop(0, `rgba(255, 255, 200, ${intensity})`);
      gradient.addColorStop(0.5, `rgba(255, 200, 50, ${intensity})`);
      gradient.addColorStop(1, `rgba(255, 80, 0, ${intensity * 0.8})`);
      ctx.fillStyle = gradient;
    } else {
      const gradient = ctx.createRadialGradient(
        x + tileW / 2, y + tileH / 2, 0,
        x + tileW / 2, y + tileH / 2, tileW * 0.5,
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
