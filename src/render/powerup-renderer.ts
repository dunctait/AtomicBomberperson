import { type Powerup, PowerupType } from '../engine/powerup';

interface PowerupVisual {
  color: string;
  label: string;
}

const POWERUP_VISUALS: Record<number, PowerupVisual> = {
  [PowerupType.ExtraBomb]: { color: '#2266FF', label: 'B' },
  [PowerupType.LongerFlame]: { color: '#FF2222', label: 'F' },
  [PowerupType.Speed]: { color: '#FFDD00', label: 'S' },
  [PowerupType.GoldFlame]: { color: '#FFD700', label: 'G' },
  [PowerupType.Kick]: { color: '#22CC22', label: 'K' },
  [PowerupType.Punch]: { color: '#FF8800', label: 'P' },
  [PowerupType.Grab]: { color: '#00CCCC', label: 'R' },
  [PowerupType.Trigger]: { color: '#9922CC', label: 'T' },
  [PowerupType.Jelly]: { color: '#FF88BB', label: 'J' },
  [PowerupType.Spooger]: { color: '#CC00CC', label: 'X' },
  [PowerupType.Disease]: { color: '#888888', label: 'D' },
  [PowerupType.SuperDisease]: { color: '#881111', label: '!' },
  [PowerupType.Random]: { color: '#AAAAAA', label: '?' },
};

export class PowerupRenderer {
  /** Draw all revealed (visible) powerups */
  renderPowerups(
    ctx: CanvasRenderingContext2D,
    powerups: Powerup[],
    tileW: number,
    tileH: number,
  ): void {
    for (const powerup of powerups) {
      if (!powerup.revealed) continue;

      const visual = POWERUP_VISUALS[powerup.type];
      if (!visual) continue;

      const cx = powerup.col * tileW + tileW / 2;
      const cy = powerup.row * tileH + tileH / 2;
      const radius = Math.min(tileW, tileH) * 0.3;

      // Filled circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = visual.color;
      ctx.fill();

      // Outline
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label letter
      ctx.fillStyle = '#FFF';
      ctx.font = `bold ${Math.floor(radius * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(visual.label, cx, cy + 1);
    }
  }
}
