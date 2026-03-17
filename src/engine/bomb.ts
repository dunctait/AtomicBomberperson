import { GameGrid, CellContent, GRID_COLS, GRID_ROWS } from './game-grid';

type BombSlideMode = 'kick' | 'conveyor';

export interface Bomb {
  col: number;
  row: number;
  owner: number;       // player index
  placedAt: number;
  jelly: boolean;
  timer: number;       // seconds remaining (starts at 2.0)
  range: number;       // explosion range in tiles
  exploded: boolean;
  /** Grace period: the player who placed the bomb can walk out of it */
  graceOwner: number | null;
  /** Kick sliding state */
  sliding: boolean;
  slideDirection: 'up' | 'down' | 'left' | 'right' | null;
  slideSpeed: number;  // tiles per second
  slideMode: BombSlideMode | null;
  /** Fractional position within the current slide (pixel-accurate movement) */
  slideX: number;      // fractional col offset from bomb.col
  slideY: number;      // fractional row offset from bomb.row
  lastWarpIndex: number | null;
}

export interface Explosion {
  col: number;
  row: number;
  timer: number;       // seconds remaining for the visual (starts at 0.5)
  direction: 'center' | 'up' | 'down' | 'left' | 'right';
  isEnd: boolean;      // true if this is the tip of the flame
  owner: number;       // player index who owns the bomb that caused this
}

export interface BombEvents {
  bricksDestroyed: { col: number; row: number; owner: number }[];
  explosionPositions: { col: number; row: number }[];
}

const BOMB_FUSE = 2.0;
const EXPLOSION_DURATION = 0.5;
const CONVEYOR_BOMB_SPEED = 1.4;

export function dirToDeltas(dir: 'up' | 'down' | 'left' | 'right'): { ddx: number; ddy: number } {
  return {
    ddx: dir === 'left' ? -1 : dir === 'right' ? 1 : 0,
    ddy: dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0,
  };
}

function reverseDirection(dir: 'up' | 'down' | 'left' | 'right'): 'up' | 'down' | 'left' | 'right' {
  return dir === 'left'
    ? 'right'
    : dir === 'right'
      ? 'left'
      : dir === 'up'
        ? 'down'
        : 'up';
}

const DIRECTIONS: { dx: number; dy: number; name: Explosion['direction'] }[] = [
  { dx: 0, dy: -1, name: 'up' },
  { dx: 0, dy: 1, name: 'down' },
  { dx: -1, dy: 0, name: 'left' },
  { dx: 1, dy: 0, name: 'right' },
];

export class BombManager {
  bombs: Bomb[] = [];
  explosions: Explosion[] = [];
  private placementSequence = 0;

  private getLiveBombAt(col: number, row: number): Bomb | undefined {
    return this.bombs.find((bomb) => !bomb.exploded && bomb.col === col && bomb.row === row);
  }

  private getOldestLiveBomb(owner: number): Bomb | null {
    let oldestBomb: Bomb | null = null;

    for (const bomb of this.bombs) {
      if (bomb.exploded || bomb.owner !== owner) {
        continue;
      }
      if (!oldestBomb || bomb.placedAt < oldestBomb.placedAt) {
        oldestBomb = bomb;
      }
    }

    return oldestBomb;
  }

  /** Place a bomb at grid position. Returns false if cell already has a bomb */
  placeBomb(col: number, row: number, owner: number, range: number, jelly = false): boolean {
    if (this.hasBomb(col, row)) {
      return false;
    }

    this.bombs.push({
      col,
      row,
      owner,
      placedAt: this.placementSequence++,
      jelly,
      timer: BOMB_FUSE,
      range,
      exploded: false,
      graceOwner: owner,
      sliding: false,
      slideDirection: null,
      slideSpeed: 6,
      slideMode: null,
      slideX: 0,
      slideY: 0,
      lastWarpIndex: null,
    });

    return true;
  }

  /** Detonate the oldest live bomb owned by the given player. */
  triggerOldestBomb(owner: number, grid: GameGrid): BombEvents | null {
    const oldestBomb = this.getOldestLiveBomb(owner);

    if (!oldestBomb) {
      return null;
    }

    const events: BombEvents = {
      bricksDestroyed: [],
      explosionPositions: [],
    };
    this.detonate(oldestBomb, grid, events);
    this.bombs = this.bombs.filter((bomb) => !bomb.exploded);
    return events;
  }

