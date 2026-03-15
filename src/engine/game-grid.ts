import { TileType, type ParsedScheme, type SpawnPoint } from '../assets/parsers/sch-parser';

export const GRID_COLS = 15;
export const GRID_ROWS = 11;

export enum CellContent {
  Empty = 0,
  Solid = 1,    // Indestructible wall
  Brick = 2,    // Destructible brick
  Bomb = 3,
  Powerup = 4,
}

export interface Cell {
  type: CellContent;
  // Future: powerup type, bomb data, etc.
}

export class GameGrid {
  cells: Cell[][];  // [row][col]

  constructor(scheme: ParsedScheme) {
    // Initialize all cells to empty
    this.cells = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      this.cells.push([]);
      for (let c = 0; c < GRID_COLS; c++) {
        this.cells[r].push({ type: CellContent.Empty });
      }
    }
    this.initFromScheme(scheme);
  }

  /** Initialize the grid from a scheme, randomly placing bricks based on density */
  initFromScheme(scheme: ParsedScheme): void {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tile = scheme.grid[r]?.[c] ?? TileType.Empty;
        switch (tile) {
          case TileType.Solid:
            this.cells[r][c].type = CellContent.Solid;
            break;
          case TileType.Brick:
            // Place brick based on density (0-100 percentage)
            if (Math.random() * 100 < scheme.brickDensity) {
              this.cells[r][c].type = CellContent.Brick;
            } else {
              this.cells[r][c].type = CellContent.Empty;
            }
            break;
          default:
            this.cells[r][c].type = CellContent.Empty;
            break;
        }
      }
    }

    // Clear spawn areas after placing bricks
    this.clearSpawnAreas(scheme.spawns);
  }

  /** Clear spaces around spawn points (3x3 area must be empty) */
  clearSpawnAreas(spawns: SpawnPoint[]): void {
    for (const spawn of spawns) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = spawn.y + dr;
          const c = spawn.x + dc;
          if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
            const cell = this.cells[r][c];
            // Only clear bricks, not solid walls
            if (cell.type === CellContent.Brick) {
              cell.type = CellContent.Empty;
            }
          }
        }
      }
      // Always ensure the spawn cell itself is empty
      if (spawn.y >= 0 && spawn.y < GRID_ROWS && spawn.x >= 0 && spawn.x < GRID_COLS) {
        this.cells[spawn.y][spawn.x].type = CellContent.Empty;
      }
    }
  }

  /** Get cell at grid position */
  getCell(col: number, row: number): Cell | null {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return null;
    }
    return this.cells[row][col];
  }

  /** Set cell content */
  setCell(col: number, row: number, type: CellContent): void {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return;
    }
    this.cells[row][col].type = type;
  }

  /** Check if a position is walkable */
  isWalkable(col: number, row: number): boolean {
    const cell = this.getCell(col, row);
    if (!cell) return false;
    return cell.type === CellContent.Empty;
  }
}
