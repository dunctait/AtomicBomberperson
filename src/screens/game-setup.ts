import type { GameState } from '../engine/state-machine';
import {
  gameConfig,
  rebuildSlots,
  resetConfig,
  type PlayerType,
} from './game-config';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

export function createGameSetup(
  onTransition: (state: string) => void,
): GameState {
  let wrapper: HTMLElement | null = null;

  function render(container: HTMLElement) {
    if (wrapper) wrapper.remove();

    wrapper = document.createElement('div');
    wrapper.className = 'screen setup-screen';

    const title = document.createElement('h2');
    title.className = 'setup-title';
    title.textContent = 'GAME SETUP';
    wrapper.appendChild(title);

    // --- Player count row ---
    const countRow = document.createElement('div');
    countRow.className = 'setup-row';

    const countLabel = document.createElement('span');
    countLabel.className = 'setup-label';
    countLabel.textContent = 'PLAYERS';
    countRow.appendChild(countLabel);

    const countControls = document.createElement('div');
    countControls.className = 'setup-controls';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'setup-btn';
    minusBtn.textContent = '\u25C0';
    minusBtn.disabled = gameConfig.playerCount <= MIN_PLAYERS;
    minusBtn.addEventListener('click', () => {
      if (gameConfig.playerCount > MIN_PLAYERS) {
        gameConfig.playerCount--;
        rebuildSlots();
        render(container);
      }
    });
    countControls.appendChild(minusBtn);

    const countVal = document.createElement('span');
    countVal.className = 'setup-value';
    countVal.textContent = String(gameConfig.playerCount);
    countControls.appendChild(countVal);

    const plusBtn = document.createElement('button');
    plusBtn.className = 'setup-btn';
    plusBtn.textContent = '\u25B6';
    plusBtn.disabled = gameConfig.playerCount >= MAX_PLAYERS;
    plusBtn.addEventListener('click', () => {
      if (gameConfig.playerCount < MAX_PLAYERS) {
        gameConfig.playerCount++;
        rebuildSlots();
        render(container);
      }
    });
    countControls.appendChild(plusBtn);

    countRow.appendChild(countControls);
    wrapper.appendChild(countRow);

    // --- Player slots ---
    const slotList = document.createElement('div');
    slotList.className = 'setup-slots';

    gameConfig.players.forEach((slot, i) => {
      const row = document.createElement('div');
      row.className = 'setup-slot-row';

      const label = document.createElement('span');
      label.className = 'setup-slot-label';
      label.textContent = `P${i + 1}`;
      row.appendChild(label);

      const typeBtn = document.createElement('button');
      typeBtn.className = `setup-slot-type setup-slot-type--${slot.type}`;
      typeBtn.textContent = slot.type.toUpperCase();

      if (i === 0) {
        // Player 1 is always human
        typeBtn.disabled = true;
      } else {
        typeBtn.addEventListener('click', () => {
          const cycle: PlayerType[] = ['human', 'ai', 'off'];
          const cur = cycle.indexOf(slot.type);
          slot.type = cycle[(cur + 1) % cycle.length];
          render(container);
        });
      }

      row.appendChild(typeBtn);
      slotList.appendChild(row);
    });

    wrapper.appendChild(slotList);

    // --- Map selection ---
    const mapRow = document.createElement('div');
    mapRow.className = 'setup-row';

    const mapLabel = document.createElement('span');
    mapLabel.className = 'setup-label';
    mapLabel.textContent = 'MAP';
    mapRow.appendChild(mapLabel);

    const mapVal = document.createElement('span');
    mapVal.className = 'setup-value';
    mapVal.textContent = gameConfig.map;
    mapRow.appendChild(mapVal);

    wrapper.appendChild(mapRow);

    // --- Buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'setup-btn-row';

    const startBtn = document.createElement('button');
    startBtn.className = 'setup-start-btn';
    startBtn.textContent = 'START';
    startBtn.addEventListener('click', () => {
      onTransition('gameplay');
    });
    btnRow.appendChild(startBtn);

    const backBtn = document.createElement('button');
    backBtn.className = 'setup-back-btn';
    backBtn.textContent = 'BACK';
    backBtn.addEventListener('click', () => {
      onTransition('main-menu');
    });
    btnRow.appendChild(backBtn);

    wrapper.appendChild(btnRow);

    const hint = document.createElement('p');
    hint.className = 'setup-hint';
    hint.textContent = 'ESC to go back';
    wrapper.appendChild(hint);

    container.appendChild(wrapper);
  }

  return {
    name: 'game-setup',

    onEnter(container: HTMLElement) {
      resetConfig();
      render(container);
    },

    onExit() {
      wrapper = null;
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onTransition('main-menu');
      }
    },
  };
}
