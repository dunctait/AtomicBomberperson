import { Player } from './player';
import { GameGrid, CellContent, GRID_COLS, GRID_ROWS } from './game-grid';
import { BombManager } from './bomb';
import { PowerupManager } from './powerup';
import type { AIDifficulty } from '../screens/game-config';

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
 *
 * Difficulty levels modify think interval, bomb cooldown, safety behavior,
 * and explosion reaction timing.
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

/** Difficulty-dependent constants keyed by AIDifficulty. */
const DIFFICULTY_SETTINGS: Record<AIDifficulty, {
  thinkIntervalBase: number;
  thinkIntervalJitter: number;
  bombCooldownDefault: number;
  bombCooldownWithKick: number;
  /** Chance (0-1) of ignoring danger when navigating (Easy walks into danger sometimes). */
  dangerIgnoreChance: number;
  /** Delay before fleeing (seconds). 0 = instant, >0 = delayed reaction. */
  fleeDelay: number;
  /** If true, bot preemptively flees when standing in blast range even before feeling unsafe. */
  preemptiveFlee: boolean;
  /** Attack search depth for BFS. */
  attackSearchDepth: number;
  /** Enemy hit score bonus for attack targeting. */
  enemyHitScoreBonus: number;
}> = {
  easy: {
    thinkIntervalBase: 0.5,
    thinkIntervalJitter: 0.3,
    bombCooldownDefault: 2.5,
    bombCooldownWithKick: 1.5,
    dangerIgnoreChance: 0.3,
    fleeDelay: 0.3,
    preemptiveFlee: false,
    attackSearchDepth: 6,
    enemyHitScoreBonus: 2,
  },
  normal: {
    thinkIntervalBase: 0.3,
    thinkIntervalJitter: 0.2,
    bombCooldownDefault: 1.5,
    bombCooldownWithKick: 0.8,
    dangerIgnoreChance: 0,
    fleeDelay: 0,
    preemptiveFlee: false,
    attackSearchDepth: 8,
    enemyHitScoreBonus: 3,
  },
  hard: {
    thinkIntervalBase: 0.15,
    thinkIntervalJitter: 0.1,
    bombCooldownDefault: 0.8,
    bombCooldownWithKick: 0.4,
    dangerIgnoreChance: 0,
    fleeDelay: 0,
    preemptiveFlee: true,
    attackSearchDepth: 12,
    enemyHitScoreBonus: 5,
  },
};

const THINK_QUICK_RETHINK = 0.05;
const THINK_THROW_DELAY = 0.1;
const NAV_ARRIVAL_THRESHOLD = 0.15;
const NAV_DIRECTION_DEADZONE = 0.05;

export class AIBot {
  player: Player;
  private difficulty: AIDifficulty;
  private thinkTimer: number;
  private currentGoal: AIGoal;
  private path: GridPos[];
  private pathIndex: number;
  private bombCooldown: number;
  /** Accumulated flee delay timer (Easy bots hesitate before fleeing). */
  private fleeDelayTimer: number;

  constructor(player: Player, difficulty: AIDifficulty = 'normal') {
    this.player = player;
    this.difficulty = difficulty;
    const settings = DIFFICULTY_SETTINGS[this.difficulty];
    this.thinkTimer = Math.random() * settings.thinkIntervalBase;
    this.currentGoal = 'wander';
    this.path = [];
    this.pathIndex = 0;
    this.bombCooldown = 0;
    this.fleeDelayTimer = 0;
  }

