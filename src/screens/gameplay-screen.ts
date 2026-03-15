import type { GameState } from '../engine/state-machine';
import { gameConfig } from './game-config';
import { GameGrid } from '../engine/game-grid';
import { GridRenderer } from '../render/grid-renderer';
import { PlayerRenderer, PLAYER_COLORS } from '../render/player-renderer';
import { Player } from '../engine/player';
import { InputManager } from '../engine/input-manager';
import { BombManager } from '../engine/bomb';
import { BombRenderer } from '../render/bomb-renderer';
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
  let bombManager: BombManager;
  let bombRenderer: BombRenderer;
  let gameGrid: GameGrid;
  let players: Player[] = [];
  let inputManager: InputManager;
  let scheme: ParsedScheme;
  let initialized = false;
  let elapsedTime = 0;

  function initPlayers(): void {
    players = [];
    const configPlayers = gameConfig.players.filter((p) => p.type !== 'off');

    for (let i = 0; i < configPlayers.length; i++) {
      const spawn = scheme.spawns[i];
      const spawnX = spawn ? spawn.x : 1;
      const spawnY = spawn ? spawn.y : 1;
      const player = new Player(i, configPlayers[i].type, spawnX, spawnY);
      players.push(player);
    }

    inputManager = new InputManager(players);
  }

  function render(): void {
    if (!initialized) return;
    const ctx = canvas.getContext('2d')!;

    // Draw the grid
    gridRenderer.renderGrid(gameGrid);

    // Draw explosions (behind players and bombs)
    bombRenderer.renderExplosions(ctx, bombManager.explosions, gridRenderer.tileWidth, gridRenderer.tileHeight);

    // Draw bombs
    bombRenderer.renderBombs(ctx, bombManager.bombs, gridRenderer.tileWidth, gridRenderer.tileHeight, elapsedTime);

    // Draw players
    for (const p of players) {
      playerRenderer.renderPlayer(ctx, p, gridRenderer.tileWidth, gridRenderer.tileHeight);
    }
  }

  function handleBombPlacement(): void {
    for (const p of players) {
      if (!p.alive || !p.inputBomb) continue;

      // Count active bombs for this player
      p.stats.activeBombs = bombManager.bombs.filter(
        (b) => !b.exploded && b.owner === p.index,
      ).length;

      if (p.stats.activeBombs >= p.stats.maxBombs) continue;

      const { col, row } = p.getGridPos();

      if (bombManager.placeBomb(col, row, p.index, p.stats.bombRange)) {
        p.stats.activeBombs++;
      }

      // Clear the bomb input so it only fires once per press
      p.inputBomb = false;
    }
  }

  function checkPlayerDeaths(): void {
    for (const p of players) {
      if (!p.alive) continue;
      const { col, row } = p.getGridPos();
      if (bombManager.isExploding(col, row)) {
        p.die();
      }
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
      hud.innerHTML = '<span class="gameplay-map-name"></span><span class="gameplay-controls">Arrow keys to move | SPACE to bomb | ESC to quit</span>';
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
          bombManager = new BombManager();
          bombRenderer = new BombRenderer();

          initPlayers();
          initialized = true;
          elapsedTime = 0;

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
    },

    onExit() {
      initialized = false;
    },

    onUpdate(dt: number) {
      if (!initialized) return;

      elapsedTime += dt;

      // Handle bomb placement
      handleBombPlacement();

      // Update all players (smooth movement)
      for (const p of players) {
        p.update(dt, gameGrid);
      }

      // Update bombs and explosions
      bombManager.update(dt, gameGrid);

      // Check if any player was killed by explosion
      checkPlayerDeaths();

      // Update active bomb counts per player
      for (const p of players) {
        p.stats.activeBombs = bombManager.bombs.filter(
          (b) => !b.exploded && b.owner === p.index,
        ).length;
      }

      render();
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onTransition('main-menu');
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
      }
      if (initialized) {
        inputManager.onKeyDown(e);
      }
    },

    onKeyUp(e: KeyboardEvent) {
      if (initialized) {
        inputManager.onKeyUp(e);
      }
    },
  };
}
