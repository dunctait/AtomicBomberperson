import { type Powerup, PowerupType } from '../engine/powerup';
import { assets } from '../assets/asset-registry';

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

/** Maps PowerupType to its PCX filename */
const POWERUP_PCX: Record<number, string> = {
  [PowerupType.ExtraBomb]: 'POWBOMB.PCX',
  [PowerupType.LongerFlame]: 'POWFLAME.PCX',
  [PowerupType.Disease]: 'POWDISEA.PCX',
  [PowerupType.Kick]: 'POWKICK.PCX',
  [PowerupType.Speed]: 'POWSKATE.PCX',
  [PowerupType.Punch]: 'POWPUNCH.PCX',
  [PowerupType.Grab]: 'POWGRAB.PCX',
  [PowerupType.Spooger]: 'POWSPOOG.PCX',
  [PowerupType.GoldFlame]: 'POWGOLD.PCX',
  [PowerupType.Trigger]: 'POWTRIG.PCX',
  [PowerupType.Jelly]: 'POWJELLY.PCX',
  [PowerupType.SuperDisease]: 'POWEBOLA.PCX',
  [PowerupType.Random]: 'POWRAND.PCX',
};

export class PowerupRenderer {
  private sprites = new Map<number, HTMLCanvasElement>();
  private loadStarted = false;

  constructor() {
    this.loadSprites();
  }

  private loadSprites(): void {
    if (this.loadStarted) return;
    this.loadStarted = true;

    for (const [typeStr, filename] of Object.entries(POWERUP_PCX)) {
      const typeNum = Number(typeStr);
      void assets.getImage(filename).then((canvas) => {
        this.sprites.set(typeNum, canvas);
      }).catch(() => {});
    }
  }

  /** Draw all revealed (visible) powerups */
  renderPowerups(
    ctx: CanvasRenderingContext2D,
    powerups: Powerup[],
    tileW: number,
    tileH: number,
  ): void {
    for (const powerup of powerups) {
      if (!powerup.revealed) continue;

      const cx = powerup.col * tileW + tileW / 2;
      const cy = powerup.row * tileH + tileH / 2;

      const sprite = this.sprites.get(powerup.type);
      if (sprite) {
        // Draw the PCX sprite centered in the tile
        const scale = Math.min(tileW / sprite.width, tileH / sprite.height);
        const drawW = sprite.width * scale;
        const drawH = sprite.height * scale;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
        ctx.restore();
      } else {
        this.renderFallback(ctx, cx, cy, tileW, tileH, powerup.type);
      }
    }
  }

  private renderFallback(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    tileW: number, tileH: number,
    type: PowerupType,
  ): void {
    const visual = POWERUP_VISUALS[type];
    if (!visual) return;

    const radius = Math.min(tileW, tileH) * 0.3;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = visual.color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${Math.floor(radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(visual.label, cx, cy + 1);
  }
}
