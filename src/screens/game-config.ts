export type PlayerType = 'human' | 'ai' | 'off';

export interface PlayerSlot {
  type: PlayerType;
}

export interface GameConfig {
  playerCount: number;
  players: PlayerSlot[];
  map: string;
  mapFile: string | null;
}

export const gameConfig: GameConfig = {
  playerCount: 4,
  players: [],
  map: 'BASIC',
  mapFile: null,
};

/** Reset config to defaults and build the player slot array. */
export function resetConfig(): void {
  gameConfig.playerCount = 4;
  gameConfig.map = 'BASIC';
  gameConfig.mapFile = null;
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
