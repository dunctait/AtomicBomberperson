import { type Powerup, PowerupType } from '../engine/powerup';
import { assets } from '../assets/asset-registry';

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
  readonly loaded: Promise<void>;

  constructor() {
    this.loaded = this.loadSprites().catch(() => {});
  }

  private async loadSprites(): Promise<void> {
    const entries = Object.entries(POWERUP_PCX);
    const results = await Promise.all(
      entries.map(([typeStr, filename]) =>
        assets.getImage(filename)
          .then((canvas) => ({ type: Number(typeStr), canvas }))
          .catch(() => null),
      ),
    );
    for (const result of results) {
      if (result) this.sprites.set(result.type, result.canvas);
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
      if (!sprite) continue;

      // Draw the PCX sprite centered in the tile
      const scale = Math.min(tileW / sprite.width, tileH / sprite.height);
      const drawW = sprite.width * scale;
      const drawH = sprite.height * scale;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }
}
