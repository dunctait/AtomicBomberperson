export type PlayerType = 'human' | 'ai' | 'off';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export const AI_DIFFICULTY_OPTIONS: AIDifficulty[] = ['easy', 'normal', 'hard'];

export interface PlayerSlot {
  type: PlayerType;
}

export interface GameConfig {
  playerCount: number;
  players: PlayerSlot[];
  map: string;
  mapFile: string | null;
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
  gameConfig.winsRequired = 3;
  gameConfig.roundTimerSeconds = 120;
  gameConfig.brickDensityOverride = null;
  gameConfig.aiDifficulty = 'normal';
  rebuildSlots();
}

/** Rebuild the player slot array to match playerCount. */
export function rebuildSlots(): void {
  gameConfig.players = [];
  for (let i = 0; i < gameConfig.playerCount; i++) {
    // Player 0 and Player 1 default to human (local multiplayer);
    // remaining slots default to AI bots.
    gameConfig.players.push({
      type: i <= 1 ? 'human' : 'ai',
    });
  }
}
