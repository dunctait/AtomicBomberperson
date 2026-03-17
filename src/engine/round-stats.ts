export interface RoundStats {
  kills: number;
  deaths: number;
  bricksDestroyed: number;
  powerupsCollected: number;
}

function makeEmptyStats(): RoundStats {
  return { kills: 0, deaths: 0, bricksDestroyed: 0, powerupsCollected: 0 };
}

let roundStats: RoundStats[] = [];

export function initRoundStats(playerCount: number): void {
  roundStats = Array.from({ length: playerCount }, makeEmptyStats);
}

export function getRoundStats(): readonly RoundStats[] {
  return roundStats;
}

export function recordKill(killerIndex: number): void {
  if (roundStats[killerIndex]) {
    roundStats[killerIndex].kills++;
  }
}

export function recordDeath(playerIndex: number): void {
  if (roundStats[playerIndex]) {
    roundStats[playerIndex].deaths++;
  }
}

export function recordBrickDestroyed(ownerIndex: number): void {
  if (roundStats[ownerIndex]) {
    roundStats[ownerIndex].bricksDestroyed++;
  }
}

export function recordPowerupCollected(playerIndex: number): void {
  if (roundStats[playerIndex]) {
    roundStats[playerIndex].powerupsCollected++;
  }
}
