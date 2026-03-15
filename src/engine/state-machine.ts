export interface GameState {
  name: string;
  onEnter(container: HTMLElement): void;
  onExit(): void;
  onUpdate?(dt: number): void;
  onKeyDown?(e: KeyboardEvent): void;
  onKeyUp?(e: KeyboardEvent): void;
}

export class StateMachine {
  private currentState: GameState | null = null;
  private states: Map<string, GameState> = new Map();
  private container: HTMLElement;
  private animFrameId: number = 0;
  private lastTime: number = 0;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    this.boundKeyDown = (e: KeyboardEvent) => {
      this.currentState?.onKeyDown?.(e);
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
      this.currentState?.onKeyUp?.(e);
    };
  }

  register(state: GameState): void {
    this.states.set(state.name, state);
  }

  transition(stateName: string): void {
    const next = this.states.get(stateName);
    if (!next) {
      throw new Error(`StateMachine: unknown state "${stateName}"`);
    }

    if (this.currentState) {
      this.currentState.onExit();
    }

    this.container.innerHTML = '';
    this.currentState = next;
    this.currentState.onEnter(this.container);
  }

  start(initialState: string): void {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);

    this.lastTime = performance.now();
    this.transition(initialState);
    this.loop(performance.now());
  }

  stop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);

    if (this.currentState) {
      this.currentState.onExit();
      this.currentState = null;
    }
  }

  private loop = (now: number): void => {
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    this.currentState?.onUpdate?.(dt);

    this.animFrameId = requestAnimationFrame(this.loop);
  };
}
