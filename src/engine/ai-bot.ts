import { Player } from './player';
import { GameGrid, CellContent, GRID_COLS, GRID_ROWS } from './game-grid';
import { BombManager } from './bomb';
import { PowerupManager } from './powerup';

type AIGoal = 'flee' | 'seek-powerup' | 'attack' | 'wander';

interface GridPos {
  col: number;
  row: number;
}

/** Directions for BFS neighbor expansion. */
const DIRS: { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 }, // up
  { dx: 0, dy: 1 },  // down
  { dx: -1, dy: 0 }, // left
  { dx: 1, dy: 0 },  // right
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
    this.thinkTimer = Math.random() * 0.3; // stagger initial think
    this.currentGoal = 'wander';
    this.path = [];
    this.pathIndex = 0;
    this.bombCooldown = 0;
  }

  /** Main update — called each frame */
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
      // Re-think every 0.3-0.5s (randomized)
      this.thinkTimer = 0.3 + Math.random() * 0.2;
    }

    this.navigatePath();
  }

  /** Make a new decision about what to do */
  private think(
    grid: GameGrid,
    bombs: BombManager,
    powerups: PowerupManager,
    allPlayers: Player[],
  ): void {
    // Clear previous inputs
    this.clearInputs();

    // Priority 1: FLEE — if in danger, run away
    if (this.isInDanger(grid, bombs)) {
      const safe = this.findSafePosition(grid, bombs);
      if (safe) {
        const pos = this.player.getGridPos();
        this.path = this.findPath(pos.col, pos.row, safe.col, safe.row, grid, bombs, true);
        this.pathIndex = 0;
        this.currentGoal = 'flee';
        return;
      }
      // No safe position found — try to move anyway (wander to escape)
    }

    // Priority 2: SEEK POWERUP — go collect a revealed powerup
    const powerupTarget = this.findNearestPowerup(grid, powerups, bombs);
    if (powerupTarget) {
      const pos = this.player.getGridPos();
      this.path = this.findPath(pos.col, pos.row, powerupTarget.col, powerupTarget.row, grid, bombs, false);
      if (this.path.length > 0) {
        this.pathIndex = 0;
        this.currentGoal = 'seek-powerup';
        return;
      }
    }

    // Priority 3: ATTACK — find a position near bricks/enemies to bomb
    const bombTarget = this.findBombPosition(grid, allPlayers, bombs);
    if (bombTarget) {
      const pos = this.player.getGridPos();
      if (pos.col === bombTarget.col && pos.row === bombTarget.row) {
        // Already at the target — place bomb if we can and it's safe to do so
        if (this.bombCooldown <= 0 && this.canPlaceBomb(bombs) && this.hasSafeEscape(pos.col, pos.row, grid, bombs)) {
          this.player.inputBomb = true;
          this.bombCooldown = 1.5; // Don't spam bombs
          // Immediately flee after placing
          this.thinkTimer = 0.05;
          this.currentGoal = 'flee';
          return;
        }
      } else {
        this.path = this.findPath(pos.col, pos.row, bombTarget.col, bombTarget.row, grid, bombs, false);
        if (this.path.length > 0) {
          this.pathIndex = 0;
          this.currentGoal = 'attack';
          return;
        }
      }
    }

    // Priority 4: WANDER — move randomly
    this.wander(grid, bombs);
  }

  /** Am I in danger? (standing in a ticking bomb's blast range or on an active explosion) */
  private isInDanger(grid: GameGrid, bombs: BombManager): boolean {
    const pos = this.player.getGridPos();
    return !this.isCellSafe(pos.col, pos.row, grid, bombs);
  }

  /** Find the nearest safe position to flee to (BFS, treating danger zones as impassable) */
  private findSafePosition(grid: GameGrid, bombs: BombManager): GridPos | null {
    const pos = this.player.getGridPos();
    const visited = new Set<string>();
    const queue: GridPos[] = [{ col: pos.col, row: pos.row }];
    visited.add(`${pos.col},${pos.row}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // If this cell is safe and walkable, return it
      if (this.isCellSafe(current.col, current.row, grid, bombs) &&
          grid.isWalkable(current.col, current.row) &&
          !bombs.hasBomb(current.col, current.row)) {
        // Don't return our own position
        if (current.col !== pos.col || current.row !== pos.row) {
          return current;
        }
      }

      for (const dir of DIRS) {
        const nc = current.col + dir.dx;
        const nr = current.row + dir.dy;
        const key = `${nc},${nr}`;
        if (!visited.has(key) && nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS) {
          if (grid.isWalkable(nc, nr) && !bombs.hasBomb(nc, nr)) {
            visited.add(key);
            queue.push({ col: nc, row: nr });
          }
        }
      }
    }

    return null;
  }

  /** Find the nearest reachable revealed powerup */
  private findNearestPowerup(grid: GameGrid, powerups: PowerupManager, bombs: BombManager): GridPos | null {
    const revealed = powerups.powerups.filter((p) => p.revealed);
    if (revealed.length === 0) return null;

    const pos = this.player.getGridPos();
    let bestDist = Infinity;
    let best: GridPos | null = null;

    for (const p of revealed) {
      const dist = Math.abs(p.col - pos.col) + Math.abs(p.row - pos.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = { col: p.col, row: p.row };
      }
    }

    return best;
  }

  /** Find a good position to place a bomb (near bricks or enemies) */
  private findBombPosition(grid: GameGrid, allPlayers: Player[], bombs: BombManager): GridPos | null {
    const pos = this.player.getGridPos();
    const range = this.player.stats.bombRange;

    // BFS outward from current position to find a cell adjacent to bricks or enemies
    const visited = new Set<string>();
    const queue: { col: number; row: number; dist: number }[] = [
      { col: pos.col, row: pos.row, dist: 0 },
    ];
    visited.add(`${pos.col},${pos.row}`);

    let bestTarget: GridPos | null = null;
    let bestDist = Infinity;

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if placing a bomb here would hit a brick or enemy
      if (this.wouldBombBeUseful(current.col, current.row, range, grid, allPlayers)) {
        if (current.dist < bestDist) {
          bestDist = current.dist;
          bestTarget = { col: current.col, row: current.row };
        }
        // Don't break — keep searching for closer targets
        continue;
      }

      // Don't search too far
      if (current.dist >= 10) continue;

      for (const dir of DIRS) {
        const nc = current.col + dir.dx;
        const nr = current.row + dir.dy;
        const key = `${nc},${nr}`;
        if (!visited.has(key) && nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS) {
          if (grid.isWalkable(nc, nr) && !bombs.hasBomb(nc, nr)) {
            visited.add(key);
            queue.push({ col: nc, row: nr, dist: current.dist + 1 });
          }
        }
      }
    }

    return bestTarget;
  }

  /** Check if placing a bomb at (col, row) would hit a brick wall or enemy */
  private wouldBombBeUseful(col: number, row: number, range: number, grid: GameGrid, allPlayers: Player[]): boolean {
    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const c = col + dir.dx * i;
        const r = row + dir.dy * i;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;

        const cell = grid.getCell(c, r);
        if (!cell) break;

        // Solid wall stops blast
        if (cell.type === CellContent.Solid) break;

        // Would destroy a brick
        if (cell.type === CellContent.Brick) return true;

        // Would hit an enemy player
        for (const p of allPlayers) {
          if (p.index !== this.player.index && p.alive) {
            const pPos = p.getGridPos();
            if (pPos.col === c && pPos.row === r) return true;
          }
        }
      }
    }
    return false;
  }

  /** Simple BFS pathfinding */
  private findPath(
    startCol: number,
    startRow: number,
    endCol: number,
    endRow: number,
    grid: GameGrid,
    bombs: BombManager,
    avoidDanger: boolean,
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
        // Reconstruct path
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
        if (bombs.hasBomb(nc, nr)) continue;
        if (avoidDanger && !this.isCellSafe(nc, nr, grid, bombs)) continue;

        visited.add(key);
        parent.set(key, currentKey);
        queue.push({ col: nc, row: nr });
      }
    }

    // No path found — if we were avoiding danger, try without
    if (avoidDanger) {
      return this.findPath(startCol, startRow, endCol, endRow, grid, bombs, false);
    }

    return [];
  }

  /** Check if a cell is safe (not in any bomb's blast range and not exploding) */
  private isCellSafe(col: number, row: number, grid: GameGrid, bombs: BombManager): boolean {
    // Check active explosions
    if (bombs.isExploding(col, row)) return false;

    // Check if in blast range of any ticking bomb
    for (const bomb of bombs.bombs) {
      if (bomb.exploded) continue;

      // Is cell the bomb's own cell?
      if (bomb.col === col && bomb.row === row) return false;

      // Check each direction from the bomb
      for (const dir of DIRS) {
        for (let i = 1; i <= bomb.range; i++) {
          const c = bomb.col + dir.dx * i;
          const r = bomb.row + dir.dy * i;

          if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;

          const cell = grid.getCell(c, r);
          if (!cell) break;
          if (cell.type === CellContent.Solid) break;
          if (cell.type === CellContent.Brick) break;

          if (c === col && r === row) return false;
        }
      }
    }

    return true;
  }

  /** Check whether we can place a bomb (have available bomb slots) */
  private canPlaceBomb(bombs: BombManager): boolean {
    const activeBombs = bombs.bombs.filter(
      (b) => !b.exploded && b.owner === this.player.index,
    ).length;
    return activeBombs < this.player.stats.maxBombs;
  }

  /** Check if there's a safe cell to escape to after placing a bomb at (col, row) */
  private hasSafeEscape(col: number, row: number, grid: GameGrid, bombs: BombManager): boolean {
    // Simulate: pretend there's a bomb at (col, row) with our range
    // Check if any adjacent cell is safe from all bombs including this simulated one
    const simRange = this.player.stats.bombRange;

    for (const dir of DIRS) {
      const nc = col + dir.dx;
      const nr = row + dir.dy;
      if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
      if (!grid.isWalkable(nc, nr)) continue;
      if (bombs.hasBomb(nc, nr)) continue;

      // Check if (nc, nr) would be in blast range of the simulated bomb
      if (this.isInSimulatedBlast(nc, nr, col, row, simRange, grid)) continue;

      // Also check existing bomb danger
      if (!this.isCellSafe(nc, nr, grid, bombs)) continue;

      // Found at least one escape direction — check if we can go further
      // (we need at least a path of cells to be truly safe)
      return true;
    }
    return false;
  }

  /** Check if a cell is in the blast range of a simulated bomb */
  private isInSimulatedBlast(
    col: number,
    row: number,
    bombCol: number,
    bombRow: number,
    range: number,
    grid: GameGrid,
  ): boolean {
    if (col === bombCol && row === bombRow) return true;

    for (const dir of DIRS) {
      for (let i = 1; i <= range; i++) {
        const c = bombCol + dir.dx * i;
        const r = bombRow + dir.dy * i;
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) break;
        const cell = grid.getCell(c, r);
        if (!cell) break;
        if (cell.type === CellContent.Solid || cell.type === CellContent.Brick) break;
        if (c === col && r === row) return true;
      }
    }
    return false;
  }

  /** Wander randomly to explore the map */
  private wander(grid: GameGrid, bombs: BombManager): void {
    const pos = this.player.getGridPos();

    // Pick a random walkable neighbor
    const candidates: GridPos[] = [];
    for (const dir of DIRS) {
      const nc = pos.col + dir.dx;
      const nr = pos.row + dir.dy;
      if (nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS) {
        if (grid.isWalkable(nc, nr) && !bombs.hasBomb(nc, nr) && this.isCellSafe(nc, nr, grid, bombs)) {
          candidates.push({ col: nc, row: nr });
        }
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

  /** Navigate along the current path — sets player input flags */
  private navigatePath(): void {
    this.clearInputs();

    if (this.path.length === 0 || this.pathIndex >= this.path.length) {
      return;
    }

    const target = this.path[this.pathIndex];
    const px = this.player.x;
    const py = this.player.y;

    const dx = target.col - px;
    const dy = target.row - py;

    // Threshold for considering we've reached the target cell
    const threshold = 0.15;

    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      // Close enough to this cell — move to next in path
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        // Path complete
        return;
      }
      // Continue navigating to next cell
      const next = this.path[this.pathIndex];
      this.setDirectionToward(next.col - px, next.row - py);
    } else {
      this.setDirectionToward(dx, dy);
    }
  }

  /** Set movement input flags based on direction vector */
  private setDirectionToward(dx: number, dy: number): void {
    // Move along the axis with the larger difference (one axis at a time for grid movement)
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0.05) {
        this.player.setInput('right', true);
      } else if (dx < -0.05) {
        this.player.setInput('left', true);
      }
    } else {
      if (dy > 0.05) {
        this.player.setInput('down', true);
      } else if (dy < -0.05) {
        this.player.setInput('up', true);
      }
    }
  }

  /** Clear all movement inputs */
  private clearInputs(): void {
    this.player.setInput('up', false);
    this.player.setInput('down', false);
    this.player.setInput('left', false);
    this.player.setInput('right', false);
  }
}
