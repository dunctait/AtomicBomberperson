import { GameGrid, GRID_COLS, GRID_ROWS } from './game-grid';
import { BombManager, dirToDeltas, type Bomb } from './bomb';

export type PlayerType = 'human' | 'ai' | 'off';
export type Direction = 'up' | 'down' | 'left' | 'right' | 'none';
export type DiseaseEffect = 'slow' | 'reverse';

export interface PlayerStats {
  maxBombs: number;
  bombRange: number;
  speed: number;        // tiles per second
  activeBombs: number;
  canKick: boolean;
  canPunch: boolean;
  canGrab: boolean;
  hasTrigger: boolean;
  hasJelly: boolean;
  hasSpooger: boolean;
}

/** Size of the player hitbox in tiles (centered on position). */
const HITBOX = 0.6;
/** Half the hitbox size. */
const HALF = HITBOX / 2;
/** Threshold for corner-slide nudging (how far off-center is tolerable). */
const SLIDE_THRESHOLD = 0.45;
const SLOW_DISEASE_MULTIPLIER = 0.55;
const CONVEYOR_SPEED = 1.4;
/** Duration of the death animation in seconds. */
export const DEATH_ANIM_DURATION = 1.0;

function getOppositeDirection(dir: Direction): Direction {
  switch (dir) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    default:
      return dir;
  }
}

export class Player {
  index: number;
  type: PlayerType;
  alive: boolean;

  // Fractional grid coordinates (center of the player)
  x: number;
  y: number;

  facing: Direction;
  moving: boolean;
  moveDirection: Direction;

  stats: PlayerStats;

  /** Bomb currently being carried (grab/spooge mechanic). */
  carriedBomb: Bomb | null = null;

  /** Timer for death animation. Starts at DEATH_ANIM_DURATION when die() is called, counts down to 0. */
  deathTimer = 0;

  // Raw input flags
  inputUp = false;
  inputDown = false;
  inputLeft = false;
  inputRight = false;
  inputBomb = false;

  // Ordered stack of pressed directions for last-pressed-wins priority
  private directionStack: Direction[] = [];
  private slowDiseaseTimer = 0;
  private reverseDiseaseTimer = 0;
  private activeWarpIndex: number | null = null;

  constructor(index: number, type: PlayerType, spawnX: number, spawnY: number) {
    this.index = index;
    this.type = type;
    this.alive = true;
    this.x = spawnX;
    this.y = spawnY;
    this.facing = 'down';
    this.moving = false;
    this.moveDirection = 'none';
    this.stats = {
      maxBombs: 1,
      bombRange: 2,
      speed: 3.0,
      activeBombs: 0,
      canKick: false,
      canPunch: false,
      canGrab: false,
      hasTrigger: false,
      hasJelly: false,
      hasSpooger: false,
    };
  }

  /** Map a key string to an input action (uses setInput externally). */
  setInput(key: string, pressed: boolean): void {
    // This maps generic action names, not raw keys.
    // The InputManager calls this with action names.
    switch (key) {
      case 'up':
        this.inputUp = pressed;
        this.updateDirectionStack('up', pressed);
        break;
      case 'down':
        this.inputDown = pressed;
        this.updateDirectionStack('down', pressed);
        break;
      case 'left':
        this.inputLeft = pressed;
        this.updateDirectionStack('left', pressed);
        break;
      case 'right':
        this.inputRight = pressed;
        this.updateDirectionStack('right', pressed);
        break;
      case 'bomb':
        this.inputBomb = pressed;
        break;
    }
  }

  private updateDirectionStack(dir: Direction, pressed: boolean): void {
    // Remove existing entry
    this.directionStack = this.directionStack.filter((d) => d !== dir);
    // If pressed, push to end (most recent = highest priority)
    if (pressed) {
      this.directionStack.push(dir);
    }
  }

  /** The current desired movement direction (last pressed wins). */
  private getDesiredDirection(): Direction {
    if (this.directionStack.length === 0) return 'none';
    const direction = this.directionStack[this.directionStack.length - 1];
    return this.hasReverseDisease() ? getOppositeDirection(direction) : direction;
  }

