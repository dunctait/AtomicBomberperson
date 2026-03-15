import type { GameState } from '../engine/state-machine';
import { mountVirtualStage, type VirtualStageElements } from '../ui/virtual-stage';
import { applyBakedStageArt } from '../ui/baked-stage-art';

interface MenuItemDefinition {
  label: string;
  onSelect?: () => void;
}

const BAKED_MENU_ROW_TOPS = [110, 147, 184, 221, 258, 295, 332] as const;

export function createMainMenu(
  onTransition: (state: string) => void,
): GameState {
  const menuItems: MenuItemDefinition[] = [
    {
      label: 'START GAME',
      onSelect: () => onTransition('game-setup'),
    },
    {
      label: 'START NETWORK GAME',
    },
    {
      label: 'JOIN NETWORK GAME',
    },
    {
      label: 'OPTIONS',
    },
    {
      label: 'ABOUT BOMBERMAN',
    },
    {
      label: 'ONLINE MANUAL',
    },
    {
      label: 'EXIT BOMBERMAN',
      onSelect: () => {},
    },
  ];
  let selectedIndex = 0;
  let itemEls: HTMLElement[] = [];
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  let toastEl: HTMLElement | null = null;
  let stageElements: VirtualStageElements | null = null;

  function updateSelection() {
    itemEls.forEach((el, i) => {
      el.classList.toggle('menu-item--selected', i === selectedIndex);
    });
  }

  function showToast(container: HTMLElement, msg: string) {
    if (toastTimeout) clearTimeout(toastTimeout);
    if (toastEl) toastEl.remove();

    toastEl = document.createElement('p');
    toastEl.className = 'menu-toast';
    toastEl.textContent = msg;
    container.appendChild(toastEl);

    toastTimeout = setTimeout(() => {
      toastEl?.remove();
      toastEl = null;
    }, 1500);
  }

  return {
    name: 'main-menu',

    onEnter(container: HTMLElement) {
      selectedIndex = 0;
      itemEls = [];
      stageElements = mountVirtualStage(container, 'menu-screen');
      const { stage, content } = stageElements;

      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'ATOMIC BOMBERPERSON';
      content.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'menu-list';
      const labelEls: HTMLElement[] = [];

      menuItems.forEach((item, i) => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        if (i === 0) li.classList.add('menu-item--selected');
        if (!item.onSelect) li.classList.add('menu-item--locked');
        li.style.setProperty('--menu-row-top', `${BAKED_MENU_ROW_TOPS[i]}px`);
        li.setAttribute('aria-label', item.label);
        li.setAttribute('aria-disabled', String(!item.onSelect));

        const cursor = document.createElement('span');
        cursor.className = 'menu-cursor';
        cursor.textContent = '\u25B6';
        li.appendChild(cursor);

        const highlight = document.createElement('span');
        highlight.className = 'menu-highlight';
        li.appendChild(highlight);

        const text = document.createElement('span');
        text.className = 'menu-item-label';
        text.textContent = item.label;
        labelEls.push(text);
        li.appendChild(text);

        if (!item.onSelect) {
          const lock = document.createElement('span');
          lock.className = 'menu-lock';
          lock.setAttribute('aria-hidden', 'true');
          li.appendChild(lock);
        }

        li.addEventListener('click', () => {
          selectedIndex = i;
          updateSelection();
          if (item.onSelect) {
            item.onSelect();
          } else if (stageElements) {
            showToast(stageElements.stage, `${item.label} locked`);
          }
        });

        itemEls.push(li);
        list.appendChild(li);
      });

      content.appendChild(list);

      applyBakedStageArt({
        stage,
        assetName: 'MAINMENU.PCX',
        bakedClassName: 'menu-screen--baked-art',
        hiddenElements: [title, ...labelEls],
      });
    },

    onExit() {
      if (toastTimeout) clearTimeout(toastTimeout);
      toastEl = null;
      itemEls = [];
      stageElements?.destroy();
      stageElements = null;
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        for (let step = 1; step < menuItems.length; step++) {
          const next = (selectedIndex + dir * step + menuItems.length) % menuItems.length;
          if (menuItems[next].onSelect) {
            selectedIndex = next;
            break;
          }
        }
        updateSelection();
      } else if (e.key === 'Enter') {
        const chosen = menuItems[selectedIndex];
        if (chosen.onSelect) {
          chosen.onSelect();
        }
      }
    },
  };
}
