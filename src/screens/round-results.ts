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
import { getRoundStats } from '../engine/round-stats';
import { PLAYER_COLORS } from '../render/player-renderer';

const STAT_COLUMNS: { key: keyof ReturnType<typeof getRoundStats>[number]; label: string }[] = [
  { key: 'kills', label: 'K' },
  { key: 'deaths', label: 'D' },
  { key: 'bricksDestroyed', label: 'B' },
  { key: 'powerupsCollected', label: 'P' },
];

function createRoundStatsTable(): HTMLElement | null {
  const stats = getRoundStats();
  if (stats.length === 0) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'results-stats-wrapper';

  const heading = document.createElement('div');
  heading.className = 'results-stats-heading';
  heading.textContent = 'ROUND STATS';
  wrapper.appendChild(heading);

  const table = document.createElement('div');
  table.className = 'results-stats-table';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'results-stats-row results-stats-row--header';

  const nameHeader = document.createElement('span');
  nameHeader.className = 'results-stats-cell results-stats-name';
  nameHeader.textContent = '';
  headerRow.appendChild(nameHeader);

  for (const col of STAT_COLUMNS) {
    const cell = document.createElement('span');
    cell.className = 'results-stats-cell results-stats-col-header';
    cell.textContent = col.label;
    headerRow.appendChild(cell);
  }
  table.appendChild(headerRow);

  // Data rows
  for (let i = 0; i < stats.length; i++) {
    const color = PLAYER_COLORS[i] || '#fff';
    const playerStat = stats[i];
    const row = document.createElement('div');
    row.className = 'results-stats-row';
    row.style.setProperty('--player-color', color);

    const dot = document.createElement('span');
    dot.className = 'results-stats-dot';
    dot.style.background = color;
    row.appendChild(dot);

    for (const col of STAT_COLUMNS) {
      const cell = document.createElement('span');
      cell.className = 'results-stats-cell';
      cell.textContent = String(playerStat[col.key]);
      row.appendChild(cell);
    }

    table.appendChild(row);
  }

  wrapper.appendChild(table);
  return wrapper;
}

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

      const statsTable = createRoundStatsTable();
      if (statsTable) {
        panel.appendChild(statsTable);
      }

      content.appendChild(panel);
    },
    interactions: {
      onConfirm: advanceToGameplay,
      onEscape: exitToMainMenu,
    },
  });
}
