import { GameGrid, CellContent, GRID_COLS, GRID_ROWS } from './game-grid';

export interface Bomb {
  col: number;
  row: number;
  owner: number;       // player index
  timer: number;       // seconds remaining (starts at 2.0)
  range: number;       // explosion range in tiles
  exploded: boolean;
  /** Grace period: the player who placed the bomb can walk out of it */
  graceOwner: number | null;
}

export interface Explosion {
  col: number;
  row: number;
  timer: number;       // seconds remaining for the visual (starts at 0.5)
  direction: 'center' | 'up' | 'down' | 'left' | 'right';
  isEnd: boolean;      // true if this is the tip of the flame
}

export interface BombEvents {
  bricksDestroyed: { col: number; row: number }[];
  explosionPositions: { col: number; row: number }[];
}

const BOMB_FUSE = 2.0;
const EXPLOSION_DURATION = 0.5;

const DIRECTIONS: { dx: number; dy: number; name: Explosion['direction'] }[] = [
  { dx: 0, dy: -1, name: 'up' },
  { dx: 0, dy: 1, name: 'down' },
  { dx: -1, dy: 0, name: 'left' },
  { dx: 1, dy: 0, name: 'right' },
];

export class BombManager {
  bombs: Bomb[] = [];
  explosions: Explosion[] = [];

  /** Place a bomb at grid position. Returns false if cell already has a bomb */
  placeBomb(col: number, row: number, owner: number, range: number): boolean {
    if (this.hasBomb(col, row)) {
      return false;
    }

    this.bombs.push({
      col,
      row,
      owner,
      timer: BOMB_FUSE,
      range,
      exploded: false,
      graceOwner: owner,
    });

    return true;
  }

  /** Update all bombs and explosions. Returns events (brick destroyed, player killed positions) */
  update(dt: number, grid: GameGrid): BombEvents {
    const events: BombEvents = {
      bricksDestroyed: [],
      explosionPositions: [],
    };

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
          events.bricksDestroyed.push({ col: c, row: r });
          this.explosions.push({
            col: c,
            row: r,
            timer: EXPLOSION_DURATION,
            direction: dir.name,
            isEnd: true,
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
    return this.bombs.some((b) => !b.exploded && b.col === col && b.row === row);
  }

  /** Check if a position has a bomb that blocks a specific player (respects grace) */
  isBombBlocking(col: number, row: number, playerIndex: number): boolean {
    return this.bombs.some(
      (b) => !b.exploded && b.col === col && b.row === row && b.graceOwner !== playerIndex,
    );
  }
}
