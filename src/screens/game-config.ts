export type PlayerType = 'human' | 'ai' | 'off';

export interface PlayerSlot {
  type: PlayerType;
}

export interface GameConfig {
  playerCount: number;
  players: PlayerSlot[];
  map: string;
  mapFile: string | null;
  winsRequired: number;
  /** Round timer in seconds. When it reaches 0, sudden death begins. */
  roundTimerSeconds: number;
}

export const gameConfig: GameConfig = {
  playerCount: 4,
  players: [],
  map: 'BASIC',
  mapFile: null,
  winsRequired: 3,
  roundTimerSeconds: 120,
};

/** Reset config to defaults and build the player slot array. */
export function resetConfig(): void {
  gameConfig.playerCount = 4;
  gameConfig.map = 'BASIC';
  gameConfig.mapFile = null;
  gameConfig.winsRequired = 3;
  gameConfig.roundTimerSeconds = 120;
  rebuildSlots();
}

/** Rebuild the player slot array to match playerCount. */
export function rebuildSlots(): void {
  gameConfig.players = [];
  for (let i = 0; i < gameConfig.playerCount; i++) {
    gameConfig.players.push({
      type: i === 0 ? 'human' : 'ai',
    });
  }
}