  private get settings() {
    return DIFFICULTY_SETTINGS[this.difficulty];
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
      this.thinkTimer = this.settings.thinkIntervalBase + Math.random() * this.settings.thinkIntervalJitter;
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

    // ── Priority 0: THROW carried bomb toward nearest enemy ───────────
    if (this.player.isCarryingBomb()) {
      const enemy = this.findNearestEnemy(allPlayers);
      if (enemy) {
        // Face toward the enemy, then throw (inputBomb triggers throw)
        this.faceToward(pos, enemy);
        this.player.inputBomb = true;
      } else {
        // No enemies — just throw in current facing direction
        this.player.inputBomb = true;
      }
      this.path = [];
      this.pathIndex = 0;
      this.thinkTimer = THINK_THROW_DELAY;
      return;
    }

    // ── Priority 1: ESCAPE ──────────────────────────────────────────────
    // Hard bots preemptively flee: check if in any bomb's blast range even
    // before the cell is considered "unsafe" by normal standards.
    const inDanger = !this.isCellSafe(pos.col, pos.row, grid, bombs);
    const shouldFlee = inDanger || (this.settings.preemptiveFlee && this.isInBlastRange(pos.col, pos.row, grid, bombs));

    if (shouldFlee) {
      // Easy bots have a delayed flee response
      if (this.settings.fleeDelay > 0 && this.fleeDelayTimer < this.settings.fleeDelay) {
        this.fleeDelayTimer += this.settings.thinkIntervalBase;
        // Don't flee yet — continue with lower-priority goals
      } else {
        this.fleeDelayTimer = 0;

        // Grab own bomb to remove the danger source (if we have grab and are on our own bomb)
        if (this.player.stats.canGrab && bombs.hasBomb(pos.col, pos.row)) {
          this.player.inputBomb = true;
          this.thinkTimer = THINK_QUICK_RETHINK; // Re-think quickly to throw it
          return;
        }

        const safe = this.findSafePosition(grid, bombs);
        if (safe) {
          this.path = this.findFleePath(pos.col, pos.row, safe.col, safe.row, grid, bombs);
          this.pathIndex = 0;
          this.currentGoal = 'flee';
          return;
        }
      }
    } else {
      this.fleeDelayTimer = 0;
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
          this.bombCooldown = this.player.stats.canKick ? this.settings.bombCooldownWithKick : this.settings.bombCooldownDefault;
          // Re-think quickly to flee
          this.thinkTimer = THINK_QUICK_RETHINK;
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

  /**
   * Check if a cell is within any bomb's blast range (used by Hard bots for
   * preemptive fleeing). Unlike isCellSafe, this returns true even for bombs
   * that haven't started their fuse countdown — the Hard bot anticipates.
   */
  private isInBlastRange(col: number, row: number, grid: GameGrid, bombs: BombManager): boolean {
    for (const bomb of bombs.bombs) {
      if (bomb.exploded) continue;
      if (bomb.col === col && bomb.row === row) return true;

      for (const dir of DIRS) {
        for (let i = 1; i <= bomb.range; i++) {
          const c = bomb.col + dir.dx * i;
          const r = bomb.row + dir.dy * i;
          if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
          const cell = grid.getCell(c, r);
          if (!cell || cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
          if (c === col && r === row) return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Escape
  // ---------------------------------------------------------------------------

  private findSafePosition(grid: GameGrid, bombs: BombManager): GridPos | null {
    const pos = this.player.getGridPos();
    const canMoveThroughBombs = this.player.stats.canKick || this.player.stats.canPunch;
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
        // With kick or punch, the AI can pass through bomb cells (it will kick/punch them away)
        const passable = grid.isWalkable(nc, nr) && (canMoveThroughBombs || !bombs.hasBomb(nc, nr));
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
      if (current.dist > this.settings.attackSearchDepth) continue;

      // Score this tile
      const brickCount = this.countBricksHit(current.col, current.row, range, grid);
      const enemyNear = this.wouldHitEnemy(current.col, current.row, range, grid, allPlayers);

      if (brickCount > 0 || enemyNear) {
        // Score: bricks destroyed, biased by closeness (fpc_atomic picks max bricks, closest)
        const score = (brickCount + (enemyNear ? this.settings.enemyHitScoreBonus : 0)) * 10 - current.dist;
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

    const canMoveThroughBombs = this.player.stats.canKick || this.player.stats.canPunch;
    for (const dir of DIRS) {
      const nc = pos.col + dir.dx;
      const nr = pos.row + dir.dy;
      const safe = this.isCellSafe(nc, nr, grid, bombs);
      const ignoreDanger = !safe && this.settings.dangerIgnoreChance > 0 && Math.random() < this.settings.dangerIgnoreChance;
      if (nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS &&
          grid.isWalkable(nc, nr) &&
          (canMoveThroughBombs || !bombs.hasBomb(nc, nr)) &&
          (safe || ignoreDanger)) {
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
    // If the AI has kick or punch, bombs in the path are not blockers
    // (walking into them kicks/punches them away).
    const canMoveThroughBombs = this.player.stats.canKick || this.player.stats.canPunch;
    return this.bfsPath(
      startCol, startRow, endCol, endRow, grid, bombs,
      (nc, nr) => !bombs.isExploding(nc, nr),
      canMoveThroughBombs, // allowBombs: kick/punch sends bombs away, so they're passable
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
    // Easy bots sometimes ignore danger (dangerIgnoreChance).
    if (this.currentGoal !== 'flee' && !this.isCellSafe(target.col, target.row, grid, bombs)) {
      if (this.settings.dangerIgnoreChance <= 0 || Math.random() >= this.settings.dangerIgnoreChance) {
        this.path = [];
        this.pathIndex = 0;
        this.thinkTimer = 0; // re-think next frame
        return;
      }
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
    if (Math.abs(dx) < NAV_ARRIVAL_THRESHOLD && Math.abs(dy) < NAV_ARRIVAL_THRESHOLD) {
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
      if (dx > NAV_DIRECTION_DEADZONE) this.player.setInput('right', true);
      else if (dx < -NAV_DIRECTION_DEADZONE) this.player.setInput('left', true);
    } else {
      if (dy > NAV_DIRECTION_DEADZONE) this.player.setInput('down', true);
      else if (dy < -NAV_DIRECTION_DEADZONE) this.player.setInput('up', true);
    }
  }

  private clearInputs(): void {
    this.player.setInput('up', false);
    this.player.setInput('down', false);
    this.player.setInput('left', false);
    this.player.setInput('right', false);
  }

  // ---------------------------------------------------------------------------
  // Grab/punch helpers
  // ---------------------------------------------------------------------------

  /** Find the nearest alive enemy player. */
  private findNearestEnemy(allPlayers: Player[]): GridPos | null {
    const pos = this.player.getGridPos();
    let bestDist = Infinity;
    let best: GridPos | null = null;

    for (const p of allPlayers) {
      if (p.index === this.player.index || !p.alive) continue;
      const ep = p.getGridPos();
      const dist = Math.abs(ep.col - pos.col) + Math.abs(ep.row - pos.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = ep;
      }
    }
    return best;
  }

  /** Set the player's facing direction toward a target grid position. */
  private faceToward(from: GridPos, to: GridPos): void {
    const dx = to.col - from.col;
    const dy = to.row - from.row;

    // Prefer the axis with the larger delta
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.player.facing = dx >= 0 ? 'right' : 'left';
    } else {
      this.player.facing = dy >= 0 ? 'down' : 'up';
    }
  }
}
