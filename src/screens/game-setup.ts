import type { GameState } from '../engine/state-machine';
import { getAllFileNames } from '../assets/asset-db';
import {
  gameConfig,
  rebuildSlots,
  resetConfig,
  AI_DIFFICULTY_OPTIONS,
  type PlayerType,
} from './game-config';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const MIN_WINS = 1;
const MAX_WINS = 10;

/** Allowed round timer values in seconds. 0 means "Off" (no timer / no sudden death). */
const ROUND_TIMER_OPTIONS = [0, 30, 60, 90, 120, 180, 300];

/** Allowed brick density override values. null means "Scheme" (use scheme default). */
const BRICK_DENSITY_OPTIONS: (number | null)[] = [null, 0, 25, 50, 75, 100];

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

  function getActivePlayerCount(): number {
    return gameConfig.players.filter((slot) => slot.type !== 'off').length;
  }

  function canStartMatch(): boolean {
    return getActivePlayerCount() >= 2;
  }

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
        // Try matching by label alone (handles default 'BASIC' with null mapFile
        // when the imported list has BASIC.SCH with a real file path)
        const labelMatch = availableMaps.find((map) => map.label === gameConfig.map);
        setSelectedMap(labelMatch ?? availableMaps[0]);
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

      typeBtn.addEventListener('click', () => {
        const cycle: PlayerType[] = ['human', 'ai', 'off'];
        const cur = cycle.indexOf(slot.type);
        slot.type = cycle[(cur + 1) % cycle.length];
        render(container);
      });

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

    wrapper.appendChild(
      createSetupStepperRow({
        label: 'WINS TO WIN',
        value: String(gameConfig.winsRequired),
        previousDisabled: gameConfig.winsRequired <= MIN_WINS,
        nextDisabled: gameConfig.winsRequired >= MAX_WINS,
        onPrevious: () => {
          if (gameConfig.winsRequired > MIN_WINS) {
            gameConfig.winsRequired--;
            render(container);
          }
        },
        onNext: () => {
          if (gameConfig.winsRequired < MAX_WINS) {
            gameConfig.winsRequired++;
            render(container);
          }
        },
      }),
    );

    // --- Round Timer stepper ---
    const timerIndex = ROUND_TIMER_OPTIONS.indexOf(gameConfig.roundTimerSeconds);
    const effectiveTimerIndex = timerIndex === -1 ? ROUND_TIMER_OPTIONS.indexOf(120) : timerIndex;
    wrapper.appendChild(
      createSetupStepperRow({
        label: 'ROUND TIMER',
        value: gameConfig.roundTimerSeconds === 0 ? 'OFF' : `${gameConfig.roundTimerSeconds}s`,
        previousDisabled: effectiveTimerIndex <= 0,
        nextDisabled: effectiveTimerIndex >= ROUND_TIMER_OPTIONS.length - 1,
        onPrevious: () => {
          if (effectiveTimerIndex > 0) {
            gameConfig.roundTimerSeconds = ROUND_TIMER_OPTIONS[effectiveTimerIndex - 1];
            render(container);
          }
        },
        onNext: () => {
          if (effectiveTimerIndex < ROUND_TIMER_OPTIONS.length - 1) {
            gameConfig.roundTimerSeconds = ROUND_TIMER_OPTIONS[effectiveTimerIndex + 1];
            render(container);
          }
        },
      }),
    );

    // --- Brick Density stepper ---
    const densityIndex = BRICK_DENSITY_OPTIONS.indexOf(gameConfig.brickDensityOverride);
    const effectiveDensityIndex = densityIndex === -1 ? 0 : densityIndex;
    wrapper.appendChild(
      createSetupStepperRow({
        label: 'BRICK DENSITY',
        value: gameConfig.brickDensityOverride === null ? 'SCHEME' : `${gameConfig.brickDensityOverride}%`,
        previousDisabled: effectiveDensityIndex <= 0,
        nextDisabled: effectiveDensityIndex >= BRICK_DENSITY_OPTIONS.length - 1,
        onPrevious: () => {
          if (effectiveDensityIndex > 0) {
            gameConfig.brickDensityOverride = BRICK_DENSITY_OPTIONS[effectiveDensityIndex - 1];
            render(container);
          }
        },
        onNext: () => {
          if (effectiveDensityIndex < BRICK_DENSITY_OPTIONS.length - 1) {
            gameConfig.brickDensityOverride = BRICK_DENSITY_OPTIONS[effectiveDensityIndex + 1];
            render(container);
          }
        },
      }),
    );

    // --- AI Difficulty stepper ---
    const difficultyIndex = AI_DIFFICULTY_OPTIONS.indexOf(gameConfig.aiDifficulty);
    const effectiveDifficultyIndex = difficultyIndex === -1 ? 1 : difficultyIndex; // default to 'normal' (index 1)
    wrapper.appendChild(
      createSetupStepperRow({
        label: 'AI DIFFICULTY',
        value: gameConfig.aiDifficulty.toUpperCase(),
        previousDisabled: effectiveDifficultyIndex <= 0,
        nextDisabled: effectiveDifficultyIndex >= AI_DIFFICULTY_OPTIONS.length - 1,
        onPrevious: () => {
          if (effectiveDifficultyIndex > 0) {
            gameConfig.aiDifficulty = AI_DIFFICULTY_OPTIONS[effectiveDifficultyIndex - 1];
            render(container);
          }
        },
        onNext: () => {
          if (effectiveDifficultyIndex < AI_DIFFICULTY_OPTIONS.length - 1) {
            gameConfig.aiDifficulty = AI_DIFFICULTY_OPTIONS[effectiveDifficultyIndex + 1];
            render(container);
          }
        },
      }),
    );

    // --- Buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'setup-btn-row';

    const startBtn = document.createElement('button');
    startBtn.className = 'setup-start-btn';
    startBtn.textContent = 'START';
    startBtn.disabled = !canStartMatch();
    startBtn.addEventListener('click', () => {
      if (!canStartMatch()) return;
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
    hint.textContent = canStartMatch()
      ? 'ESC to go back'
      : 'Need at least 2 active players';
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
      if (e.key === 'Enter') {
        if (!canStartMatch()) return;
        onTransition('gameplay');
      } else if (e.key === 'Escape') {
        onTransition('main-menu');
      }
    },
  };
}
