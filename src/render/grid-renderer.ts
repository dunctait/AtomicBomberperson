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

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Tile dimensions (matching original: 40x36 per tile)
  readonly tileWidth = 40;
  readonly tileHeight = 36;

  private tileSprites: HTMLCanvasElement[] | null = null;
  private crumbleSprites: HTMLCanvasElement[] | null = null;
  private fieldBackground: HTMLCanvasElement | null = null;
  private tileLoadStarted = false;
  private crumblingBricks: CrumblingBrick[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this.resize();
    this.loadTileSprites();
  }

  private loadTileSprites(): void {
    if (this.tileLoadStarted) return;
    this.tileLoadStarted = true;

    void assets.getAnimation('TILES0.ANI').then((anim) => {
      if (anim.frames.length >= 3) {
        this.tileSprites = anim.frames;
      }
    }).catch(() => {});

    void loadAnimationWithFallback('XBRICK0.ANI', 'BRICK.ANI').then((anim) => {
      if (anim) this.crumbleSprites = anim.frames;
    });

    // Load the FIELD0.PCX full-arena background image.
    // This is the original game's floor texture that tiles across the entire arena.
    void assets.getImage('FIELD0.PCX').then((canvas) => {
      if (canvas.width > 0 && canvas.height > 0) {
        this.fieldBackground = canvas;
      }
    }).catch(() => {});
  }

  /** Notify that bricks were destroyed — starts crumble animations */
  onBricksDestroyed(positions: { col: number; row: number }[]): void {
    for (const pos of positions) {
      this.crumblingBricks.push({ col: pos.col, row: pos.row, timer: 0 });
    }
  }

  /** Update crumble animations */
  update(dt: number): void {
    for (const brick of this.crumblingBricks) {
      brick.timer += dt;
    }
    this.crumblingBricks = this.crumblingBricks.filter(
      (b) => b.timer < BRICK_CRUMBLE_DURATION,
    );
  }

  /** Render the full grid using imported tile sprites when available */
  renderGrid(grid: GameGrid): void {
    const ctx = this.ctx;
    const tw = this.tileWidth;
    const th = this.tileHeight;

    // Draw the FIELD background first if available — this covers the entire
    // arena floor in one draw call, matching the original game's rendering.
    if (this.fieldBackground) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.fieldBackground,
        0, 0,
        GRID_COLS * tw,
        GRID_ROWS * th,
      );
      ctx.restore();
    }

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = col * tw;
        const y = row * th;
        const cell = grid.getCell(col, row);
        const type = cell?.type ?? CellContent.Empty;

        if (this.fieldBackground) {
          // Field background already drawn; only overlay bricks/walls
          this.renderOverlayTile(ctx, x, y, tw, th, type);
        } else if (this.tileSprites) {
          this.renderImportedTile(ctx, x, y, tw, th, type);
        } else {
          this.renderFallbackTile(ctx, x, y, tw, th, type);
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
      // transparent regions) composite correctly over the floor rather than
      // over whatever was drawn there during the grid pass.
      if (this.fieldBackground) {
        // Blit the matching region from the full-arena field background
        ctx.drawImage(this.fieldBackground, x, y, tw, th, x, y, tw, th);
      } else if (this.tileSprites && this.tileSprites.length > TILE_FRAME_EMPTY) {
        ctx.drawImage(this.tileSprites[TILE_FRAME_EMPTY], x, y, tw, th);
      }

      ctx.drawImage(frame, x, y, tw, th);
      ctx.restore();
    }
  }

  /**
   * Render only brick/solid wall overlay when a FIELD background is present.
   * Empty cells need no extra drawing since the background already covers them.
   */
  private renderOverlayTile(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tw: number, th: number,
    type: CellContent,
  ): void {
    if (type === CellContent.Brick) {
      if (this.tileSprites) {
        ctx.drawImage(this.tileSprites[TILE_FRAME_BRICK], x, y, tw, th);
      } else {
        this.renderFallbackTile(ctx, x, y, tw, th, type);
      }
    } else if (type === CellContent.Solid) {
      if (this.tileSprites) {
        ctx.drawImage(this.tileSprites[TILE_FRAME_SOLID], x, y, tw, th);
      } else {
        this.renderFallbackTile(ctx, x, y, tw, th, type);
      }
    }
    // Empty cells: nothing to draw — field background already visible
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

  private renderFallbackTile(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tw: number, th: number,
    type: CellContent,
  ): void {
    switch (type) {
      case CellContent.Solid:
        ctx.fillStyle = '#444';
        break;
      case CellContent.Brick:
        ctx.fillStyle = '#8B4513';
        break;
      default:
        ctx.fillStyle = '#1a3a1a';
        break;
    }
    ctx.fillRect(x, y, tw, th);

    ctx.strokeStyle = '#0f2f0f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);

    if (type === CellContent.Brick) {
      ctx.strokeStyle = '#6B3410';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + th / 3);
      ctx.lineTo(x + tw, y + th / 3);
      ctx.moveTo(x, y + (2 * th) / 3);
      ctx.lineTo(x + tw, y + (2 * th) / 3);
      ctx.moveTo(x + tw / 2, y);
      ctx.lineTo(x + tw / 2, y + th / 3);
      ctx.moveTo(x + tw / 4, y + th / 3);
      ctx.lineTo(x + tw / 4, y + (2 * th) / 3);
      ctx.moveTo(x + (3 * tw) / 4, y + th / 3);
      ctx.lineTo(x + (3 * tw) / 4, y + (2 * th) / 3);
      ctx.moveTo(x + tw / 2, y + (2 * th) / 3);
      ctx.lineTo(x + tw / 2, y + th);
      ctx.stroke();
    }

    if (type === CellContent.Solid) {
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 1, y + 1, tw - 2, 3);
      ctx.fillRect(x + 1, y + 1, 3, th - 2);
      ctx.fillStyle = '#333';
      ctx.fillRect(x + 1, y + th - 4, tw - 2, 3);
      ctx.fillRect(x + tw - 4, y + 1, 3, th - 2);
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
