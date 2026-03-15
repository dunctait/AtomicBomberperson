import type { GameState } from '../engine/state-machine';
import { assets } from '../assets/asset-registry';

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

      // Try to load TITLE.PCX as the background image
      assets.getImage('TITLE.PCX').then((canvas) => {
        // Only apply if this screen is still mounted
        if (!wrapper.isConnected) return;

        const dataURL = canvas.toDataURL();
        wrapper.style.backgroundImage = `url(${dataURL})`;
        wrapper.style.backgroundSize = 'cover';
        wrapper.style.backgroundPosition = 'center';
      }).catch(() => {
        // Asset not available — keep the CSS-only title screen
      });
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
