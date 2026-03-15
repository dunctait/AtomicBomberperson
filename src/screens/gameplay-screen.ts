import type { GameState } from '../engine/state-machine';
import { gameConfig } from './game-config';
import { GameGrid } from '../engine/game-grid';
import { GridRenderer } from '../render/grid-renderer';
import { PlayerRenderer, PLAYER_COLORS, type PlayerVisual } from '../render/player-renderer';
import { parseScheme, type ParsedScheme } from '../assets/parsers/sch-parser';
import { getAllFileNames } from '../assets/asset-db';
import { getFile } from '../assets/asset-db';

/** Find and load a .SCH scheme file from IndexedDB */
async function loadScheme(mapName: string): Promise<ParsedScheme> {
  const allFiles = await getAllFileNames();

  // Try to find the exact map name (case-insensitive)
  const target = mapName.toUpperCase();
  let schFile = allFiles.find((f) => {
    const upper = f.toUpperCase();
    return upper.endsWith(`/${target}.SCH`) || upper.endsWith(`\\${target}.SCH`) || upper === `${target}.SCH`;
  });

  // Fallback: find any .SCH file
  if (!schFile) {
    schFile = allFiles.find((f) => f.toUpperCase().endsWith('.SCH'));
  }

  if (!schFile) {
    throw new Error('No .SCH scheme file found in assets');
  }

  const buffer = await getFile(schFile);
  if (!buffer) {
    throw new Error(`Failed to read scheme file: ${schFile}`);
  }

  const text = new TextDecoder('utf-8').decode(buffer);
  return parseScheme(text);
}

/** Create a fallback scheme when no .SCH files are available */
function createFallbackScheme(): ParsedScheme {
  const grid: number[][] = [];
  for (let r = 0; r < 11; r++) {
    const row: number[] = [];
    for (let c = 0; c < 15; c++) {
      if (r === 0 || r === 10 || c === 0 || c === 14) {
        // Border walls
        row.push(1); // Solid
      } else if (r % 2 === 0 && c % 2 === 0) {
        // Interior pillars (classic Bomberman pattern)
        row.push(1); // Solid
      } else {
        // Potential brick spots
        row.push(2); // Brick
      }
    }
    grid.push(row);
  }

  return {
    name: 'FALLBACK',
    brickDensity: 80,
    grid,
    spawns: [
      { player: 0, x: 1, y: 1, team: 0 },
      { player: 1, x: 13, y: 1, team: 0 },
      { player: 2, x: 1, y: 9, team: 0 },
      { player: 3, x: 13, y: 9, team: 0 },
    ],
    powerups: [],
  };
}

export function createGameplayScreen(
  onTransition: (state: string) => void,
): GameState {
  let canvas: HTMLCanvasElement;
  let gridRenderer: GridRenderer;
  let playerRenderer: PlayerRenderer;
  let gameGrid: GameGrid;
  let players: PlayerVisual[] = [];
  let scheme: ParsedScheme;
  let keysDown: Set<string> = new Set();
  let initialized = false;

  // Movement timing
  const MOVE_DELAY = 0.15; // seconds between moves
  let moveCooldown = 0;

  function initPlayers(): void {
    players = [];
    const activePlayers = gameConfig.players.filter((p) => p.type !== 'off');

    for (let i = 0; i < activePlayers.length; i++) {
      const spawn = scheme.spawns[i];
      players.push({
        gridX: spawn ? spawn.x : 1,
        gridY: spawn ? spawn.y : 1,
        color: PLAYER_COLORS[i] || '#FFF',
        playerIndex: i,
        alive: true,
      });
    }
  }

  function render(): void {
    if (!initialized) return;
    gridRenderer.renderGrid(gameGrid);
    for (const p of players) {
      playerRenderer.renderPlayer(
        canvas.getContext('2d')!,
        p,
        gridRenderer.tileWidth,
        gridRenderer.tileHeight,
      );
    }
  }

  function movePlayer1(dt: number): void {
    if (players.length === 0 || !players[0].alive) return;

    moveCooldown -= dt;
    if (moveCooldown > 0) return;

    const p = players[0];
    let dx = 0;
    let dy = 0;

    if (keysDown.has('ArrowLeft')) dx = -1;
    else if (keysDown.has('ArrowRight')) dx = 1;
    else if (keysDown.has('ArrowUp')) dy = -1;
    else if (keysDown.has('ArrowDown')) dy = 1;

    if (dx === 0 && dy === 0) return;

    const newCol = p.gridX + dx;
    const newRow = p.gridY + dy;

    if (gameGrid.isWalkable(newCol, newRow)) {
      p.gridX = newCol;
      p.gridY = newRow;
      moveCooldown = MOVE_DELAY;
    }
  }

  return {
    name: 'gameplay',

    onEnter(container: HTMLElement) {
      const wrapper = document.createElement('div');
      wrapper.className = 'screen gameplay-screen';

      // Loading message while we fetch the scheme
      const loadingMsg = document.createElement('p');
      loadingMsg.className = 'gameplay-loading';
      loadingMsg.textContent = 'Loading map...';
      wrapper.appendChild(loadingMsg);

      canvas = document.createElement('canvas');
      canvas.className = 'gameplay-canvas hidden';
      wrapper.appendChild(canvas);

      const hud = document.createElement('div');
      hud.className = 'gameplay-hud hidden';
      hud.innerHTML = '<span class="gameplay-map-name"></span><span class="gameplay-controls">Arrow keys to move | ESC to quit</span>';
      wrapper.appendChild(hud);

      container.appendChild(wrapper);

      // Load scheme asynchronously
      loadScheme(gameConfig.map)
        .catch(() => {
          console.warn('No .SCH file found, using fallback scheme');
          return createFallbackScheme();
        })
        .then((loadedScheme) => {
          scheme = loadedScheme;
          gameGrid = new GameGrid(scheme);

          gridRenderer = new GridRenderer(canvas);
          playerRenderer = new PlayerRenderer();

          initPlayers();
          initialized = true;

          // Show canvas, hide loading
          loadingMsg.classList.add('hidden');
          canvas.classList.remove('hidden');
          hud.classList.remove('hidden');

          // Set map name in HUD
          const mapNameEl = hud.querySelector('.gameplay-map-name');
          if (mapNameEl) {
            mapNameEl.textContent = scheme.name || gameConfig.map;
          }

          render();
        });

      keysDown = new Set();
    },

    onExit() {
      initialized = false;
      keysDown.clear();
    },

    onUpdate(dt: number) {
      if (!initialized) return;
      movePlayer1(dt);
      render();
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onTransition('main-menu');
        return;
      }
      keysDown.add(e.key);
    },

    onKeyUp(e: KeyboardEvent) {
      keysDown.delete(e.key);
    },
  };
}