  update(dt: number, grid: GameGrid, bombs: BombManager): void {
    this.slowDiseaseTimer = Math.max(0, this.slowDiseaseTimer - dt);
    this.reverseDiseaseTimer = Math.max(0, this.reverseDiseaseTimer - dt);

    if (!this.alive) {
      if (this.deathTimer > 0) {
        this.deathTimer = Math.max(0, this.deathTimer - dt);
      }
      return;
    }

    const dir = this.getDesiredDirection();
    this.moveDirection = dir;
    this.moving = dir !== 'none';

    if (dir !== 'none') {
      this.facing = dir;
    }

    if (!this.moving) {
      this.applyConveyorMotion(dt, grid, bombs);
      this.applyWarpTeleport(grid, bombs);
      this.x = Math.max(0, Math.min(GRID_COLS - 1, this.x));
      this.y = Math.max(0, Math.min(GRID_ROWS - 1, this.y));
      return;
    }

    const speed = this.getMovementSpeed() * dt;
    let dx = 0;
    let dy = 0;

    switch (dir) {
      case 'up':    dy = -speed; break;
      case 'down':  dy =  speed; break;
      case 'left':  dx = -speed; break;
      case 'right': dx =  speed; break;
    }

    // Try to move in the desired direction
    const newX = this.x + dx;
    const newY = this.y + dy;

    if (this.canMoveTo(newX, newY, grid, bombs)) {
      this.x = newX;
      this.y = newY;
    } else {
      // Check for bomb punch, then kick, before trying corner slide
      if (this.stats.canPunch && dir !== 'none' && this.tryPunchBomb(dir, grid, bombs)) {
        // Bomb was punched — player stays in place this frame
      } else if (this.stats.canKick && dir !== 'none' && this.tryKickBomb(dir, grid, bombs)) {
        // Bomb was kicked — player stays in place this frame
      } else {
        // Cannot move directly -- try corner sliding
        this.applyCornerSlide(dt, grid, bombs);
      }
    }

    this.applyConveyorMotion(dt, grid, bombs);
    this.applyWarpTeleport(grid, bombs);

    // Clamp position so player stays within the grid
    this.x = Math.max(0, Math.min(GRID_COLS - 1, this.x));
    this.y = Math.max(0, Math.min(GRID_ROWS - 1, this.y));
  }

  private applyConveyorMotion(dt: number, grid: GameGrid, bombs: BombManager): void {
    const cellCol = Math.round(this.x);
    const cellRow = Math.round(this.y);
    const direction = grid.getConveyorDirection(cellCol, cellRow);
    if (!direction) {
      return;
    }

    const conveyorStep = CONVEYOR_SPEED * dt;
    let targetX = this.x;
    let targetY = this.y;
    const centerX = cellCol;
    const centerY = cellRow;

    if (direction === 'left' || direction === 'right') {
      const alignY = Math.max(-conveyorStep, Math.min(conveyorStep, centerY - this.y));
      targetY += alignY;
      targetX += direction === 'left' ? -conveyorStep : conveyorStep;
    } else {
      const alignX = Math.max(-conveyorStep, Math.min(conveyorStep, centerX - this.x));
      targetX += alignX;
      targetY += direction === 'up' ? -conveyorStep : conveyorStep;
    }

    if (this.canMoveTo(targetX, targetY, grid, bombs)) {
      this.x = Math.max(0, Math.min(GRID_COLS - 1, targetX));
      this.y = Math.max(0, Math.min(GRID_ROWS - 1, targetY));
    }
  }

  private applyWarpTeleport(grid: GameGrid, bombs: BombManager): void {
    const cellCol = Math.round(this.x);
    const cellRow = Math.round(this.y);
    const warp = grid.getWarp(cellCol, cellRow);

    if (!warp) {
      this.activeWarpIndex = null;
      return;
    }

    if (this.activeWarpIndex === warp.index) {
      return;
    }

    const destination = grid.getWarpDestination(warp);
    if (!destination || destination.index === warp.index) {
      this.activeWarpIndex = warp.index;
      return;
    }

    if (!this.canMoveTo(destination.x, destination.y, grid, bombs)) {
      return;
    }

    this.x = destination.x;
    this.y = destination.y;
    this.activeWarpIndex = destination.index;
  }

  applyDisease(effect: DiseaseEffect, duration: number): void {
    if (effect === 'slow') {
      this.slowDiseaseTimer = Math.max(this.slowDiseaseTimer, duration);
      return;
    }

    this.reverseDiseaseTimer = Math.max(this.reverseDiseaseTimer, duration);
  }

  hasSlowDisease(): boolean {
    return this.slowDiseaseTimer > 0;
  }

  hasReverseDisease(): boolean {
    return this.reverseDiseaseTimer > 0;
  }

  private getMovementSpeed(): number {
    return this.stats.speed * (this.hasSlowDisease() ? SLOW_DISEASE_MULTIPLIER : 1);
  }

  getGridPos(): { col: number; row: number } {
    return {
      col: Math.round(this.x),
      row: Math.round(this.y),
    };
  }

