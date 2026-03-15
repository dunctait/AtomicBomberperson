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
    const roundWinner = matchState.lastRoundWinner; // -1 = draw

    // ── Heading ──────────────────────────────────────────────────────────────
    const heading = document.createElement('h2');
    heading.className = 'results-heading';
    heading.textContent = matchOver
      ? 'MATCH OVER'
      : `ROUND ${matchState.roundNumber} RESULTS`;
    panel.appendChild(heading);

    // ── Round winner / draw banner ────────────────────────────────────────────
    if (!matchOver) {
      const roundBanner = document.createElement('div');
      if (roundWinner >= 0) {
        const winColor = PLAYER_COLORS[roundWinner] || '#FFF';
        roundBanner.className = 'results-round-winner';
        roundBanner.style.color = winColor;
        roundBanner.style.setProperty('--player-color', winColor);
        roundBanner.textContent = `PLAYER ${roundWinner + 1} WINS THE ROUND!`;
      } else {
        roundBanner.className = 'results-draw';
        roundBanner.textContent = 'DRAW — NO WINNER THIS ROUND';
      }
      panel.appendChild(roundBanner);
    }

    // ── Match winner announcement ─────────────────────────────────────────────
    if (matchOver) {
      const winnerMsg = document.createElement('div');
      winnerMsg.className = 'results-match-winner';
      const winnerColor = PLAYER_COLORS[matchState.matchWinner] || '#FFF';
      winnerMsg.style.color = winnerColor;
      winnerMsg.style.setProperty('--player-color', winnerColor);
      winnerMsg.textContent = `PLAYER ${matchState.matchWinner + 1} WINS THE MATCH!`;
      panel.appendChild(winnerMsg);
    }

    // ── Win target subtitle ───────────────────────────────────────────────────
    const target = document.createElement('div');
    target.className = 'results-target';
    target.textContent = `FIRST TO ${matchState.winsRequired} WIN${matchState.winsRequired !== 1 ? 'S' : ''}`;
    panel.appendChild(target);

    // ── Score board ───────────────────────────────────────────────────────────
    const scoreBoard = document.createElement('div');
    scoreBoard.className = 'results-scoreboard';

    for (let i = 0; i < matchState.scores.length; i++) {
      const row = document.createElement('div');
      row.className = 'results-player-row';

      const isRoundWinner = matchState.lastRoundWinner === i;
      const isMatchWinner = matchOver && matchState.matchWinner === i;

      if (isMatchWinner) {
        row.classList.add('results-player-row--match-winner');
      } else if (isRoundWinner) {
        row.classList.add('results-player-row--winner');
      }

      const color = PLAYER_COLORS[i] || '#FFF';
      row.style.setProperty('--player-color', color);

      // Color dot
      const dot = document.createElement('span');
      dot.className = 'results-player-dot';
      dot.style.background = color;
      dot.style.boxShadow = `0 0 6px ${color}88`;
      row.appendChild(dot);

      // Player label
      const label = document.createElement('span');
      label.className = 'results-player-label';
      label.textContent = `P${i + 1}`;
      label.style.color = color;
      row.appendChild(label);

      // Tally marks (one box per win required)
      const tally = document.createElement('span');
      tally.className = 'results-tally';
      let tallyHtml = '';
      for (let w = 0; w < matchState.winsRequired; w++) {
        const filled = w < matchState.scores[i];
        tallyHtml += `<span class="results-tally-mark ${filled ? 'results-tally-mark--filled' : ''}" style="${filled ? `background: ${color}; box-shadow: 0 0 6px ${color};` : ''}"></span>`;
      }
      tally.innerHTML = tallyHtml;
      row.appendChild(tally);

      // Numeric win count
      const count = document.createElement('span');
      count.className = 'results-win-count';
      count.textContent = `${matchState.scores[i]}W`;
      count.style.color = color;
      row.appendChild(count);

      // Crown icon for round/match winner
      if (isMatchWinner) {
        const crown = document.createElement('span');
        crown.className = 'results-crown results-crown--match';
        crown.textContent = '♛';
        row.appendChild(crown);
      } else if (isRoundWinner) {
        const crown = document.createElement('span');
        crown.className = 'results-crown results-crown--round';
        crown.textContent = '★';
        crown.style.color = color;
        row.appendChild(crown);
      }

      scoreBoard.appendChild(row);
    }

    panel.appendChild(scoreBoard);

    // ── Action prompts ────────────────────────────────────────────────────────
    const prompt = document.createElement('p');
    prompt.className = 'results-prompt';
    if (matchOver) {
      prompt.textContent = 'ENTER — BACK TO MENU';
    } else {
      prompt.textContent = 'ENTER — NEXT ROUND';
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

      if (!stageElements) return;

      // Pulse the match-winner text
      const winnerEl = stageElements.content.querySelector(
        '.results-match-winner',
      ) as HTMLElement | null;
      if (winnerEl) {
        const scale = 1 + 0.05 * Math.sin(elapsedTime * 3);
        winnerEl.style.transform = `scale(${scale})`;
      }

      // Pulse the round-winner text
      const roundWinnerEl = stageElements.content.querySelector(
        '.results-round-winner',
      ) as HTMLElement | null;
      if (roundWinnerEl) {
        const scale = 1 + 0.03 * Math.sin(elapsedTime * 4);
        roundWinnerEl.style.transform = `scale(${scale})`;
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
