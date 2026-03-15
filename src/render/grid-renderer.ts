import { type GameGrid, GRID_COLS, GRID_ROWS, CellContent } from '../engine/game-grid';
import { assets } from '../assets/asset-registry';

/** TILES ANI frame indices: 0 = empty floor, 1 = brick, 2 = solid wall */
const TILE_FRAME_EMPTY = 0;
const TILE_FRAME_BRICK = 1;
const TILE_FRAME_SOLID = 2;

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Tile dimensions (matching original: 40x36 per tile)
  readonly tileWidth = 40;
  readonly tileHeight = 36;

  private tileSprites: HTMLCanvasElement[] | null = null;
  private tileLoadStarted = false;

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
    }).catch(() => {
      // Tile assets not available — fall back to colored rectangles
    });
  }

  /** Render the full grid using imported tile sprites when available */
  renderGrid(grid: GameGrid): void {
    const ctx = this.ctx;
    const tw = this.tileWidth;
    const th = this.tileHeight;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = col * tw;
        const y = row * th;
        const cell = grid.getCell(col, row);
        const type = cell?.type ?? CellContent.Empty;

        if (this.tileSprites) {
          this.renderImportedTile(ctx, x, y, tw, th, type);
        } else {
          this.renderFallbackTile(ctx, x, y, tw, th, type);
        }
      }
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

  private renderFallbackTile(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    tw: number, th: number,
    type: CellContent,
  ): void {
    // Fill cell background
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

    // Grid lines
    ctx.strokeStyle = '#0f2f0f';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);

    // Brick pattern
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

    // Solid wall shading
    if (type === CellContent.Solid) {
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 1, y + 1, tw - 2, 3);
      ctx.fillRect(x + 1, y + 1, 3, th - 2);
      ctx.fillStyle = '#333';
      ctx.fillRect(x + 1, y + th - 4, tw - 2, 3);
      ctx.fillRect(x + tw - 4, y + 1, 3, th - 2);
    }
  }

  /** Convert pixel position to grid coordinates */
  pixelToGrid(px: number, py: number): { col: number; row: number } {
    return {
      col: Math.floor(px / this.tileWidth),
      row: Math.floor(py / this.tileHeight),
    };
  }

  /** Convert grid coordinates to pixel position (top-left of cell) */
  gridToPixel(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this.tileWidth,
      y: row * this.tileHeight,
    };
  }

  /** Resize canvas to fit the grid */
  resize(): void {
    this.canvas.width = GRID_COLS * this.tileWidth;   // 600
    this.canvas.height = GRID_ROWS * this.tileHeight;  // 396
  }
}
