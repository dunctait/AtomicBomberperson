import { GameGrid, GRID_COLS, GRID_ROWS, CellContent } from './game-grid';
import type { Player } from './player';
import type { BombManager } from './bomb';
import type { PowerupManager } from './powerup';

/**
 * Sudden Death: when the round timer expires, indestructible bricks fall from the
 * edges of the map inward in a clockwise spiral pattern, one cell at a time.
 * Each falling brick destroys whatever occupies that cell (players, bombs, powerups,
 * existing bricks) and replaces it with a solid wall.
 */

/** Pre-compute the clockwise spiral order of all interior grid cells (excluding border). */
function computeSpiralOrder(): Array<{ col: number; row: number }> {
  const order: Array<{ col: number; row: number }> = [];
  let top = 0;
  let bottom = GRID_ROWS - 1;
  let left = 0;
  let right = GRID_COLS - 1;

  while (top <= bottom && left <= right) {
    // Top row, left to right
    for (let c = left; c <= right; c++) {
      order.push({ col: c, row: top });
    }
    top++;

    // Right column, top to bottom
    for (let r = top; r <= bottom; r++) {
      order.push({ col: right, row: r });
    }
    right--;

    // Bottom row, right to left
    if (top <= bottom) {
      for (let c = right; c >= left; c--) {
        order.push({ col: c, row: bottom });
      }
      bottom--;
    }

    // Left column, bottom to top
    if (left <= right) {
      for (let r = bottom; r >= top; r--) {
        order.push({ col: left, row: r });
      }
      left++;
    }
  }

  return order;
}

const SPIRAL_ORDER = computeSpiralOrder();

/** Interval between successive brick drops during sudden death (seconds). */
const DROP_INTERVAL = 0.15;

export class SuddenDeath {
  active = false;
  private dropIndex = 0;
  private dropTimer = 0;

  /** Cells that were placed this frame (for rendering flash effects, etc.). */
  droppedThisFrame: Array<{ col: number; row: number }> = [];

  /** Activate sudden death. */
  start(): void {
    this.active = true;
    this.dropIndex = 0;
    this.dropTimer = 0;
  }

  /** Reset state for a new round. */
  reset(): void {
    this.active = false;
    this.dropIndex = 0;
    this.dropTimer = 0;
    this.droppedThisFrame = [];
  }

  /**
   * Advance the sudden death simulation.
   * Returns true if a brick was dropped this tick.
   */
  update(
    dt: number,
    gameGrid: GameGrid,
    players: Player[],
    bombManager: BombManager,
    powerupManager: PowerupManager,
  ): boolean {
    this.droppedThisFrame = [];
    if (!this.active) return false;
    if (this.dropIndex >= SPIRAL_ORDER.length) return false;

    this.dropTimer += dt;
    let dropped = false;

    while (this.dropTimer >= DROP_INTERVAL && this.dropIndex < SPIRAL_ORDER.length) {
      this.dropTimer -= DROP_INTERVAL;
      const { col, row } = SPIRAL_ORDER[this.dropIndex];
      this.dropIndex++;

      // Kill any player standing on this cell
      for (const p of players) {
        if (!p.alive) continue;
        const pos = p.getGridPos();
        if (pos.col === col && pos.row === row) {
          p.die();
        }
      }

      // Remove any bomb on this cell
      bombManager.removeAt(col, row);

      // Destroy any powerup on this cell
      powerupManager.destroyAt(col, row);

      // Place solid wall
      gameGrid.setCell(col, row, CellContent.Solid);
      this.droppedThisFrame.push({ col, row });
      dropped = true;
    }

    return dropped;
  }

  /** Check whether the spiral has completed (all cells filled). */
  get completed(): boolean {
    return this.dropIndex >= SPIRAL_ORDER.length;
  }
}