  /** Update all bombs and explosions. Returns events (brick destroyed, player killed positions) */
  update(dt: number, grid: GameGrid): BombEvents {
    const events: BombEvents = {
      bricksDestroyed: [],
      explosionPositions: [],
    };

    // Move sliding bombs
    for (const bomb of this.bombs) {
      if (bomb.exploded) {
        continue;
      }
      this.tryTeleportBomb(bomb, grid);
      this.tryStartConveyorSlide(bomb, grid);
      if (bomb.sliding && bomb.slideDirection) {
        this.updateSlidingBomb(bomb, dt, grid);
      }
    }

    // Tick down bomb timers
    for (const bomb of this.bombs) {
      if (!bomb.exploded) {
        bomb.timer -= dt;
        if (bomb.timer <= 0) {
          this.detonate(bomb, grid, events);
        }
      }
    }

    // Remove exploded bombs
    this.bombs = this.bombs.filter((b) => !b.exploded);

    // Tick down explosion timers
    for (const exp of this.explosions) {
      exp.timer -= dt;
    }
    this.explosions = this.explosions.filter((e) => e.timer > 0);

    return events;
  }

  /** Clear grace period for a player who has moved off the bomb tile */
  clearGrace(owner: number, col: number, row: number): void {
    for (const bomb of this.bombs) {
      if (bomb.graceOwner === owner && (bomb.col !== col || bomb.row !== row)) {
        bomb.graceOwner = null;
      }
    }
  }

  /**
   * Start a bomb sliding in the given direction (called by player kick logic).
   * Returns true if the kick was applied.
   */
  kickBomb(
    col: number,
    row: number,
    direction: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
  ): boolean {
    const bomb = this.getLiveBombAt(col, row);
    if (!bomb) return false;

    const { ddx, ddy } = dirToDeltas(direction);
    const nextCol = col + ddx;
    const nextRow = row + ddy;

    // Only start sliding if the very next cell is clear
    if (!this.isCellClearForSlide(nextCol, nextRow, grid)) return false;

    this.startSliding(bomb, direction, 'kick', 6);
    return true;
  }

  /**
   * Punch a bomb — launch it over obstacles to land 3-5 tiles away.
   * The bomb teleports instantly to the first clear cell at distance 3-5.
   * If no clear cell is found at those distances, it lands on the last
   * empty cell it passed over (at any distance).
   * Returns true if the punch was applied.
   */
  punchBomb(
    col: number,
    row: number,
    direction: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
  ): boolean {
    const bomb = this.getLiveBombAt(col, row);
    if (!bomb) return false;

    const landing = this.findArcLanding(col, row, direction, grid);
    if (!landing) return false;

    bomb.col = landing.col;
    bomb.row = landing.row;
    bomb.graceOwner = null;
    this.stopSliding(bomb);
    return true;
  }

  /**
   * Shared arc-landing logic for punch and throw.
   * Scans tiles 1-5 in the given direction, flying over obstacles.
   * Prefers landing on the first clear cell at distance 3-5; falls back to
   * the last clear cell at any distance. Returns null if no landing exists.
   */
  private findArcLanding(
    originCol: number,
    originRow: number,
    direction: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
  ): { col: number; row: number } | null {
    const { ddx, ddy } = dirToDeltas(direction);
    const ARC_MAX_DIST = 5;
    const ARC_PREFERRED_MIN = 3;

    let lastClear: { col: number; row: number } | null = null;

    for (let dist = 1; dist <= ARC_MAX_DIST; dist++) {
      const targetCol = originCol + ddx * dist;
      const targetRow = originRow + ddy * dist;

      if (targetCol < 0 || targetCol >= GRID_COLS || targetRow < 0 || targetRow >= GRID_ROWS) {
        break;
      }

      const cell = grid.getCell(targetCol, targetRow);
      if (!cell) break;

      if (cell.type === CellContent.Empty && !this.hasBomb(targetCol, targetRow)) {
        lastClear = { col: targetCol, row: targetRow };

        if (dist >= ARC_PREFERRED_MIN) {
          return lastClear;
        }
      }
    }

    return lastClear;
  }

