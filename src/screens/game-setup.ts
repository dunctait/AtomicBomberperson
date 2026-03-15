import type { GameState } from '../engine/state-machine';
import { getAllFileNames } from '../assets/asset-db';
import {
  gameConfig,
  rebuildSlots,
  resetConfig,
  type PlayerType,
} from './game-config';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

interface AvailableMapOption {
  label: string;
  file: string | null;
}

export function createGameSetup(
  onTransition: (state: string) => void,
): GameState {
  let wrapper: HTMLElement | null = null;
  let stageElements: VirtualStageElements | null = null;
  let availableMaps: AvailableMapOption[] = [{ label: gameConfig.map, file: gameConfig.mapFile }];
  let mapListRequestId = 0;

  function createStepperButton(
    text: string,
    className: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = className;
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function createSetupStepperRow(options: {
    label: string;
    value: string;
    valueClassName?: string;
    previousButtonClassName?: string;
    nextButtonClassName?: string;
    previousDisabled: boolean;
    nextDisabled: boolean;
    onPrevious: () => void;
    onNext: () => void;
  }): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'setup-row';

    const label = document.createElement('span');
    label.className = 'setup-label';
    label.textContent = options.label;
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'setup-controls';
    controls.appendChild(
      createStepperButton(
        '\u25C0',
        options.previousButtonClassName ?? 'setup-btn',
        options.previousDisabled,
        options.onPrevious,
      ),
    );

    const value = document.createElement('span');
    value.className = options.valueClassName ?? 'setup-value';
    value.textContent = options.value;
    controls.appendChild(value);

    controls.appendChild(
      createStepperButton(
        '\u25B6',
        options.nextButtonClassName ?? 'setup-btn',
        options.nextDisabled,
        options.onNext,
      ),
    );

    row.appendChild(controls);
    return row;
  }

  function setSelectedMap(nextMap: AvailableMapOption): void {
    gameConfig.map = nextMap.label;
    gameConfig.mapFile = nextMap.file;
  }

  function cycleMap(direction: -1 | 1, container: HTMLElement): void {
    if (availableMaps.length <= 1) return;
    const currentIndex = availableMaps.findIndex(
      (map) => map.file === gameConfig.mapFile && map.label === gameConfig.map,
    );
    const startIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      (startIndex + direction + availableMaps.length) % availableMaps.length;
    setSelectedMap(availableMaps[nextIndex]);
    render(container);
  }

  async function loadAvailableMaps(container: HTMLElement): Promise<void> {
    const requestId = ++mapListRequestId;

    try {
      const allFiles = await getAllFileNames();
      const nextMaps = Array.from(
        new Map(
          allFiles
            .filter((file) => file.toUpperCase().endsWith('.SCH'))
            .map((file) => {
              const baseName = file.split(/[\\/]/).pop() ?? file;
              const label = baseName.replace(/\.sch$/i, '').toUpperCase();
              return [file.toUpperCase(), { label, file }];
            }),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label) || (a.file ?? '').localeCompare(b.file ?? ''));

      if (!wrapper || requestId !== mapListRequestId) return;

      availableMaps = nextMaps.length > 0 ? nextMaps : [{ label: 'BASIC', file: null }];
      if (!availableMaps.some((map) => map.file === gameConfig.mapFile && map.label === gameConfig.map)) {
        setSelectedMap(availableMaps[0]);
      }
      render(container);
    } catch {
      if (!wrapper || requestId !== mapListRequestId) return;
      availableMaps = [{ label: 'BASIC', file: null }];
      setSelectedMap(availableMaps[0]);
      render(container);
    }
  }

  function render(container: HTMLElement) {
    wrapper?.remove();

    if (!stageElements) {
      stageElements = mountVirtualStage(container, 'setup-screen');
    }

    const { content } = stageElements;

    wrapper = document.createElement('div');
    wrapper.className = 'setup-panel';

    const title = document.createElement('h2');
    title.className = 'setup-title';
    title.textContent = 'GAME SETUP';
    wrapper.appendChild(title);

    wrapper.appendChild(
      createSetupStepperRow({
        label: 'PLAYERS',
        value: String(gameConfig.playerCount),
        previousDisabled: gameConfig.playerCount <= MIN_PLAYERS,
        nextDisabled: gameConfig.playerCount >= MAX_PLAYERS,
        onPrevious: () => {
          if (gameConfig.playerCount > MIN_PLAYERS) {
            gameConfig.playerCount--;
            rebuildSlots();
            render(container);
          }
        },
        onNext: () => {
          if (gameConfig.playerCount < MAX_PLAYERS) {
            gameConfig.playerCount++;
            rebuildSlots();
            render(container);
          }
        },
      }),
    );

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

    wrapper.appendChild(
      createSetupStepperRow({
        label: 'MAP',
        value: gameConfig.map,
        valueClassName: 'setup-value setup-map-value',
        previousButtonClassName: 'setup-btn setup-map-btn',
        nextButtonClassName: 'setup-btn setup-map-btn',
        previousDisabled: availableMaps.length <= 1,
        nextDisabled: availableMaps.length <= 1,
        onPrevious: () => cycleMap(-1, container),
        onNext: () => cycleMap(1, container),
      }),
    );

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

    content.appendChild(wrapper);
  }

  return {
    name: 'game-setup',

    onEnter(container: HTMLElement) {
      resetConfig();
      availableMaps = [{ label: gameConfig.map, file: gameConfig.mapFile }];
      render(container);
      void loadAvailableMaps(container);
    },

    onExit() {
      wrapper = null;
      mapListRequestId++;
      stageElements?.destroy();
      stageElements = null;
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onTransition('main-menu');
      }
    },
  };
}
