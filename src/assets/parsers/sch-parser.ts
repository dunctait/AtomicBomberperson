/**
 * SCH scheme/map format parser.
 *
 * Parses Atomic Bomberman plain-text map scheme files.
 * Grid: 15 columns x 11 rows.
 */

export enum TileType {
  Empty = 0,
  Solid = 1,
  Brick = 2,
}

export type ConveyorDirection = 'up' | 'down' | 'left' | 'right';

export interface SpawnPoint {
  player: number;
  x: number;
  y: number;
  team: number;
}

export interface PowerupSetting {
  id: number;
  name: string;
  bornWith: number;
  hasOverride: boolean;
  overrideValue: number;
  forbidden: boolean;
}

export interface ConveyorTile {
  x: number;
  y: number;
  direction: ConveyorDirection;
}

export interface WarpTile {
  index: number;
  target: number;
  x: number;
  y: number;
}

export interface ParsedScheme {
  name: string;
  brickDensity: number;
  grid: TileType[][];  // [row][col], 11 rows x 15 cols
  spawns: SpawnPoint[];
  powerups: PowerupSetting[];
  conveyors: ConveyorTile[];
  warps: WarpTile[];
}

const GRID_COLS = 15;
const GRID_ROWS = 11;

const POWERUP_NAMES: Record<number, string> = {
  0: 'Extra bomb',
  1: 'Longer flame',
  2: 'Disease',
  3: 'Kick',
  4: 'Extra speed',
  5: 'Punch',
  6: 'Grab',
  7: 'Spooger',
  8: 'Gold flame',
  9: 'Trigger',
  10: 'Jelly',
  11: 'Super bad disease',
  12: 'Random',
};

const TILE_CHARS: Record<string, TileType> = {
  '.': TileType.Empty,
  '#': TileType.Solid,
  ':': TileType.Brick,
};

const CONVEYOR_DIRECTIONS: Record<string, ConveyorDirection> = {
  N: 'up',
  S: 'down',
  W: 'left',
  E: 'right',
  U: 'up',
  D: 'down',
  L: 'left',
  R: 'right',
};

export function parseScheme(text: string): ParsedScheme {
  let name = '';
  let brickDensity = 0;
  const grid: TileType[][] = [];
  const spawns: SpawnPoint[] = [];
  const powerups: PowerupSetting[] = [];
  const conveyors: ConveyorTile[] = [];
  const warps: WarpTile[] = [];
  let nextWarpIndex = 0;

  // Initialise grid to empty
  for (let r = 0; r < GRID_ROWS; r++) {
    grid.push(new Array<TileType>(GRID_COLS).fill(TileType.Empty));
  }

  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and blank lines
    if (trimmed === '' || trimmed.startsWith(';')) {
      continue;
    }

    const taggedLine = trimmed.startsWith('-');
    if (!taggedLine && !/^[A-Za-z]/.test(trimmed)) {
      continue;
    }

    const content = taggedLine ? trimmed.substring(1) : trimmed;
    const typeLetter = content[0]?.toUpperCase();
    const parts = taggedLine
      ? content.substring(2).split(',')
      : content.substring(1).split(/\s+/).filter(Boolean);

    switch (typeLetter) {
      case 'V':
        // Version — ignore
        break;

      case 'N':
        name = parts[0] ?? '';
        break;

      case 'B':
        brickDensity = parseInt(parts[0], 10);
        break;

      case 'R': {
        const row = parseInt(parts[0], 10);
        const tiles = parts[1] ?? '';
        if (row >= 0 && row < GRID_ROWS) {
          for (let col = 0; col < GRID_COLS && col < tiles.length; col++) {
            const ch = tiles[col];
            grid[row][col] = TILE_CHARS[ch] ?? TileType.Empty;
          }
        }
        break;
      }

      case 'S': {
        const player = parseInt(parts[0], 10);
        const x = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        const team = parts.length > 3 ? parseInt(parts[3], 10) : 0;
        spawns.push({ player, x, y, team });
        break;
      }

      case 'P': {
        const id = parseInt(parts[0], 10);
        const bornWith = parseInt(parts[1], 10);
        const hasOverride = parts[2] === '1';
        const overrideValue = parseInt(parts[3], 10);
        const forbidden = parts[4] === '1';
        const comment = parts.length > 5 ? parts[5] : '';
        powerups.push({
          id,
          name: comment || POWERUP_NAMES[id] || `Powerup ${id}`,
          bornWith,
          hasOverride,
          overrideValue,
          forbidden,
        });
        break;
      }

      case 'C': {
        const direction = CONVEYOR_DIRECTIONS[(parts[0] ?? '').toUpperCase()];
        const x = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (direction && x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) {
          conveyors.push({ direction, x, y });
        }
        break;
      }

      case 'W': {
        const target = parseInt(parts[0], 10);
        const x = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (
          Number.isInteger(target) &&
          x >= 0 && x < GRID_COLS &&
          y >= 0 && y < GRID_ROWS
        ) {
          warps.push({ index: nextWarpIndex, target, x, y });
          nextWarpIndex += 1;
        }
        break;
      }
    }
  }

  return { name, brickDensity, grid, spawns, powerups, conveyors, warps };
}
