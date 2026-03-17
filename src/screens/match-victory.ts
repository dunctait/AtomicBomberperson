import type { GameState } from '../engine/state-machine';
import { clearMatchProgress, matchState } from '../engine/match-manager';
import {
  appendResultsPanelSections,
  createResultsMessage,
  createResultsPanel,
  createResultsScreen,
  createTransitionHandler,
  formatResultsCount,
} from './results-screen-shared';
import { gameConfig } from './game-config';

export function createMatchVictory(
  onTransition: (state: string) => void,
): GameState {
  const exitToMainMenu = createTransitionHandler(onTransition, 'main-menu', clearMatchProgress);

  return createResultsScreen({
    name: 'match-victory',
    screenClassName: 'match-victory-screen',
    animatedSelector: '.results-match-winner',
    pulseAmplitude: 0.05,
    pulseFrequency: 3,
    renderContent(content) {
      const panel = createResultsPanel('MATCH OVER');

      const matchWinnerName = gameConfig.players[matchState.matchWinner]?.name ?? `Player ${matchState.matchWinner + 1}`;
      const winnerMsg = createResultsMessage(
        'results-match-winner',
        `${matchWinnerName.toUpperCase()} WINS THE MATCH!`,
        matchState.matchWinner,
      );
      panel.appendChild(winnerMsg);

      const summary = document.createElement('p');
      summary.className = 'match-victory-summary';
      summary.textContent = `DECIDED IN ${formatResultsCount(matchState.roundNumber, 'ROUND')}`;
      panel.appendChild(summary);

      appendResultsPanelSections(panel, {
        crownClass: 'results-crown--match',
        crownText: '\u265b',
        highlightClass: 'results-player-row--match-winner',
        highlightedPlayer: matchState.matchWinner,
        promptText: 'ENTER/SPACE \u2014 BACK TO MENU',
      });

      content.appendChild(panel);
    },
    interactions: {
      onConfirm: exitToMainMenu,
      onEscape: exitToMainMenu,
    },
  });
}
