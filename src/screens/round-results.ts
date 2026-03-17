import type { GameState } from '../engine/state-machine';
import { clearMatchProgress, matchState } from '../engine/match-manager';
import {
  appendResultsPanelSections,
  createResultsMessage,
  createResultsPanel,
  createResultsScreen,
  createTransitionHandler,
} from './results-screen-shared';
import { gameConfig } from './game-config';

export function createRoundResults(
  onTransition: (state: string) => void,
): GameState {
  const advanceToGameplay = createTransitionHandler(onTransition, 'gameplay');
  const exitToMainMenu = createTransitionHandler(onTransition, 'main-menu', clearMatchProgress);

  return createResultsScreen({
    name: 'round-results',
    screenClassName: 'round-results-screen',
    animatedSelector: '.results-round-winner',
    pulseAmplitude: 0.03,
    pulseFrequency: 4,
    renderContent(content) {
      const panel = createResultsPanel(`ROUND ${matchState.roundNumber} RESULTS`);

      const roundWinner = matchState.lastRoundWinner;
      const winnerName = roundWinner >= 0 ? (gameConfig.players[roundWinner]?.name ?? `Player ${roundWinner + 1}`) : '';
      const roundBanner =
        roundWinner >= 0
          ? createResultsMessage(
              'results-round-winner',
              `${winnerName.toUpperCase()} WINS THE ROUND!`,
              roundWinner,
            )
          : createResultsMessage('results-draw', 'DRAW \u2014 NO WINNER THIS ROUND');
      panel.appendChild(roundBanner);

      appendResultsPanelSections(panel, {
        crownClass: 'results-crown--round',
        crownText: '\u2605',
        highlightClass: 'results-player-row--winner',
        highlightedPlayer: matchState.lastRoundWinner,
        promptText: 'ENTER/SPACE \u2014 NEXT ROUND',
      });

      content.appendChild(panel);
    },
    interactions: {
      onConfirm: advanceToGameplay,
      onEscape: exitToMainMenu,
    },
  });
}
