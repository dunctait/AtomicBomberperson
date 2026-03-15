import type { GameState } from '../engine/state-machine';
import { gameConfig } from './game-config';

export function createGameplayPlaceholder(
  onTransition: (state: string) => void,
): GameState {
  return {
    name: 'gameplay',

    onEnter(container: HTMLElement) {
      const wrapper = document.createElement('div');
      wrapper.className = 'screen gameplay-placeholder-screen';

      const title = document.createElement('h1');
      title.className = 'gameplay-title';
      title.textContent = 'GAME STARTING...';
      wrapper.appendChild(title);

      const info = document.createElement('div');
      info.className = 'gameplay-info';

      const activePlayers = gameConfig.players.filter(
        (p) => p.type !== 'off',
      );
      const humans = activePlayers.filter((p) => p.type === 'human').length;
      const ais = activePlayers.filter((p) => p.type === 'ai').length;

      const lines = [
        `Players: ${activePlayers.length} (${humans} Human, ${ais} AI)`,
        `Map: ${gameConfig.map}`,
      ];

      lines.forEach((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        info.appendChild(p);
      });

      wrapper.appendChild(info);

      const hint = document.createElement('p');
      hint.className = 'gameplay-hint';
      hint.textContent = 'Press ESC to return to menu';
      wrapper.appendChild(hint);

      container.appendChild(wrapper);
    },

    onExit() {
      // nothing to clean up
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onTransition('main-menu');
      }
    },
  };
}
