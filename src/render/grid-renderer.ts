import { type GameGrid, GRID_COLS, GRID_ROWS, CellContent } from '../engine/game-grid';
import { assets } from '../assets/asset-registry';
import { loadAnimationWithFallback } from './render-utils';

/** TILES ANI frame indices: 0 = empty floor, 1 = brick, 2 = solid wall */
const TILE_FRAME_EMPTY = 0;
const TILE_FRAME_BRICK = 1;
const TILE_FRAME_SOLID = 2;

/**
 * Duration of the brick destruction animation in seconds.
 * Slightly longer than 0.5s gives a smoother feel across all 9 frames.
 */
const BRICK_CRUMBLE_DURATION = 0.6;

interface CrumblingBrick {
  col: number;
  row: number;
  timer: number; // counts up from 0 to BRICK_CRUMBLE_DURATION
}

/** Duration of the sudden-death wall slam flash in seconds. */
const WALL_FLASH_DURATION = 0.35;

interface WallFlash {
  col: number;
  row: number;
  timer: number; // counts up from 0 to WALL_FLASH_DURATION
}

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Tile dimensions (matching original: 40x36 per tile)
  readonly tileWidth = 40;
  readonly tileHeight = 36;

  private tileSprites: HTMLCanvasElement[] | null = null;
  private crumbleSprites: HTMLCanvasElement[] | null = null;
  private fieldBackground: HTMLCanvasElement | null = null;
  private crumblingBricks: CrumblingBrick[] = [];
  private wallFlashes: WallFlash[] = [];
  readonly loaded: Promise<void>;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this.resize();
    this.loaded = this.loadTileSprites().catch(() => {});
  }

  private async loadTileSprites(): Promise<void> {
    const [tilesAnim, crumbleAnim, fieldCanvas] = await Promise.all([
      assets.getAnimation('TILES0.ANI').catch(() => null),
      loadAnimationWithFallback('XBRICK0.ANI', 'BRICK.ANI'),
      assets.getImage('FIELD0.PCX').catch(() => null),
    ]);

    if (tilesAnim && tilesAnim.frames.length >= 3) {
      this.tileSprites = tilesAnim.frames;
    }
    if (crumbleAnim) {
      this.crumbleSprites = crumbleAnim.frames;
    }
    if (fieldCanvas && fieldCanvas.width > 0 && fieldCanvas.height > 0) {
      this.fieldBackground = fieldCanvas;
    }
  }

  /** Notify that bricks were destroyed — starts crumble animations */
  onBricksDestroyed(positions: { col: number; row: number }[]): void {
    for (const pos of positions) {
      this.crumblingBricks.push({ col: pos.col, row: pos.row, timer: 0 });
    }
  }

  /** Notify that sudden-death walls were placed — starts slam flash animations */
  onSuddenDeathWalls(positions: { col: number; row: number }[]): void {
    for (const pos of positions) {
      this.wallFlashes.push({ col: pos.col, row: pos.row, timer: 0 });
    }
  }

  /** Update crumble and wall-flash animations */
  update(dt: number): void {
    for (const brick of this.crumblingBricks) {
      brick.timer += dt;
    }
    this.crumblingBricks = this.crumblingBricks.filter(
      (b) => b.timer < BRICK_CRUMBLE_DURATION,
    );

    for (const flash of this.wallFlashes) {
      flash.timer += dt;
    }
    this.wallFlashes = this.wallFlashes.filter((f) => f.timer < WALL_FLASH_DURATION);
  }

  /** Render the full grid using imported tile sprites */
  renderGrid(grid: GameGrid): void {
    if (!this.tileSprites) return;

    const ctx = this.ctx;
    const tw = this.tileWidth;
    const th = this.tileHeight;

    // Draw the FIELD background if available — covers the arena floor in one draw call.
    if (this.fieldBackground) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.fieldBackground, 0, 0, GRID_COLS * tw, GRID_ROWS * th);
      ctx.restore();
    }

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = col * tw;
        const y = row * th;
        const cell = grid.getCell(col, row);
        const type = cell?.type ?? CellContent.Empty;

        if (this.fieldBackground) {
          this.renderOverlayTile(ctx, x, y, tw, th, type);
        } else {
          this.renderImportedTile(ctx, x, y, tw, th, type);
        }

        const conveyorDirection = grid.getConveyorDirection(col, row);
        if (conveyorDirection) {
          this.renderConveyorOverlay(ctx, x, y, tw, th, conveyorDirection);
        }

        const warp = grid.getWarp(col, row);
        if (warp) {
          this.renderWarpOverlay(ctx, x, y, tw, th, warp.index);
        }
      }
    }

    // Render crumbling brick animations on top
    this.renderCrumblingBricks(ctx, tw, th);

    // Render sudden-death wall slam flash on top of everything
    this.renderWallFlashes(ctx, tw, th);
  }

  private renderCrumblingBricks(
    ctx: CanvasRenderingContext2D,
    tw: number,
    th: number,
  ): void {
    if (!this.crumbleSprites) return;

    const frameCount = this.crumbleSprites.length;

    for (const brick of this.crumblingBricks) {
      const rawProgress = brick.timer / BRICK_CRUMBLE_DURATION;
      // Apply slight ease-in so the animation accelerates as the brick falls apart
      const progress = rawProgress * rawProgress;
      const frameIndex = Math.min(frameCount - 1, Math.floor(progress * frameCount));
      const frame = this.crumbleSprites[frameIndex];
      const x = brick.col * tw;
      const y = brick.row * th;

      ctx.save();
      ctx.imageSmoothingEnabled = false;

      // Draw the empty floor underneath so the crumble sprites (which have
      // transparent regions) composite correctly over the floor.
      if (this.fieldBackground) {
        ctx.drawImage(this.fieldBackground, x, y, tw, th, x, y, tw, th);
      } else if (this.tileSprites && this.tileSprites.length > TILE_FRAME_EMPTY) {
        ctx.drawImage(this.tileSprites[TILE_FRAME_EMPTY], x, y, tw, th);
      }

      ctx.drawImage(frame, x, y, tw, th);
      ctx.restore();
    }
  }

  private renderWallFlashes(
    ctx: CanvasRenderingContext2D,
    tw: number,
    th: number,
  ): void {
    if (this.wallFlashes.length === 0) return;

    ctx.save();
    for (const flash of this.wallFlashes) {
      // Progress goes 0→1 over WALL_FLASH_DURATION.
      // Alpha peaks at 0 (i.e. at t=0 it's fully white) and fades quickly.
      const progress = flash.timer / WALL_FLASH_DURATION;
      // Use an exponential curve so the flash is very bright at first and fades fast.
      const alpha = Math.max(0, 1 - progress * progress * progress * 1.5);
      if (alpha <= 0) continue;

      const x = flash.col * tw;
      const y = flash.row * th;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, tw, th);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Render only brick/solid wall overlay when a FIELD background is present.
   * Empty cells get the floor tile drawn to cover dark border textures.
   */
  private renderOverlayTile(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tw: number, th: number,
    type: CellContent,
  ): void {
    if (type === CellContent.Brick) {
      ctx.drawImage(this.tileSprites![TILE_FRAME_BRICK], x, y, tw, th);
    } else if (type === CellContent.Solid) {
      ctx.drawImage(this.tileSprites![TILE_FRAME_SOLID], x, y, tw, th);
    } else if (type === CellContent.Empty) {
      ctx.drawImage(this.tileSprites![TILE_FRAME_EMPTY], x, y, tw, th);
    }
  }

  private renderImportedTile(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tw: number, th: number,
    type: CellContent,
  ): void {
    const sprites = this.tileSprites!;

    // Always draw the floor tile first
    ctx.drawImage(sprites[TILE_FRAME_EMPTY], x, y, tw, th);

    // Overlay brick or solid wall on top
    if (type === CellContent.Brick) {
      ctx.drawImage(sprites[TILE_FRAME_BRICK], x, y, tw, th);
    } else if (type === CellContent.Solid) {
      ctx.drawImage(sprites[TILE_FRAME_SOLID], x, y, tw, th);
    }
  }

  private renderConveyorOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tw: number,
    th: number,
    direction: 'up' | 'down' | 'left' | 'right',
  ): void {
    const centerX = x + tw / 2;
    const centerY = y + th / 2;
    const shaft = Math.min(tw, th) * 0.22;
    const head = Math.min(tw, th) * 0.16;

    ctx.save();
    ctx.strokeStyle = '#63d7ff';
    ctx.fillStyle = '#63d7ff';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.beginPath();

    if (direction === 'left' || direction === 'right') {
      const tipX = direction === 'left' ? centerX - shaft - head : centerX + shaft + head;
      const tailX = direction === 'left' ? centerX + shaft : centerX - shaft;
      ctx.moveTo(tailX, centerY);
      ctx.lineTo(tipX, centerY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tipX, centerY);
      ctx.lineTo(tipX + (direction === 'left' ? head : -head), centerY - head);
      ctx.lineTo(tipX + (direction === 'left' ? head : -head), centerY + head);
      ctx.closePath();
      ctx.fill();
    } else {
      const tipY = direction === 'up' ? centerY - shaft - head : centerY + shaft + head;
      const tailY = direction === 'up' ? centerY + shaft : centerY - shaft;
      ctx.moveTo(centerX, tailY);
      ctx.lineTo(centerX, tipY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX, tipY);
      ctx.lineTo(centerX - head, tipY + (direction === 'up' ? head : -head));
      ctx.lineTo(centerX + head, tipY + (direction === 'up' ? head : -head));
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private renderWarpOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    tw: number,
    th: number,
    warpIndex: number,
  ): void {
    const centerX = x + tw / 2;
    const centerY = y + th / 2;
    const radius = Math.min(tw, th) * 0.22;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ff78c7';
    ctx.fillStyle = 'rgba(255, 120, 199, 0.18)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffe6f6';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(warpIndex + 1), centerX, centerY);
    ctx.restore();
  }

  pixelToGrid(px: number, py: number): { col: number; row: number } {
    return {
      col: Math.floor(px / this.tileWidth),
      row: Math.floor(py / this.tileHeight),
    };
  }

  gridToPixel(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this.tileWidth,
      y: row * this.tileHeight,
    };
  }

  resize(): void {
    this.canvas.width = GRID_COLS * this.tileWidth;   // 600
    this.canvas.height = GRID_ROWS * this.tileHeight;  // 396
  }
}
