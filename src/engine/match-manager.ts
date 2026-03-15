export interface MatchState {
  winsRequired: number;
  roundNumber: number;
  scores: number[];
  lastRoundWinner: number;  // -1 for draw
  matchWinner: number;      // -1 if ongoing
}

export const matchState: MatchState = {
  winsRequired: 3,
  roundNumber: 0,
  scores: [],
  lastRoundWinner: -1,
  matchWinner: -1,
};

export function resetMatch(playerCount: number, winsRequired: number): void {
  matchState.winsRequired = winsRequired;
  matchState.roundNumber = 0;
  matchState.scores = new Array(playerCount).fill(0);
  matchState.lastRoundWinner = -1;
  matchState.matchWinner = -1;
}

export function recordRoundResult(winnerIndex: number): void {
  matchState.lastRoundWinner = winnerIndex;

  if (winnerIndex >= 0 && winnerIndex < matchState.scores.length) {
    matchState.scores[winnerIndex]++;

    if (matchState.scores[winnerIndex] >= matchState.winsRequired) {
      matchState.matchWinner = winnerIndex;
    }
  }
}

export function isMatchOver(): boolean {
  return matchState.matchWinner >= 0;
}
