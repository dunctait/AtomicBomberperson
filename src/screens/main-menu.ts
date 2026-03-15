import type { GameState } from '../engine/state-machine';

const MENU_ITEMS = ['START GAME', 'OPTIONS', 'ABOUT', 'EXIT'] as const;

export function createMainMenu(
  onTransition: (state: string) => void,
): GameState {
  let selectedIndex = 0;
  let itemEls: HTMLElement[] = [];
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  let toastEl: HTMLElement | null = null;

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

      const wrapper = document.createElement('div');
      wrapper.className = 'screen menu-screen';

      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'ATOMIC BOMBERPERSON';
      wrapper.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'menu-list';

      MENU_ITEMS.forEach((label, i) => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        if (i === 0) li.classList.add('menu-item--selected');

        const cursor = document.createElement('span');
        cursor.className = 'menu-cursor';
        cursor.textContent = '\u25B6';
        li.appendChild(cursor);

        const text = document.createElement('span');
        text.textContent = label;
        li.appendChild(text);

        itemEls.push(li);
        list.appendChild(li);
      });

      wrapper.appendChild(list);
      container.appendChild(wrapper);
    },

    onExit() {
      if (toastTimeout) clearTimeout(toastTimeout);
      toastEl = null;
      itemEls = [];
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowUp') {
        selectedIndex =
          (selectedIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
        updateSelection();
      } else if (e.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % MENU_ITEMS.length;
        updateSelection();
      } else if (e.key === 'Enter') {
        const chosen = MENU_ITEMS[selectedIndex];
        if (chosen === 'START GAME') {
          onTransition('game-setup');
        } else {
          const container = itemEls[0]?.closest('.screen');
          if (container) {
            showToast(container as HTMLElement, `${chosen} - Coming Soon`);
          }
        }
      }
    },
  };
}
