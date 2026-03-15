import type { GameState } from '../engine/state-machine';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';
import { applyBakedStageArt } from '../ui/baked-stage-art';

export function createTitleScreen(
  onTransition: (state: string) => void,
): GameState {
  let stageElements: VirtualStageElements | null = null;
  let autoAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;

  return {
    name: 'title-screen',

    onEnter(container: HTMLElement) {
      stageElements = mountVirtualStage(container, 'title-screen');
      const { stage, content } = stageElements;

      const title = document.createElement('h1');
      title.className = 'title-glow';
      title.textContent = 'ATOMIC BOMBERPERSON';
      content.appendChild(title);

      const subtitle = document.createElement('p');
      subtitle.className = 'title-prompt';
      subtitle.textContent = 'Press ENTER to start';
      content.appendChild(subtitle);

      applyBakedStageArt({
        stage,
        assetName: 'TITLE.PCX',
        bakedClassName: 'title-screen--baked-art',
        hiddenElements: [title, subtitle],
      });

      // Show splash briefly, then enter menu automatically.
      autoAdvanceTimeout = setTimeout(() => {
        onTransition('main-menu');
      }, 1000);
    },

    onExit() {
      if (autoAdvanceTimeout) {
        clearTimeout(autoAdvanceTimeout);
        autoAdvanceTimeout = null;
      }
      stageElements?.destroy();
      stageElements = null;
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        onTransition('main-menu');
      }
    },
  };
}
