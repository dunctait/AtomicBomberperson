const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 480;

export interface VirtualStageElements {
  shell: HTMLDivElement;
  stage: HTMLDivElement;
  content: HTMLDivElement;
  destroy(): void;
}

export function mountVirtualStage(
  container: HTMLElement,
  screenClass: string,
): VirtualStageElements {
  const shell = document.createElement('div');
  shell.className = 'stage-shell';

  const stage = document.createElement('div');
  stage.className = `screen stage-screen ${screenClass}`;

  const content = document.createElement('div');
  content.className = 'stage-content';

  stage.appendChild(content);
  shell.appendChild(stage);
  container.appendChild(shell);

  const updateScale = (): void => {
    const { width, height } = shell.getBoundingClientRect();
    const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    stage.style.setProperty('--stage-scale', String(Math.max(scale, 0.1)));
  };

  updateScale();
  window.addEventListener('resize', updateScale);

  return {
    shell,
    stage,
    content,
    destroy() {
      window.removeEventListener('resize', updateScale);
    },
  };
}
