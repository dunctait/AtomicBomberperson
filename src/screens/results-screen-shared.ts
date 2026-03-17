import type { GameState } from '../engine/state-machine';
import { matchState } from '../engine/match-manager';
import { PLAYER_COLORS } from '../render/player-renderer';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';
import { gameConfig } from './game-config';

type ScoreboardOptions = {
  crownClass: string;
  crownText: string;
  highlightClass: string;
  highlightedPlayer: number;
};

type ResultsPanelSectionsOptions = ScoreboardOptions & {
  promptText: string;
};

type ResultsInteractionOptions = {
  onConfirm: ResultsTransitionHandler;
  onEscape?: ResultsTransitionHandler;
};

type ResultsScreenOptions = {
  name: string;
  screenClassName: string;
  animatedSelector: string;
  pulseAmplitude: number;
  pulseFrequency: number;
  renderContent: (content: HTMLElement) => void;
  interactions?: ResultsInteractionOptions;
};

export type ResultsTransitionGuard = () => boolean;
export type ResultsTransitionHandler = (
  consumeTransition: ResultsTransitionGuard,
) => void;
export type ResultsKeyHandler = (
  event: KeyboardEvent,
  consumeTransition: ResultsTransitionGuard,
) => void;

export function createResultsScreen(options: ResultsScreenOptions): GameState {
  let stageElements: VirtualStageElements | null = null;
  let elapsedTime = 0;
  let transitionConsumed = false;
  let pointerConfirmHandler: ((event: MouseEvent) => void) | null = null;
  const keyHandler = options.interactions
    ? createResultsKeyHandler(options.interactions)
    : null;

  function consumeTransition(): boolean {
    if (transitionConsumed) {
      return false;
    }

    transitionConsumed = true;
    return true;
  }

  function render(container: HTMLElement): void {
    if (!stageElements) {
      stageElements = mountVirtualStage(container, options.screenClassName);
    }

    const { content } = stageElements;
    if (pointerConfirmHandler) {
      content.removeEventListener('click', pointerConfirmHandler);
      pointerConfirmHandler = null;
    }

    content.innerHTML = '';
    options.renderContent(content);

    if (options.interactions) {
      pointerConfirmHandler = () => {
        options.interactions?.onConfirm(consumeTransition);
      };
      content.addEventListener('click', pointerConfirmHandler);
    }
  }

  return {
    name: options.name,

    onEnter(container: HTMLElement) {
      elapsedTime = 0;
      transitionConsumed = false;
      render(container);
    },

    onExit() {
      if (stageElements && pointerConfirmHandler) {
        stageElements.content.removeEventListener('click', pointerConfirmHandler);
      }

      pointerConfirmHandler = null;
      stageElements?.destroy();
      stageElements = null;
    },

    onUpdate(dt: number) {
      elapsedTime += dt;

      const animatedEl = stageElements?.content.querySelector(
        options.animatedSelector,
      ) as HTMLElement | null;
      if (!animatedEl) {
        return;
      }

      const scale =
        1 + options.pulseAmplitude * Math.sin(elapsedTime * options.pulseFrequency);
      animatedEl.style.transform = `scale(${scale})`;
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }

      keyHandler?.(event, consumeTransition);
    },
  };
}

export function createResultsPanel(title: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'results-panel';

  const heading = document.createElement('h2');
  heading.className = 'results-heading';
  heading.textContent = title;
  panel.appendChild(heading);

  return panel;
}

export function createResultsMessage(
  className: string,
  text: string,
  playerIndex?: number,
): HTMLDivElement {
  const message = document.createElement('div');
  message.className = className;
  message.textContent = text;

  if (playerIndex !== undefined && playerIndex >= 0) {
    const color = PLAYER_COLORS[playerIndex] || '#fff';
    message.style.color = color;
    message.style.setProperty('--player-color', color);
  }

  return message;
}

export function createResultsTarget(): HTMLDivElement {
  const target = document.createElement('div');
  target.className = 'results-target';
  target.textContent = `FIRST TO ${formatResultsCount(matchState.winsRequired, 'WIN')}`;
  return target;
}

