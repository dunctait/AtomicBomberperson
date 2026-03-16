/**
 * Lightweight particle effects system for explosions and brick destruction.
 * Particles are simple colored shapes (rectangles/circles) — no sprite loading.
 */

interface Particle {
  x: number;       // position in tile coordinates
  y: number;
  vx: number;      // velocity in tiles/sec
  vy: number;
  lifetime: number; // remaining seconds
  maxLife: number;  // initial lifetime (for fade calculations)
  color: string;
  size: number;     // radius in pixels
  shape: 'rect' | 'circle';
}

interface ParticleBurstConfig {
  count: number;
  colors: string[];
  speed: { min: number; max: number };
  lifetime: { min: number; max: number; maxLife: number };
  size: { min: number; max: number };
  positionJitter: number;
  shape: Particle['shape'];
  upwardBias?: { min: number; max: number };
}

const GRAVITY = 4.0; // tiles/sec^2, applied to debris particles

/** Random float in [min, max) */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class ParticleSystem {
  private particles: Particle[] = [];

  private emitBurst(col: number, row: number, config: ParticleBurstConfig): void {
    for (let i = 0; i < config.count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(config.speed.min, config.speed.max);
      const upwardBias = config.upwardBias ? rand(config.upwardBias.min, config.upwardBias.max) : 0;

      this.particles.push({
        x: col + 0.5 + rand(-config.positionJitter, config.positionJitter),
        y: row + 0.5 + rand(-config.positionJitter, config.positionJitter),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - upwardBias,
        lifetime: rand(config.lifetime.min, config.lifetime.max),
        maxLife: config.lifetime.maxLife,
        color: pick(config.colors),
        size: rand(config.size.min, config.size.max),
        shape: config.shape,
      });
    }
  }

  /**
   * Emit debris particles for a destroyed brick.
   * 4-8 small brown/orange rectangles that arc outward with gravity.
   */
  emitBrickDebris(col: number, row: number): void {
    this.emitBurst(col, row, {
      count: 4 + Math.floor(Math.random() * 5),
      colors: ['#8B4513', '#A0522D', '#CD853F', '#D2691E', '#B8860B'],
      speed: { min: 1.5, max: 4.0 },
      lifetime: { min: 0.4, max: 0.8, maxLife: 0.8 },
      size: { min: 1.5, max: 3.0 },
      positionJitter: 0.2,
      shape: 'rect',
      upwardBias: { min: 1.0, max: 3.0 },
    });
  }

  /**
   * Emit spark particles for an explosion.
   * 6-10 bright orange/yellow circles that scatter rapidly and fade.
   */
  emitExplosionSparks(col: number, row: number): void {
    this.emitBurst(col, row, {
      count: 6 + Math.floor(Math.random() * 5),
      colors: ['#FF4500', '#FF6600', '#FFA500', '#FFD700', '#FFFF00', '#FF8C00'],
      speed: { min: 3.0, max: 7.0 },
      lifetime: { min: 0.2, max: 0.5, maxLife: 0.5 },
      size: { min: 1.0, max: 2.5 },
      positionJitter: 0.15,
      shape: 'circle',
    });
  }

  /** Advance all particles by dt seconds, removing dead ones. */
  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.lifetime -= dt;

      // Apply gravity to debris (rect) particles
      if (p.shape === 'rect') {
        p.vy += GRAVITY * dt;
      }

      // Dampen spark velocities
      if (p.shape === 'circle') {
        p.vx *= 1 - 3.0 * dt;
        p.vy *= 1 - 3.0 * dt;
      }

      if (p.lifetime <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /** Draw all particles onto the canvas. */
  render(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    tileW: number,
    tileH: number,
  ): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, p.lifetime / p.maxLife);
      const px = offsetX + p.x * tileW;
      const py = offsetY + p.y * tileH;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(px - p.size, py - p.size, p.size * 2, p.size * 2);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Remove all particles (used on screen exit). */
  clear(): void {
    this.particles.length = 0;
  }

  /** Current particle count (useful for debugging). */
  get count(): number {
    return this.particles.length;
  }
}
