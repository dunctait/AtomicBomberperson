import type { GameState } from '../engine/state-machine';
import { matchState, isMatchOver } from '../engine/match-manager';
import { PLAYER_COLORS } from '../render/player-renderer';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';

export function createRoundResults(
  onTransition: (state: string) => void,
): GameState {
  let stageElements: VirtualStageElements | null = null;
  let elapsedTime = 0;

  function render(container: HTMLElement): void {
    if (!stageElements) {
      stageElements = mountVirtualStage(container, 'round-results-screen');
    }

    const { content } = stageElements;
    content.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'results-panel';

    const matchOver = isMatchOver();

    // Heading
    const heading = document.createElement('h2');
    heading.className = 'results-heading';
    heading.textContent = matchOver
      ? 'MATCH OVER'
      : `ROUND ${matchState.roundNumber} RESULTS`;
    panel.appendChild(heading);

    // Match winner announcement
    if (matchOver) {
      const winnerMsg = document.createElement('div');
      winnerMsg.className = 'results-match-winner';
      const winnerColor = PLAYER_COLORS[matchState.matchWinner] || '#FFF';
      winnerMsg.style.color = winnerColor;
      winnerMsg.textContent = `PLAYER ${matchState.matchWinner + 1} WINS THE MATCH!`;
      panel.appendChild(winnerMsg);
    }

    // Score display
    const scoreBoard = document.createElement('div');
    scoreBoard.className = 'results-scoreboard';

    for (let i = 0; i < matchState.scores.length; i++) {
      const row = document.createElement('div');
      row.className = 'results-player-row';

      const isLastWinner = matchState.lastRoundWinner === i;
      if (isLastWinner) {
        row.classList.add('results-player-row--winner');
      }

      const color = PLAYER_COLORS[i] || '#FFF';

      const dot = document.createElement('span');
      dot.className = 'results-player-dot';
      dot.style.background = color;
      row.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'results-player-label';
      label.textContent = `P${i + 1}`;
      label.style.color = color;
      row.appendChild(label);

      const tally = document.createElement('span');
      tally.className = 'results-tally';
      // Render tally bars
      let tallyHtml = '';
      for (let w = 0; w < matchState.winsRequired; w++) {
        const filled = w < matchState.scores[i];
        tallyHtml += `<span class="results-tally-mark ${filled ? 'results-tally-mark--filled' : ''}" style="${filled ? `background: ${color}; box-shadow: 0 0 6px ${color};` : ''}"></span>`;
      }
      tally.innerHTML = tallyHtml;
      row.appendChild(tally);

      const count = document.createElement('span');
      count.className = 'results-win-count';
      count.textContent = String(matchState.scores[i]);
      count.style.color = color;
      row.appendChild(count);

      scoreBoard.appendChild(row);
    }

    panel.appendChild(scoreBoard);

    // Draw indicator
    if (matchState.lastRoundWinner === -1) {
      const drawMsg = document.createElement('div');
      drawMsg.className = 'results-draw';
      drawMsg.textContent = 'DRAW - NO WINNER THIS ROUND';
      panel.appendChild(drawMsg);
    }

    // Prompt
    const prompt = document.createElement('p');
    prompt.className = 'results-prompt';
    if (matchOver) {
      prompt.textContent = 'PRESS ENTER FOR MENU';
    } else {
      prompt.textContent = 'PRESS ENTER FOR NEXT ROUND';
    }
    panel.appendChild(prompt);

    const hint = document.createElement('p');
    hint.className = 'results-hint';
    hint.textContent = 'ESC to quit to menu';
    panel.appendChild(hint);

    content.appendChild(panel);
  }

  return {
    name: 'round-results',

    onEnter(container: HTMLElement) {
      elapsedTime = 0;
      render(container);
    },

    onExit() {
      stageElements?.destroy();
      stageElements = null;
    },

    onUpdate(dt: number) {
      elapsedTime += dt;

      // Animate the match winner text pulse via CSS; nothing else needed
      // Update pulse effect for winner text
      if (stageElements) {
        const winnerEl = stageElements.content.querySelector('.results-match-winner') as HTMLElement | null;
        if (winnerEl) {
          const scale = 1 + 0.05 * Math.sin(elapsedTime * 3);
          winnerEl.style.transform = `scale(${scale})`;
        }
      }
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        matchState.roundNumber = 0;
        onTransition('main-menu');
        return;
      }
      if (e.key === 'Enter') {
        if (isMatchOver()) {
          matchState.roundNumber = 0;
          onTransition('main-menu');
        } else {
          onTransition('gameplay');
        }
      }
    },
  };
}