  /** Check whether a grid cell is traversable by a sliding bomb. */
  private isCellClearForSlide(col: number, row: number, grid: GameGrid): boolean {
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
    const cell = grid.getCell(col, row);
    return !!cell && cell.type === CellContent.Empty && !this.hasBomb(col, row);
  }

  private startSliding(
    bomb: Bomb,
    direction: 'up' | 'down' | 'left' | 'right',
    mode: BombSlideMode,
    speed: number,
  ): void {
    bomb.sliding = true;
    bomb.slideDirection = direction;
    bomb.slideMode = mode;
    bomb.slideSpeed = speed;
    bomb.slideX = 0;
    bomb.slideY = 0;
  }

  private stopSliding(bomb: Bomb): void {
    bomb.sliding = false;
    bomb.slideDirection = null;
    bomb.slideMode = null;
    bomb.slideX = 0;
    bomb.slideY = 0;
  }

  private reverseJellyBomb(bomb: Bomb, grid: GameGrid): boolean {
    if (bomb.slideMode !== 'kick' || !bomb.slideDirection || !bomb.jelly) {
      return false;
    }

    const reversedDirection = reverseDirection(bomb.slideDirection);
    const reversed = dirToDeltas(reversedDirection);
    if (!this.isCellClearForSlide(bomb.col + reversed.ddx, bomb.row + reversed.ddy, grid)) {
      return false;
    }

    this.startSliding(bomb, reversedDirection, 'kick', bomb.slideSpeed);
    return true;
  }

  private tryStartConveyorSlide(bomb: Bomb, grid: GameGrid): void {
    if (bomb.sliding) {
      return;
    }

    const direction = grid.getConveyorDirection(bomb.col, bomb.row);
    if (!direction) {
      return;
    }

    const { ddx, ddy } = dirToDeltas(direction);
    const nextCol = bomb.col + ddx;
    const nextRow = bomb.row + ddy;
    if (!this.isCellClearForSlide(nextCol, nextRow, grid)) {
      return;
    }

    this.startSliding(bomb, direction, 'conveyor', CONVEYOR_BOMB_SPEED);
  }

  private tryTeleportBomb(bomb: Bomb, grid: GameGrid): void {
    const warp = grid.getWarp(bomb.col, bomb.row);
    if (!warp) {
      bomb.lastWarpIndex = null;
      return;
    }

    if (bomb.lastWarpIndex === warp.index) {
      return;
    }

    const destination = grid.getWarpDestination(warp);
    if (!destination || destination.index === warp.index) {
      bomb.lastWarpIndex = warp.index;
      return;
    }

    if (!this.isCellClearForSlide(destination.x, destination.y, grid)) {
      return;
    }

    bomb.col = destination.x;
    bomb.row = destination.y;
    bomb.lastWarpIndex = destination.index;
    this.stopSliding(bomb);
  }

  /** Advance a sliding bomb by dt seconds, stopping when it hits an obstacle. */
  private updateSlidingBomb(bomb: Bomb, dt: number, grid: GameGrid): void {
    if (!bomb.slideDirection) return;

    const { ddx, ddy } = dirToDeltas(bomb.slideDirection);
    const step = bomb.slideSpeed * dt;
    bomb.slideX += ddx * step;
    bomb.slideY += ddy * step;

    // Check if we've crossed a whole-cell boundary
    while (Math.abs(bomb.slideX) + Math.abs(bomb.slideY) >= 1) {
      // Move to the next cell center
      bomb.col += ddx;
      bomb.row += ddy;
      bomb.slideX -= ddx;
      bomb.slideY -= ddy;
      this.tryTeleportBomb(bomb, grid);
      if (!bomb.sliding) {
        return;
      }

      if (bomb.slideMode === 'conveyor') {
        const nextDirection = grid.getConveyorDirection(bomb.col, bomb.row);
        if (!nextDirection) {
          this.stopSliding(bomb);
          return;
        }

        const nextStep = dirToDeltas(nextDirection);
        if (!this.isCellClearForSlide(bomb.col + nextStep.ddx, bomb.row + nextStep.ddy, grid)) {
          this.stopSliding(bomb);
          return;
        }

        bomb.slideDirection = nextDirection;
        continue;
      }

      // Check if the cell after that is clear; if not, stop here
      if (!this.isCellClearForSlide(bomb.col + ddx, bomb.row + ddy, grid)) {
        if (!this.reverseJellyBomb(bomb, grid)) {
          this.stopSliding(bomb);
        }
        return;
      }
    }
  }