export function createResultsScoreboard(
  options: ScoreboardOptions,
): HTMLDivElement {
  const scoreBoard = document.createElement('div');
  scoreBoard.className = 'results-scoreboard';

  for (let i = 0; i < matchState.scores.length; i += 1) {
    const color = getPlayerColor(i);
    const row = document.createElement('div');
    row.className = 'results-player-row';

    const isHighlighted = options.highlightedPlayer === i;
    if (isHighlighted) {
      row.classList.add(options.highlightClass);
    }

    row.style.setProperty('--player-color', color);

    const dot = document.createElement('span');
    dot.className = 'results-player-dot';
    dot.style.background = color;
    dot.style.boxShadow = `0 0 6px ${color}88`;
    row.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'results-player-label';
    const slotName = gameConfig.players[i]?.name;
    label.textContent = slotName ? (slotName.length > 10 ? slotName.slice(0, 10) : slotName) : `P${i + 1}`;
    applyTextColor(label, color);
    row.appendChild(label);

    row.appendChild(createResultsTally(matchState.scores[i], color));

    row.appendChild(
      createResultsTextNode(
        'span',
        'results-win-count',
        `${matchState.scores[i]}W`,
        color,
      ),
    );

    if (isHighlighted) {
      row.appendChild(
        createResultsTextNode(
          'span',
          `results-crown ${options.crownClass}`,
          options.crownText,
          color,
        ),
      );
    }

    scoreBoard.appendChild(row);
  }

  return scoreBoard;
}

export function appendResultsPanelSections(
  panel: HTMLElement,
  options: ResultsPanelSectionsOptions,
): void {
  panel.appendChild(createResultsTarget());
  panel.appendChild(createResultsScoreboard(options));
  appendResultsFooter(panel, options.promptText);
}

export function appendResultsFooter(
  panel: HTMLElement,
  promptText: string,
): void {
  const prompt = document.createElement('p');
  prompt.className = 'results-prompt';
  prompt.textContent = promptText;
  panel.appendChild(prompt);

  const hint = document.createElement('p');
  hint.className = 'results-hint';
  hint.textContent = 'CLICK/TAP to confirm | ESC to quit to menu';
  panel.appendChild(hint);
}

export function formatResultsCount(
  count: number,
  singularLabel: string,
  pluralLabel = `${singularLabel}S`,
): string {
  return `${count} ${count === 1 ? singularLabel : pluralLabel}`;
}

export function isResultsConfirmKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
}

export function createTransitionHandler(
  onTransition: (state: string) => void,
  targetState: string,
  beforeTransition?: () => void,
): ResultsTransitionHandler {
  return (consumeTransition) => {
    if (!consumeTransition()) {
      return;
    }

    beforeTransition?.();
    onTransition(targetState);
  };
}

export function createResultsKeyHandler(options: {
  onConfirm: ResultsTransitionHandler;
  onEscape?: ResultsTransitionHandler;
}): ResultsKeyHandler {
  return (event, consumeTransition) => {
    if (event.key === 'Escape') {
      options.onEscape?.(consumeTransition);
      return;
    }

    if (isResultsConfirmKey(event.key)) {
      options.onConfirm(consumeTransition);
    }
  };
}

function createResultsTally(score: number, color: string): HTMLSpanElement {
  const tally = document.createElement('span');
  tally.className = 'results-tally';

  for (let w = 0; w < matchState.winsRequired; w += 1) {
    const filled = w < score;
    tally.appendChild(createResultsTallyMark(filled, color));
  }

  return tally;
}

function createResultsTallyMark(
  filled: boolean,
  color: string,
): HTMLSpanElement {
  const tallyMark = document.createElement('span');
  tallyMark.className = 'results-tally-mark';

  if (filled) {
    tallyMark.classList.add('results-tally-mark--filled');
    tallyMark.style.background = color;
    tallyMark.style.boxShadow = `0 0 6px ${color}`;
  }

  return tallyMark;
}

function createResultsTextNode<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
  color?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;

  if (color) {
    applyTextColor(element, color);
  }

  return element;
}

function applyTextColor(element: HTMLElement, color: string): void {
  element.style.color = color;
}

function getPlayerColor(playerIndex: number): string {
  return PLAYER_COLORS[playerIndex] || '#fff';
}