  /** Check if the player hitbox at (px, py) overlaps any non-walkable cell or blocking bomb. */
  private canMoveTo(px: number, py: number, grid: GameGrid, bombs: BombManager): boolean {
    // Compute the cells the hitbox overlaps.
    // Player coordinates use a center-of-tile convention: position N means the
    // center of tile N, so tile N spans [N-0.5, N+0.5).  We convert hitbox
    // edges to tile indices by adding 0.5 before flooring.
    const left   = px - HALF;
    const right  = px + HALF;
    const top    = py - HALF;
    const bottom = py + HALF;

    const minCol = Math.floor(left + 0.5);
    const maxCol = Math.floor(right + 0.5 - 0.001);
    const minRow = Math.floor(top + 0.5);
    const maxRow = Math.floor(bottom + 0.5 - 0.001);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        // Out-of-bounds cells are treated as passable — edge maps (e.g. BASIC)
        // have no border walls and spawns sit at grid corners.
        if (c < 0 || r < 0 || c >= grid.cells[0]?.length || r >= grid.cells.length) {
          continue;
        }
        if (!grid.isWalkable(c, r)) {
          return false;
        }
        if (bombs.isBombBlocking(c, r, this.index)) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Corner sliding: when the player is blocked, check if nudging perpendicular
   * would let them slip around a corner. This is the classic Bomberman feel.
   */
  private applyCornerSlide(dt: number, grid: GameGrid, bombs: BombManager): void {
    const dir = this.moveDirection;
    const speed = this.stats.speed * dt;

    if (dir === 'up' || dir === 'down') {
      // Moving vertically -- try nudging horizontally
      const dy = dir === 'up' ? -speed : speed;
      const nearestCol = Math.round(this.x);
      const offset = this.x - nearestCol;

      if (Math.abs(offset) < SLIDE_THRESHOLD && Math.abs(offset) > 0.01) {
        // Check if aligning to nearestCol would allow the vertical move
        if (this.canMoveTo(nearestCol, this.y + dy, grid, bombs)) {
          // Nudge horizontally toward alignment
          const nudge = Math.min(speed, Math.abs(offset));
          this.x += offset > 0 ? -nudge : nudge;
          return;
        }
      }
    } else if (dir === 'left' || dir === 'right') {
      // Moving horizontally -- try nudging vertically
      const dx = dir === 'left' ? -speed : speed;
      const nearestRow = Math.round(this.y);
      const offset = this.y - nearestRow;

      if (Math.abs(offset) < SLIDE_THRESHOLD && Math.abs(offset) > 0.01) {
        if (this.canMoveTo(this.x + dx, nearestRow, grid, bombs)) {
          const nudge = Math.min(speed, Math.abs(offset));
          this.y += offset > 0 ? -nudge : nudge;
          return;
        }
      }
    }
  }

  /**
   * Try to kick a bomb in the given direction.
   * The player must be aligned closely enough to a grid row/column in the
   * perpendicular axis, and there must be a bomb in the adjacent cell.
   * Returns true if a kick was initiated.
   */
  private tryKickBomb(
    dir: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
    bombs: BombManager,
  ): boolean {
    const { ddx, ddy } = dirToDeltas(dir);

    // The cell directly in front of the player in the movement direction
    const frontCol = Math.round(this.x) + ddx;
    const frontRow = Math.round(this.y) + ddy;

    // Check there is actually a blocking bomb there (not just any bomb)
    if (!bombs.isBombBlocking(frontCol, frontRow, this.index)) return false;

    return bombs.kickBomb(frontCol, frontRow, dir, grid);
  }

  /**
   * Try to punch a bomb in the given direction.
   * The bomb flies over obstacles and lands 3-5 tiles away.
   * Returns true if a punch was initiated.
   */
  private tryPunchBomb(
    dir: 'up' | 'down' | 'left' | 'right',
    grid: GameGrid,
    bombs: BombManager,
  ): boolean {
    const { ddx, ddy } = dirToDeltas(dir);

    const frontCol = Math.round(this.x) + ddx;
    const frontRow = Math.round(this.y) + ddy;

    if (!bombs.isBombBlocking(frontCol, frontRow, this.index)) return false;

    return bombs.punchBomb(frontCol, frontRow, dir, grid);
  }

  /** Returns true if this player is currently carrying a bomb. */
  isCarryingBomb(): boolean {
    return this.carriedBomb !== null;
  }

  /** Returns true if the death animation is still playing. */
  isDeathAnimating(): boolean {
    return !this.alive && this.deathTimer > 0;
  }

  die(): void {
    this.alive = false;
    this.moving = false;
    this.moveDirection = 'none';
    this.activeWarpIndex = null;
    this.deathTimer = DEATH_ANIM_DURATION;
    // Drop carried bomb at current position (it will explode via normal fuse)
    if (this.carriedBomb) {
      const { col, row } = this.getGridPos();
      this.carriedBomb.col = col;
      this.carriedBomb.row = row;
      this.carriedBomb = null;
    }
  }
}
