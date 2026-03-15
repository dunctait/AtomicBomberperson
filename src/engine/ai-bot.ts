import { Player } from './player';
import { GameGrid, CellContent, GRID_COLS, GRID_ROWS } from './game-grid';
import { BombManager } from './bomb';
import { PowerupManager } from './powerup';

/**
 * AI Bot modelled after fpc_atomic's approach:
 *   1. ESCAPE — if in a bomb's blast zone, flee to nearest safe cell
 *   2. SEEK POWERUP — collect nearby revealed powerups
 *   3. ATTACK — find best brick-destroying position, simulate bomb, verify escape
 *   4. WANDER — random safe movement
 *
 * Key safety rule (from fpc_atomic SimPlaceBomb):
 *   Before placing a bomb, build the full danger map *including* the
 *   hypothetical new bomb, then BFS-verify that at least one reachable
 *   cell is survivable.  This prevents self-kills.
 */

type AIGoal = 'flee' | 'seek-powerup' | 'attack' | 'wander';

interface GridPos {
  col: number;
  row: number;
}

const DIRS: { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

export class AIBot {
  player: Player;
  private thinkTimer: number;
  private currentGoal: AIGoal;
  private path: GridPos[];
  private pathIndex: number;
  private bombCooldown: number;

  constructor(player: Player) {
    this.player = player;
    this.thinkTimer = Math.random() * 0.3;
    this.currentGoal = 'wander';
    this.path = [];
    this.pathIndex = 0;
    this.bombCooldown = 0;
  }

  update(
    dt: number,
    grid: GameGrid,
    bombs: BombManager,
    powerups: PowerupManager,
    allPlayers: Player[],
  ): void {
    if (!this.player.alive) return;

    this.bombCooldown = Math.max(0, this.bombCooldown - dt);
    this.thinkTimer -= dt;

    if (this.thinkTimer <= 0) {
      this.think(grid, bombs, powerups, allPlayers);
      this.thinkTimer = 0.3 + Math.random() * 0.2;
    }

    this.navigatePath(grid, bombs);
  }

  // ---------------------------------------------------------------------------
  // Decision making
  // ---------------------------------------------------------------------------

  private think(
    grid: GameGrid,
    bombs: BombManager,
    powerups: PowerupManager,
    allPlayers: Player[],
  ): void {
    this.clearInputs();
    const pos = this.player.getGridPos();

    // ── Priority 1: ESCAPE ──────────────────────────────────────────────
    if (!this.isCellSafe(pos.col, pos.row, grid, bombs)) {
      const safe = this.findSafePosition(grid, bombs);
      if (safe) {
        this.path = this.findFleePath(pos.col, pos.row, safe.col, safe.row, grid, bombs);
        this.pathIndex = 0;
        this.currentGoal = 'flee';
        return;
      }
    }

    // ── Priority 2: SEEK POWERUP ────────────────────────────────────────
    const powerupTarget = this.findNearestPowerup(powerups, bombs, grid);
    if (powerupTarget) {
      this.path = this.findPath(pos.col, pos.row, powerupTarget.col, powerupTarget.row, grid, bombs, false);
      if (this.path.length > 0) {
        this.pathIndex = 0;
        this.currentGoal = 'seek-powerup';
        return;
      }
    }

    // ── Priority 3: ATTACK (brick destroy / enemy hunt) ─────────────────
    const bombTarget = this.findBombTarget(grid, allPlayers, bombs);
    if (bombTarget) {
      if (pos.col === bombTarget.col && pos.row === bombTarget.row) {
        // At target — try to place bomb
        if (this.bombCooldown <= 0 &&
            this.canPlaceBomb(bombs) &&
            !bombs.hasBomb(pos.col, pos.row) &&
            this.isCellSafe(pos.col, pos.row, grid, bombs) &&
            this.simPlaceBombIsSafe(pos.col, pos.row, grid, bombs)) {
          this.player.inputBomb = true;
          this.bombCooldown = this.player.stats.canKick ? 0.8 : 1.5;
          // Re-think quickly to flee
          this.thinkTimer = 0.05;
          return;
        }
      } else {
        // Navigate toward target (avoid danger zones)
        this.path = this.findPath(pos.col, pos.row, bombTarget.col, bombTarget.row, grid, bombs, true);
        if (this.path.length > 0) {
          this.pathIndex = 0;
          this.currentGoal = 'attack';
          return;
        }
      }
    }

    // ── Priority 4: WANDER ──────────────────────────────────────────────
    this.wander(grid, bombs);
  }

  // ---------------------------------------------------------------------------
  // Danger map helpers (fpc_atomic: IsSurvivable)
  // ---------------------------------------------------------------------------

  /** Build a 2-D boolean danger map for ALL existing bombs. true = dangerous. */
  private buildDangerMap(grid: GameGrid, bombs: BombManager): boolean[][] {
    const danger: boolean[][] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      danger[c] = new Array(GRID_ROWS).fill(false);
    }

    for (const bomb of bombs.bombs) {
      if (bomb.exploded) continue;
      danger[bomb.col][bomb.row] = true;

      for (const dir of DIRS) {
        for (let i = 1; i <= bomb.range; i++) {
          const c = bomb.col + dir.dx * i;
          const r = bomb.row + dir.dy * i;
          if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
          const cell = grid.getCell(c, r);
          if (!cell || cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
          danger[c][r] = true;
        }
      }
    }

    // Also mark active explosions
    for (let c = 0; c < GRID_COLS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        if (bombs.isExploding(c, r)) danger[c][r] = true;
      }
    }

    return danger;
  }

  /** Add a simulated bomb's blast to an existing danger map (fpc_atomic: SimPlaceBomb). */
  private addSimulatedBombToDangerMap(
    danger: boolean[][],
    bombCol: number,
    bombRow: number,
    range: number,
    grid: GameGrid,
  ): void {
    danger[bombCol][bombRow] = true;
    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const c = bombCol + dir.dx * i;
        const r = bombRow + dir.dy * i;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
        const cell = grid.getCell(c, r);
        if (!cell || cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
        danger[c][r] = true;
      }
    }
  }

  /**
   * fpc_atomic: SimPlaceBomb + reachability check.
   * Simulates placing a bomb at (col, row), builds the full danger map
   * including the new bomb, and BFS-checks that at least one walkable,
   * reachable cell from (col, row) is safe.
   */
  private simPlaceBombIsSafe(
    col: number,
    row: number,
    grid: GameGrid,
    bombs: BombManager,
  ): boolean {
    const danger = this.buildDangerMap(grid, bombs);
    this.addSimulatedBombToDangerMap(danger, col, row, this.player.stats.bombRange, grid);

    // BFS from (col, row) through walkable, non-bomb cells
    const visited = new Set<string>();
    const queue: GridPos[] = [{ col, row }];
    visited.add(`${col},${row}`);

    while (queue.length > 0) {
      const cur = queue.shift()!;

      // Is this cell survivable? (not the bomb cell itself)
      if ((cur.col !== col || cur.row !== row) && !danger[cur.col][cur.row]) {
        return true; // Found at least one safe reachable cell
      }

      for (const dir of DIRS) {
        const nc = cur.col + dir.dx;
        const nr = cur.row + dir.dy;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
        if (!grid.isWalkable(nc, nr)) continue;
        if (bombs.hasBomb(nc, nr)) continue;
        visited.add(key);
        queue.push({ col: nc, row: nr });
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Cell safety (uses bomb blast tracing, not the full danger map)
  // ---------------------------------------------------------------------------

  private isCellSafe(col: number, row: number, grid: GameGrid, bombs: BombManager): boolean {
    if (bombs.isExploding(col, row)) return false;

    for (const bomb of bombs.bombs) {
      if (bomb.exploded) continue;
      if (bomb.col === col && bomb.row === row) return false;

      for (const dir of DIRS) {
        for (let i = 1; i <= bomb.range; i++) {
          const c = bomb.col + dir.dx * i;
          const r = bomb.row + dir.dy * i;
          if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
          const cell = grid.getCell(c, r);
          if (!cell || cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
          if (c === col && r === row) return false;
        }
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Escape
  // ---------------------------------------------------------------------------

  private findSafePosition(grid: GameGrid, bombs: BombManager): GridPos | null {
    const pos = this.player.getGridPos();
    const canKick = this.player.stats.canKick;
    const visited = new Set<string>();
    const queue: GridPos[] = [{ col: pos.col, row: pos.row }];
    visited.add(`${pos.col},${pos.row}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (this.isCellSafe(current.col, current.row, grid, bombs) &&
          grid.isWalkable(current.col, current.row) &&
          !bombs.hasBomb(current.col, current.row) &&
          (current.col !== pos.col || current.row !== pos.row)) {
        return current;
      }

      for (const dir of DIRS) {
        const nc = current.col + dir.dx;
        const nr = current.row + dir.dy;
        const key = `${nc},${nr}`;
        // With kick, the AI can pass through bomb cells (it will kick them away)
        const passable = grid.isWalkable(nc, nr) && (canKick || !bombs.hasBomb(nc, nr));
        if (!visited.has(key) && nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS &&
            passable) {
          visited.add(key);
          queue.push({ col: nc, row: nr });
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Powerups
  // ---------------------------------------------------------------------------

  private findNearestPowerup(powerups: PowerupManager, bombs: BombManager, grid: GameGrid): GridPos | null {
    const revealed = powerups.powerups.filter((p) => p.revealed);
    if (revealed.length === 0) return null;

    const pos = this.player.getGridPos();
    let bestDist = Infinity;
    let best: GridPos | null = null;

    for (const p of revealed) {
      if (!this.isCellSafe(p.col, p.row, grid, bombs)) continue;
      const dist = Math.abs(p.col - pos.col) + Math.abs(p.row - pos.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = { col: p.col, row: p.row };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Attack — find best bomb target (fpc_atomic: BrickDestroyAi)
  // ---------------------------------------------------------------------------

  /**
   * Score every reachable tile by how many bricks a bomb placed there would
   * destroy, biased toward closer tiles.  Return the best candidate.
   * Also considers tiles adjacent to enemy players.
   */
  private findBombTarget(grid: GameGrid, allPlayers: Player[], bombs: BombManager): GridPos | null {
    const pos = this.player.getGridPos();
    const range = this.player.stats.bombRange;

    // BFS outward; score each tile
    const visited = new Set<string>();
    const queue: { col: number; row: number; dist: number }[] = [
      { col: pos.col, row: pos.row, dist: 0 },
    ];
    visited.add(`${pos.col},${pos.row}`);

    let bestTarget: GridPos | null = null;
    let bestScore = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Don't search too far
      if (current.dist > 8) continue;

      // Score this tile
      const brickCount = this.countBricksHit(current.col, current.row, range, grid);
      const enemyNear = this.wouldHitEnemy(current.col, current.row, range, grid, allPlayers);

      if (brickCount > 0 || enemyNear) {
        // Score: bricks destroyed, biased by closeness (fpc_atomic picks max bricks, closest)
        const score = (brickCount + (enemyNear ? 3 : 0)) * 10 - current.dist;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = { col: current.col, row: current.row };
        }
      }

      for (const dir of DIRS) {
        const nc = current.col + dir.dx;
        const nr = current.row + dir.dy;
        const key = `${nc},${nr}`;
        if (!visited.has(key) && nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS &&
            grid.isWalkable(nc, nr) && !bombs.hasBomb(nc, nr)) {
          visited.add(key);
          queue.push({ col: nc, row: nr, dist: current.dist + 1 });
        }
      }
    }

    return bestTarget;
  }

  /** Count how many bricks a bomb at (col, row) would destroy. */
  private countBricksHit(col: number, row: number, range: number, grid: GameGrid): number {
    let count = 0;
    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const c = col + dir.dx * i;
        const r = row + dir.dy * i;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
        const cell = grid.getCell(c, r);
        if (!cell) break;
        if (cell.type === CellContent.Solid) break;
        if (cell.type === CellContent.Brick) {
          count++;
          break; // blast stops at brick
        }
      }
    }
    return count;
  }

  /** Would a bomb at (col, row) hit any enemy player? */
  private wouldHitEnemy(col: number, row: number, range: number, grid: GameGrid, allPlayers: Player[]): boolean {
    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const c = col + dir.dx * i;
        const r = row + dir.dy * i;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
        const cell = grid.getCell(c, r);
        if (!cell || cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
        for (const p of allPlayers) {
          if (p.index !== this.player.index && p.alive) {
            const pp = p.getGridPos();
            if (pp.col === c && pp.row === r) return true;
          }
        }
      }
    }
    return false;
  }

  private canPlaceBomb(bombs: BombManager): boolean {
    const active = bombs.bombs.filter((b) => !b.exploded && b.owner === this.player.index).length;
    return active < this.player.stats.maxBombs;
  }

  // ---------------------------------------------------------------------------
  // Wander — random safe movement
  // ---------------------------------------------------------------------------

  private wander(grid: GameGrid, bombs: BombManager): void {
    const pos = this.player.getGridPos();
    const candidates: GridPos[] = [];

    const canKick = this.player.stats.canKick;
    for (const dir of DIRS) {
      const nc = pos.col + dir.dx;
      const nr = pos.row + dir.dy;
      if (nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS &&
          grid.isWalkable(nc, nr) &&
          (canKick || !bombs.hasBomb(nc, nr)) &&
          this.isCellSafe(nc, nr, grid, bombs)) {
        candidates.push({ col: nc, row: nr });
      }
    }

    if (candidates.length > 0) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      this.path = [target];
      this.pathIndex = 0;
      this.currentGoal = 'wander';
    } else {
      this.path = [];
      this.pathIndex = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Pathfinding
  // ---------------------------------------------------------------------------

  private bfsPath(
    startCol: number, startRow: number,
    endCol: number, endRow: number,
    grid: GameGrid, bombs: BombManager,
    extraFilter: (nc: number, nr: number) => boolean,
    allowBombs = false,
  ): GridPos[] {
    if (startCol === endCol && startRow === endRow) return [];

    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: GridPos[] = [{ col: startCol, row: startRow }];
    const startKey = `${startCol},${startRow}`;
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentKey = `${current.col},${current.row}`;

      if (current.col === endCol && current.row === endRow) {
        const path: GridPos[] = [];
        let key = currentKey;
        while (key !== startKey) {
          const [c, r] = key.split(',').map(Number);
          path.push({ col: c, row: r });
          key = parent.get(key)!;
        }
        path.reverse();
        return path;
      }

      for (const dir of DIRS) {
        const nc = current.col + dir.dx;
        const nr = current.row + dir.dy;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
        if (!grid.isWalkable(nc, nr)) continue;
        if (!allowBombs && bombs.hasBomb(nc, nr)) continue;
        if (!extraFilter(nc, nr)) continue;
        visited.add(key);
        parent.set(key, currentKey);
        queue.push({ col: nc, row: nr });
      }
    }

    return [];
  }

  private findPath(
    startCol: number, startRow: number,
    endCol: number, endRow: number,
    grid: GameGrid, bombs: BombManager,
    avoidDanger: boolean,
  ): GridPos[] {
    const result = this.bfsPath(
      startCol, startRow, endCol, endRow, grid, bombs,
      avoidDanger ? (nc, nr) => this.isCellSafe(nc, nr, grid, bombs) : () => true,
    );
    if (result.length === 0 && avoidDanger) {
      // Fallback: allow walking through bomb blast zones of unexploded bombs
      // (the bot can outrun the fuse) but NEVER through active explosions
      return this.bfsPath(startCol, startRow, endCol, endRow, grid, bombs, () => true);
    }
    return result;
  }

  private findFleePath(
    startCol: number, startRow: number,
    endCol: number, endRow: number,
    grid: GameGrid, bombs: BombManager,
  ): GridPos[] {
    // Never walk into an active explosion.
    // If the AI has kick, bombs in the path are not blockers (walking into them kicks them away).
    const canKick = this.player.stats.canKick;
    return this.bfsPath(
      startCol, startRow, endCol, endRow, grid, bombs,
      (nc, nr) => !bombs.isExploding(nc, nr),
      canKick, // allowBombs: kick sends bombs away, so they're passable
    );
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private navigatePath(grid: GameGrid, bombs: BombManager): void {
    this.clearInputs();

    if (this.path.length === 0 || this.pathIndex >= this.path.length) return;

    const target = this.path[this.pathIndex];

    // Safety check: if the next waypoint is dangerous and we're NOT fleeing,
    // abort the path and force an immediate re-think.
    if (this.currentGoal !== 'flee' && !this.isCellSafe(target.col, target.row, grid, bombs)) {
      this.path = [];
      this.pathIndex = 0;
      this.thinkTimer = 0; // re-think next frame
      return;
    }

    // Even when fleeing, if we're about to step into an active explosion, stop
    if (bombs.isExploding(target.col, target.row)) {
      this.path = [];
      this.pathIndex = 0;
      this.thinkTimer = 0;
      return;
    }

    const dx = target.col - this.player.x;
    const dy = target.row - this.player.y;
    const threshold = 0.15;

    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) return;
      const next = this.path[this.pathIndex];

      // Check the NEXT waypoint too
      if (!this.isCellSafe(next.col, next.row, grid, bombs) && this.currentGoal !== 'flee') {
        this.path = [];
        this.pathIndex = 0;
        this.thinkTimer = 0;
        return;
      }
      if (bombs.isExploding(next.col, next.row)) {
        this.path = [];
        this.pathIndex = 0;
        this.thinkTimer = 0;
        return;
      }

      this.setDirectionToward(next.col - this.player.x, next.row - this.player.y);
    } else {
      this.setDirectionToward(dx, dy);
    }
  }

  private setDirectionToward(dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0.05) this.player.setInput('right', true);
      else if (dx < -0.05) this.player.setInput('left', true);
    } else {
      if (dy > 0.05) this.player.setInput('down', true);
      else if (dy < -0.05) this.player.setInput('up', true);
    }
  }

  private clearInputs(): void {
    this.player.setInput('up', false);
    this.player.setInput('down', false);
    this.player.setInput('left', false);
    this.player.setInput('right', false);
  }
}