  /** Detonate a specific bomb — creates explosion tiles, chain-detonates adjacent bombs */
  private detonate(bomb: Bomb, grid: GameGrid, events: BombEvents): void {
    bomb.exploded = true;

    // Center explosion
    this.explosions.push({
      col: bomb.col,
      row: bomb.row,
      timer: EXPLOSION_DURATION,
      direction: 'center',
      isEnd: false,
      owner: bomb.owner,
    });
    events.explosionPositions.push({ col: bomb.col, row: bomb.row });

    // Spread in 4 directions
    for (const dir of DIRECTIONS) {
      for (let i = 1; i <= bomb.range; i++) {
        const c = bomb.col + dir.dx * i;
        const r = bomb.row + dir.dy * i;

        // Out of bounds
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;

        const cell = grid.getCell(c, r);
        if (!cell) break;

        // Solid wall stops explosion
        if (cell.type === CellContent.Solid) break;

        const isEnd = i === bomb.range;

        // Brick: destroy it, add explosion, but stop spreading
        if (cell.type === CellContent.Brick) {
          grid.setCell(c, r, CellContent.Empty);
          events.bricksDestroyed.push({ col: c, row: r, owner: bomb.owner });
          this.explosions.push({
            col: c,
            row: r,
            timer: EXPLOSION_DURATION,
            direction: dir.name,
            isEnd: true,
            owner: bomb.owner,
          });
          events.explosionPositions.push({ col: c, row: r });
          break;
        }

        // Empty cell: add explosion
        this.explosions.push({
          col: c,
          row: r,
          timer: EXPLOSION_DURATION,
          direction: dir.name,
          isEnd,
          owner: bomb.owner,
        });
        events.explosionPositions.push({ col: c, row: r });

        // Chain-detonate any bomb at this position
        for (const other of this.bombs) {
          if (!other.exploded && other.col === c && other.row === r) {
            this.detonate(other, grid, events);
          }
        }
      }
    }
  }

  /** Check if a position is in an active explosion */
  isExploding(col: number, row: number): boolean {
    return this.explosions.some((e) => e.col === col && e.row === row);
  }

  /** Check if a position has a bomb */
  hasBomb(col: number, row: number): boolean {
    return !!this.getLiveBombAt(col, row);
  }

  /** Remove any live bomb at the given position (used by sudden death). */
  removeAt(col: number, row: number): void {
    this.bombs = this.bombs.filter(
      (b) => b.exploded || b.col !== col || b.row !== row,
    );
  }

  /** Check if a position has a bomb that blocks a specific player (respects grace) */
  isBombBlocking(col: number, row: number, playerIndex: number): boolean {
    return this.bombs.some(
      (b) => !b.exploded && b.col === col && b.row === row && b.graceOwner !== playerIndex,
    );
  }

  /**
   * Grab (pick up) a bomb at the given position owned by the given player.
   * The bomb is removed from the grid and returned so the player can carry it.
   * Returns the bomb if successful, null otherwise.
   */
  grabBomb(col: number, row: number, playerIndex: number): Bomb | null {
    const idx = this.bombs.findIndex(
      (b) => !b.exploded && b.col === col && b.row === row && b.owner === playerIndex,
    );
    if (idx === -1) return null;

    const bomb = this.bombs[idx];
    // Remove the bomb from the active list — it is now carried by the player
    this.bombs.splice(idx, 1);
    this.stopSliding(bomb);
    return bomb;
  }

  /**
   * Throw a carried bomb in the given direction — same landing logic as punch.
   * The bomb flies over obstacles and lands 3-5 tiles away.
   * If no landing spot is found, the bomb is placed at the given origin position.
   */
  throwBomb(
    bomb: Bomb,
    originCol: number,
    originRow: number,
    direction: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
  ): void {
    const landing = this.findArcLanding(originCol, originRow, direction, grid);

    if (landing) {
      bomb.col = landing.col;
      bomb.row = landing.row;
    } else {
      // No landing spot — drop at origin
      bomb.col = originCol;
      bomb.row = originRow;
    }

    bomb.graceOwner = null;
    this.stopSliding(bomb);
    this.bombs.push(bomb);
  }
}
