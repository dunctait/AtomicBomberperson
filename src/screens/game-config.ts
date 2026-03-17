export type PlayerType = 'human' | 'ai' | 'off';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export const AI_DIFFICULTY_OPTIONS: AIDifficulty[] = ['easy', 'normal', 'hard'];

export interface PlayerSlot {
  type: PlayerType;
  name: string;
}

export interface GameConfig {
  playerCount: number;
  players: PlayerSlot[];
  map: string;
  mapFile: string | null;
  /** When true, each round picks a random scheme from the available loaded schemes. */
  randomMap: boolean;
  winsRequired: number;
  /** Round timer in seconds. When it reaches 0, sudden death begins. 0 means no timer (sudden death disabled). */
  roundTimerSeconds: number;
  /** Override brick density percentage (0-100). null means use scheme default. */
  brickDensityOverride: number | null;
  /** AI difficulty level for all bots. */
  aiDifficulty: AIDifficulty;
}

export const gameConfig: GameConfig = {
  playerCount: 4,
  players: [],
  map: 'BASIC',
  mapFile: null,
  randomMap: false,
  winsRequired: 3,
  roundTimerSeconds: 120,
  brickDensityOverride: null,
  aiDifficulty: 'normal',
};

/** Reset config to defaults and build the player slot array. */
export function resetConfig(): void {
  gameConfig.playerCount = 4;
  gameConfig.map = 'BASIC';
  gameConfig.mapFile = null;
  gameConfig.randomMap = false;
  gameConfig.winsRequired = 3;
  gameConfig.roundTimerSeconds = 120;
  gameConfig.brickDensityOverride = null;
  gameConfig.aiDifficulty = 'normal';
  rebuildSlots();
}

/** Generate a default name for a slot given its type and 1-based display index. */
export function defaultSlotName(type: PlayerType, displayIndex: number): string {
  if (type === 'ai') return `Bot ${displayIndex}`;
  if (type === 'human') return `Player ${displayIndex}`;
  return `P${displayIndex}`;
}

/** Rebuild the player slot array to match playerCount. */
export function rebuildSlots(): void {
  const prev = gameConfig.players;
  gameConfig.players = [];
  let humanCount = 0;
  let botCount = 0;
  for (let i = 0; i < gameConfig.playerCount; i++) {
    // Player 0 defaults to human; remaining slots default to AI bots.
    const type: PlayerType = i === 0 ? 'human' : 'ai';
    // Preserve name if the slot already exists and had a non-default-looking name,
    // otherwise generate a fresh default based on the type and counters.
    const slotNum = type === 'human' ? ++humanCount : ++botCount;
    const name = prev[i]?.name ?? defaultSlotName(type, slotNum);
    gameConfig.players.push({ type, name });
  }
}
