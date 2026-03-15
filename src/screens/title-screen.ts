import type { GameState } from '../engine/state-machine';

export function createTitleScreen(
  onTransition: (state: string) => void,
): GameState {
  return {
    name: 'title-screen',

    onEnter(container: HTMLElement) {
      const wrapper = document.createElement('div');
      wrapper.className = 'screen title-screen';

      const title = document.createElement('h1');
      title.className = 'title-glow';
      title.textContent = 'ATOMIC BOMBERPERSON';
      wrapper.appendChild(title);

      const subtitle = document.createElement('p');
      subtitle.className = 'title-prompt';
      subtitle.textContent = 'Press ENTER to start';
      wrapper.appendChild(subtitle);

      container.appendChild(wrapper);
    },

    onExit() {
      // nothing to clean up
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        onTransition('main-menu');
      }
    },
  };
}
