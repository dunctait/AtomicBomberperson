import {
  TileType,
  type ConveyorDirection,
  type ParsedScheme,
  type SpawnPoint,
  type WarpTile,
} from '../assets/parsers/sch-parser';

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
  spawnClearedBrickCount: number;
  conveyors: (ConveyorDirection | null)[][];
  warps: (WarpTile | null)[][];
  warpTargets: Map<number, WarpTile>;

  constructor(scheme: ParsedScheme) {
    // Initialize all cells to empty
    this.cells = [];
    this.spawnClearedBrickCount = 0;
    this.conveyors = [];
    this.warps = [];
    this.warpTargets = new Map();
    for (let r = 0; r < GRID_ROWS; r++) {
      this.cells.push([]);
      this.conveyors.push([]);
      this.warps.push([]);
      for (let c = 0; c < GRID_COLS; c++) {
        this.cells[r].push({ type: CellContent.Empty });
        this.conveyors[r].push(null);
        this.warps[r].push(null);
      }
    }
    this.initFromScheme(scheme);
  }

  /** Initialize the grid from a scheme, randomly placing bricks based on density */
  initFromScheme(scheme: ParsedScheme): void {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        this.conveyors[r][c] = null;
        this.warps[r][c] = null;
      }
    }
    this.warpTargets.clear();

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

    for (const conveyor of scheme.conveyors) {
      if (conveyor.y >= 0 && conveyor.y < GRID_ROWS && conveyor.x >= 0 && conveyor.x < GRID_COLS) {
        this.conveyors[conveyor.y][conveyor.x] = conveyor.direction;
      }
    }

    for (const warp of scheme.warps) {
      if (warp.y >= 0 && warp.y < GRID_ROWS && warp.x >= 0 && warp.x < GRID_COLS) {
        this.warps[warp.y][warp.x] = warp;
        this.warpTargets.set(warp.index, warp);
      }
    }

    // Enforce border walls — the perimeter of the grid is always solid
    // regardless of what the scheme defines, matching original game behavior.
    for (let c = 0; c < GRID_COLS; c++) {
      this.cells[0][c].type = CellContent.Solid;
      this.cells[GRID_ROWS - 1][c].type = CellContent.Solid;
    }
    for (let r = 0; r < GRID_ROWS; r++) {
      this.cells[r][0].type = CellContent.Solid;
      this.cells[r][GRID_COLS - 1].type = CellContent.Solid;
    }

    // Clear spawn areas after placing bricks
    this.clearSpawnAreas(scheme.spawns);
  }

  /** Clear spaces around spawn points (3x3 area must be empty for hitbox clearance) */
  clearSpawnAreas(spawns: SpawnPoint[]): void {
    this.spawnClearedBrickCount = 0;
    for (const spawn of spawns) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const r = spawn.y + dr;
          const c = spawn.x + dc;
          if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
            const cell = this.cells[r][c];
            // Only clear bricks, never solid walls (pillars are permanent)
            if (cell.type === CellContent.Brick) {
              this.spawnClearedBrickCount += 1;
              cell.type = CellContent.Empty;
            }
          }
        }
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

  getConveyorDirection(col: number, row: number): ConveyorDirection | null {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return null;
    }
    return this.conveyors[row][col];
  }

  getWarp(col: number, row: number): WarpTile | null {
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return null;
    }
    return this.warps[row][col];
  }

  getWarpDestination(warp: WarpTile): WarpTile | null {
    return this.warpTargets.get(warp.target) ?? null;
  }

}
