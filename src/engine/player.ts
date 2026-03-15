import { GameGrid } from './game-grid';

export type PlayerType = 'human' | 'ai' | 'off';
export type Direction = 'up' | 'down' | 'left' | 'right' | 'none';

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

  // Raw input flags
  inputUp = false;
  inputDown = false;
  inputLeft = false;
  inputRight = false;
  inputBomb = false;

  // Ordered stack of pressed directions for last-pressed-wins priority
  private directionStack: Direction[] = [];

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
    return this.directionStack[this.directionStack.length - 1];
  }

  update(dt: number, grid: GameGrid): void {
    if (!this.alive) return;

    const dir = this.getDesiredDirection();
    this.moveDirection = dir;
    this.moving = dir !== 'none';

    if (dir !== 'none') {
      this.facing = dir;
    }

    if (!this.moving) return;

    const speed = this.stats.speed * dt;
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

    if (this.canMoveTo(newX, newY, grid)) {
      this.x = newX;
      this.y = newY;
    } else {
      // Cannot move directly -- try corner sliding
      this.applyCornerSlide(dt, grid);
    }
  }

  getGridPos(): { col: number; row: number } {
    return {
      col: Math.round(this.x),
      row: Math.round(this.y),
    };
  }

  /** Check if the player hitbox at (px, py) overlaps any non-walkable cell. */
  private canMoveTo(px: number, py: number, grid: GameGrid): boolean {
    // Compute the cells the hitbox overlaps
    const left   = px - HALF;
    const right  = px + HALF;
    const top    = py - HALF;
    const bottom = py + HALF;

    // All four corner cells (and anything in between for larger hitboxes)
    const minCol = Math.floor(left);
    const maxCol = Math.floor(right - 0.001); // slight inset to avoid touching next tile edge
    const minRow = Math.floor(top);
    const maxRow = Math.floor(bottom - 0.001);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!grid.isWalkable(c, r)) {
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
  private applyCornerSlide(dt: number, grid: GameGrid): void {
    const dir = this.moveDirection;
    const speed = this.stats.speed * dt;

    if (dir === 'up' || dir === 'down') {
      // Moving vertically -- try nudging horizontally
      const dy = dir === 'up' ? -speed : speed;
      const nearestCol = Math.round(this.x);
      const offset = this.x - nearestCol;

      if (Math.abs(offset) < SLIDE_THRESHOLD && Math.abs(offset) > 0.01) {
        // Check if aligning to nearestCol would allow the vertical move
        if (this.canMoveTo(nearestCol, this.y + dy, grid)) {
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
        if (this.canMoveTo(this.x + dx, nearestRow, grid)) {
          const nudge = Math.min(speed, Math.abs(offset));
          this.y += offset > 0 ? -nudge : nudge;
          return;
        }
      }
    }
  }

  die(): void {
    this.alive = false;
    this.moving = false;
    this.moveDirection = 'none';
  }
}
