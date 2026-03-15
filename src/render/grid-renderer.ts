import { type GameGrid, GRID_COLS, GRID_ROWS, CellContent } from '../engine/game-grid';

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Tile dimensions (matching original: 40x36 per tile)
  readonly tileWidth = 40;
  readonly tileHeight = 36;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this.resize();
  }

  /** Render the full grid. Uses colored rectangles as placeholder until we load real tile sprites */
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

        // Fill cell background
        switch (type) {
          case CellContent.Solid:
            ctx.fillStyle = '#444';
            break;
          case CellContent.Brick:
            ctx.fillStyle = '#8B4513';
            break;
          case CellContent.Bomb:
            ctx.fillStyle = '#1a3a1a';
            break;
          case CellContent.Powerup:
            ctx.fillStyle = '#1a3a1a';
            break;
          default:
            ctx.fillStyle = '#1a3a1a';
            break;
        }
        ctx.fillRect(x, y, tw, th);

        // Grid lines: subtle darker lines between cells
        ctx.strokeStyle = '#0f2f0f';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);

        // Draw brick pattern for brick cells
        if (type === CellContent.Brick) {
          ctx.strokeStyle = '#6B3410';
          ctx.lineWidth = 1;
          // Horizontal mortar lines
          ctx.beginPath();
          ctx.moveTo(x, y + th / 3);
          ctx.lineTo(x + tw, y + th / 3);
          ctx.moveTo(x, y + (2 * th) / 3);
          ctx.lineTo(x + tw, y + (2 * th) / 3);
          // Vertical mortar lines (offset pattern)
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

        // Draw solid wall shading
        if (type === CellContent.Solid) {
          // Top highlight
          ctx.fillStyle = '#555';
          ctx.fillRect(x + 1, y + 1, tw - 2, 3);
          // Left highlight
          ctx.fillRect(x + 1, y + 1, 3, th - 2);
          // Bottom shadow
          ctx.fillStyle = '#333';
          ctx.fillRect(x + 1, y + th - 4, tw - 2, 3);
          // Right shadow
          ctx.fillRect(x + tw - 4, y + 1, 3, th - 2);
        }
      }
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
