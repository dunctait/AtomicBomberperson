import { Player } from './player';

export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  bomb: string;
  /** Optional alternate bomb key (e.g. Shift as alternative to E). */
  bombAlt?: string;
}

export const DEFAULT_BINDINGS: KeyBindings[] = [
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: ' ' },
  { up: 'w', down: 's', left: 'a', right: 'd', bomb: 'e', bombAlt: 'Shift' },
  { up: 'i', down: 'k', left: 'j', right: 'l', bomb: 'u' },
  { up: '8', down: '5', left: '4', right: '6', bomb: '0' },
];

export class InputManager {
  private players: Player[];
  private bindings: KeyBindings[];

  constructor(players: Player[], bindings?: KeyBindings[]) {
    this.players = players;
    this.bindings = bindings ?? DEFAULT_BINDINGS;
  }

  onKeyDown(e: KeyboardEvent): void {
    this.routeKey(e.key, true);
  }

  onKeyUp(e: KeyboardEvent): void {
    this.routeKey(e.key, false);
  }

  private routeKey(key: string, pressed: boolean): void {
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      if (player.type !== 'human') continue;

      const binding = this.bindings[i];
      if (!binding) continue;

      if (key === binding.up)    { player.setInput('up', pressed); return; }
      if (key === binding.down)  { player.setInput('down', pressed); return; }
      if (key === binding.left)  { player.setInput('left', pressed); return; }
      if (key === binding.right) { player.setInput('right', pressed); return; }
      if (key === binding.bomb)  { player.setInput('bomb', pressed); return; }
      if (binding.bombAlt && key === binding.bombAlt) { player.setInput('bomb', pressed); return; }
    }
  }
}
