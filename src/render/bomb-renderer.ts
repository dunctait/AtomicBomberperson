import type { Bomb, Explosion } from '../engine/bomb';

export class BombRenderer {
  /** Draw all bombs (pulsing black circles) */
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

      // Pulse: scale between 0.7 and 1.0 based on remaining timer
      // Faster pulsing as timer runs down
      const pulseSpeed = 4 + (2.0 - bomb.timer) * 6; // speeds up near detonation
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

      // Fuse spark (flickering small yellow dot on top)
      const sparkX = cx + radius * 0.3;
      const sparkY = cy - radius * 0.8;
      const sparkSize = 2 + Math.random() * 2;
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, sparkSize, 0, Math.PI * 2);
      ctx.fillStyle = pulsePhase > 0 ? '#FFD700' : '#FF4500';
      ctx.fill();
    }
  }

  /** Draw all explosions (orange/red/yellow flame rectangles) */
  renderExplosions(
    ctx: CanvasRenderingContext2D,
    explosions: Explosion[],
    tileW: number,
    tileH: number,
  ): void {
    for (const exp of explosions) {
      const x = exp.col * tileW;
      const y = exp.row * tileH;

      // Intensity based on remaining timer (brighter at start)
      const intensity = exp.timer / 0.5;

      if (exp.direction === 'center') {
        // Center: bright yellow/white
        const gradient = ctx.createRadialGradient(
          x + tileW / 2, y + tileH / 2, 0,
          x + tileW / 2, y + tileH / 2, tileW * 0.5,
        );
        gradient.addColorStop(0, `rgba(255, 255, 200, ${intensity})`);
        gradient.addColorStop(0.5, `rgba(255, 200, 50, ${intensity})`);
        gradient.addColorStop(1, `rgba(255, 80, 0, ${intensity * 0.8})`);
        ctx.fillStyle = gradient;
      } else {
        // Directional flames: orange to red
        const gradient = ctx.createRadialGradient(
          x + tileW / 2, y + tileH / 2, 0,
          x + tileW / 2, y + tileH / 2, tileW * 0.5,
        );
        gradient.addColorStop(0, `rgba(255, 220, 50, ${intensity})`);
        gradient.addColorStop(0.6, `rgba(255, 120, 0, ${intensity * 0.9})`);
        gradient.addColorStop(1, `rgba(200, 30, 0, ${intensity * 0.7})`);
        ctx.fillStyle = gradient;
      }

      // Fill the cell with a slight margin for visual effect
      const margin = 2;
      ctx.fillRect(x + margin, y + margin, tileW - margin * 2, tileH - margin * 2);

      // Add a bright core line along the explosion direction
      ctx.fillStyle = `rgba(255, 255, 180, ${intensity * 0.6})`;
      if (exp.direction === 'left' || exp.direction === 'right' || exp.direction === 'center') {
        ctx.fillRect(x + margin, y + tileH * 0.3, tileW - margin * 2, tileH * 0.4);
      }
      if (exp.direction === 'up' || exp.direction === 'down' || exp.direction === 'center') {
        ctx.fillRect(x + tileW * 0.3, y + margin, tileW * 0.4, tileH - margin * 2);
      }
    }
  }
}
