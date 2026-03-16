import type { GameState } from '../engine/state-machine';
import { gameConfig } from './game-config';
import {
  matchState,
  resetMatch,
  recordRoundResult,
  isMatchOver,
  clearMatchProgress,
} from '../engine/match-manager';
import { CellContent, GameGrid } from '../engine/game-grid';
import { GridRenderer } from '../render/grid-renderer';
import { PlayerRenderer, PLAYER_COLORS } from '../render/player-renderer';
import { Player } from '../engine/player';
import { InputManager } from '../engine/input-manager';
import { BombManager, type BombEvents } from '../engine/bomb';
import { BombRenderer } from '../render/bomb-renderer';
import { PowerupManager, applyPowerup, applySchemeStartingInventory } from '../engine/powerup';
import { PowerupRenderer } from '../render/powerup-renderer';
import { AIBot } from '../engine/ai-bot';
import { parseScheme, TileType, type ParsedScheme } from '../assets/parsers/sch-parser';
import { getAllFileNames, getFile } from '../assets/asset-db';
import { soundManager } from '../engine/sound-manager';
import { ParticleSystem } from '../engine/particles';

interface GameplayMapMeta {
  name: string;
  source: string;
  loadingLabel: string;
}

interface GameplaySchemeSummary {
  detailLabel: string;
  templateLabel: string;
  layoutLabel: string;
  spawnLabel: string;
  inventoryLabel: string;
}

interface GameplayHudElements {
  root: HTMLDivElement;
  mapName: HTMLSpanElement;
  mapSource: HTMLSpanElement;
  schemeSummary: HTMLSpanElement;
  templateSummary: HTMLSpanElement;
  layoutSummary: HTMLSpanElement;
  spawnSummary: HTMLSpanElement;
  inventorySummary: HTMLSpanElement;
}

type GameplayHudSummaryKey =
  | 'schemeSummary'
  | 'templateSummary'
  | 'layoutSummary'
  | 'spawnSummary'
  | 'inventorySummary';

type GameplayHudSummaryDefinition = {
  key: GameplayHudSummaryKey;
  summaryKey: keyof GameplaySchemeSummary;
  className: string;
};

type GameplayHudPowerupDefinition = {
  enabled: (player: Player) => boolean;
  label: string;
  title: string;
  className?: string;
};

const GAMEPLAY_HUD_SUMMARY_DEFINITIONS: GameplayHudSummaryDefinition[] = [
  {
    key: 'schemeSummary',
    summaryKey: 'detailLabel',
    className: 'gameplay-scheme-summary',
  },
  {
    key: 'templateSummary',
    summaryKey: 'templateLabel',
    className: 'gameplay-template-summary',
  },
  {
    key: 'layoutSummary',
    summaryKey: 'layoutLabel',
    className: 'gameplay-layout-summary',
  },
  {
    key: 'spawnSummary',
    summaryKey: 'spawnLabel',
    className: 'gameplay-spawn-summary',
  },
  {
    key: 'inventorySummary',
    summaryKey: 'inventoryLabel',
    className: 'gameplay-inventory-summary',
  },
];

const GAMEPLAY_HUD_POWERUPS: GameplayHudPowerupDefinition[] = [
  { enabled: (player) => player.stats.canKick, label: 'K', title: 'Kick' },
  { enabled: (player) => player.stats.canPunch, label: 'P', title: 'Punch' },
  { enabled: (player) => player.stats.canGrab, label: 'G', title: 'Grab' },
  { enabled: (player) => player.stats.hasTrigger, label: 'T', title: 'Trigger' },
  { enabled: (player) => player.stats.hasJelly, label: 'J', title: 'Jelly' },
  { enabled: (player) => player.hasSlowDisease(), label: 'SL', title: 'Slow disease', className: 'hud-powerup--danger' },
  { enabled: (player) => player.hasReverseDisease(), label: 'RV', title: 'Reverse controls disease', className: 'hud-powerup--danger' },
];

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function mergeBombEvents(target: BombEvents, source: BombEvents | null): void {
  if (!source) {
    return;
  }

  target.bricksDestroyed.push(...source.bricksDestroyed);
  target.explosionPositions.push(...source.explosionPositions);
}

export function getGameplayMapMeta(
  selectedMapName: string,
  selectedMapFile: string | null,
  schemeName?: string,
  usedFallback = false,
): GameplayMapMeta {
  const resolvedName = (schemeName && schemeName.trim()) || selectedMapName;

  if (usedFallback) {
    return {
      name: resolvedName,
      source: 'AUTO FALLBACK SCHEME',
      loadingLabel: `Loading fallback map ${resolvedName}...`,
    };
  }

  if (selectedMapFile) {
    return {
      name: resolvedName,
      source: `IMPORTED ${basename(selectedMapFile).toUpperCase()}`,
      loadingLabel: `Loading imported map ${selectedMapName}...`,
    };
  }

  return {
    name: resolvedName,
    source: 'DEFAULT SCHEME',
    loadingLabel: `Loading map ${selectedMapName}...`,
  };
}

/** Resolve the selected .SCH file from IndexedDB using the explicit setup selection first. */
export async function resolveSchemeFile(
  mapName: string,
  selectedFile: string | null,
): Promise<string> {
  const allFiles = await getAllFileNames();

  if (selectedFile) {
    const exactFile = allFiles.find(
      (file) => file.toUpperCase() === selectedFile.toUpperCase(),
    );
    if (exactFile) {
      return exactFile;
    }
  }

  const target = mapName.toUpperCase();
  const schFile =
    allFiles.find((file) => {
      const upper = file.toUpperCase();
      return (
        upper.endsWith(`/${target}.SCH`) ||
        upper.endsWith(`\\${target}.SCH`) ||
        upper === `${target}.SCH`
      );
    }) ??
    allFiles.find((file) => file.toUpperCase().endsWith('.SCH'));

  if (!schFile) {
    throw new Error('No .SCH scheme file found in assets');
  }

  return schFile;
}

/** Find and load a .SCH scheme file from IndexedDB */
async function loadScheme(mapName: string, selectedFile: string | null): Promise<ParsedScheme> {
  const schFile = await resolveSchemeFile(mapName, selectedFile);

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
    conveyors: [],
    warps: [],
  };
}

function countGeneratedBricks(gameGrid: GameGrid): number {
  let brickCount = 0;
  for (const row of gameGrid.cells) {
    for (const cell of row) {
      if (cell.type === CellContent.Brick) {
        brickCount += 1;
      }
    }
  }
  return brickCount;
}

function countSchemeTiles(scheme: ParsedScheme): { open: number; solid: number; brick: number } {
  let open = 0;
  let solid = 0;
  let brick = 0;

  for (const row of scheme.grid) {
    for (const tile of row) {
      if (tile === TileType.Solid) {
        solid += 1;
      } else if (tile === TileType.Brick) {
        brick += 1;
      } else {
        open += 1;
      }
    }
  }

  return { open, solid, brick };
}

function getConveyorDirectionSummary(scheme: ParsedScheme): string {
  if (scheme.conveyors.length === 0) {
    return 'CONVEYORS 0';
  }

  const counts = {
    up: 0,
    down: 0,
    left: 0,
    right: 0,
  };

  for (const conveyor of scheme.conveyors) {
    counts[conveyor.direction] += 1;
  }

  const detail = [
    ['U', counts.up],
    ['D', counts.down],
    ['L', counts.left],
    ['R', counts.right],
  ]
    .filter(([, count]) => (count as number) > 0)
    .map(([label, count]) => `${label}${count}`)
    .join('/');

  return `CONVEYORS ${scheme.conveyors.length} (${detail})`;
}

function getWarpLinkSummary(scheme: ParsedScheme): string {
  if (scheme.warps.length === 0) {
    return 'WARPS 0';
  }

  const targetCounts = new Map<number, number>();
  for (const warp of scheme.warps) {
    targetCounts.set(warp.target, (targetCounts.get(warp.target) ?? 0) + 1);
  }

  const detail = Array.from(targetCounts.entries())
    .sort(([left], [right]) => left - right)
    .map(([target, count]) => `>${target}:${count}`)
    .join('/');

  return `WARPS ${scheme.warps.length} (${detail})`;
}

function getSpawnForPlayerSlot(
  activeScheme: ParsedScheme,
  slotIndex: number,
): ParsedScheme['spawns'][number] | null {
  return (
    activeScheme.spawns.find((spawn) => spawn.player === slotIndex) ??
    activeScheme.spawns[slotIndex] ??
    null
  );
}

function getGameplaySpawnSummary(activePlayers: Player[], activeScheme: ParsedScheme): string {
  return activePlayers
    .map((player) => {
      const spawn = getSpawnForPlayerSlot(activeScheme, player.index);
      const x = spawn?.x ?? 1;
      const y = spawn?.y ?? 1;
      const teamSuffix = spawn ? ` T${spawn.team + 1}` : '';
      return `P${player.index + 1} @ ${x},${y}${teamSuffix}`;
    })
    .join(' | ');
}

function formatNamedList(
  label: string,
  entries: Array<{ name: string; value: number }>,
  entryFormatter: (entry: { name: string; value: number }) => string,
): string {
  if (entries.length === 0) {
    return `${label} NONE`;
  }

  return `${label} ${entries.map(entryFormatter).join(', ')}`;
}

function formatNamedCountList(
  label: string,
  entries: Array<{ name: string; value: number }>,
): string {
  return formatNamedList(label, entries, (entry) => `${entry.name.toUpperCase()} x${entry.value}`);
}

function formatNamedValueList(
  label: string,
  entries: Array<{ name: string; value: number }>,
): string {
  return formatNamedList(label, entries, (entry) => `${entry.name.toUpperCase()}=${entry.value}`);
}

function createGameplayHudLine(className: string): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = className;
  return line;
}

function renderFullscreenOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha: number,
): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, width, height);
}

function renderCenteredOverlayText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fillStyle: string,
  shadowColor = 'transparent',
  shadowBlur = 0,
): void {
  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;
  ctx.fillText(text, x, y);
}

function resetOverlayTextEffects(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function appendGameplayHudSummaries(
  container: HTMLElement,
): Record<GameplayHudSummaryKey, HTMLSpanElement> {
  const lines = {} as Record<GameplayHudSummaryKey, HTMLSpanElement>;

  for (const definition of GAMEPLAY_HUD_SUMMARY_DEFINITIONS) {
    const line = createGameplayHudLine(definition.className);
    container.appendChild(line);
    lines[definition.key] = line;
  }

  return lines;
}

function setGameplayHudSummary(
  hudElement: HTMLSpanElement,
  label: string | undefined,
): void {
  hudElement.textContent = label ?? '';
}

function getPlayerHudPowerupBadges(player: Player): string {
  return GAMEPLAY_HUD_POWERUPS
    .filter((powerup) => powerup.enabled(player))
    .map(
      (powerup) =>
        `<span class="hud-powerup ${powerup.className ?? ''}" title="${powerup.title}">${powerup.label}</span>`,
    )
    .join('');
}

export function renderPlayerHudRow(player: Player): string {
  const color = PLAYER_COLORS[player.index] || '#FFF';
  const opacity = player.alive ? '1' : '0.35';
  const status = player.alive ? '' : ' (DEAD)';
  const stats = player.alive
    ? [
        `<span class="hud-stat" title="Bombs">B:${player.stats.maxBombs}</span>`,
        `<span class="hud-stat" title="Flame range">F:${player.stats.bombRange}</span>`,
        `<span class="hud-stat" title="Speed">S:${player.stats.speed.toFixed(1)}</span>`,
        getPlayerHudPowerupBadges(player),
      ].join('')
    : '';

  return [
    `<div class="hud-player" style="opacity:${opacity}">`,
    `<span class="hud-player-dot" style="background:${color}"></span>`,
    `<span class="hud-player-label">P${player.index + 1}${status}</span>`,
    stats,
    '</div>',
  ].join('');
}

function getGameplaySchemeSummary(
  scheme: ParsedScheme,
  gameGrid: GameGrid,
  hiddenPowerupCount: number,
  activePlayers: Player[],
): GameplaySchemeSummary {
  const spawnCount = scheme.spawns.length;
  const teamCount = new Set(scheme.spawns.map((spawn) => spawn.team)).size;
  const forbiddenPowerups = scheme.powerups.filter((powerup) => powerup.forbidden).length;
  const allowedPowerups = scheme.powerups.length - forbiddenPowerups;
  const schemeTiles = countSchemeTiles(scheme);
  const brickCount = countGeneratedBricks(gameGrid);
  const bornWithPowerups = scheme.powerups
    .filter((powerup) => powerup.bornWith > 0)
    .map((powerup) => ({ name: powerup.name, value: powerup.bornWith }));
  const overridePowerups = scheme.powerups
    .filter((powerup) => powerup.hasOverride)
    .map((powerup) => ({ name: powerup.name, value: powerup.overrideValue }));

  const detailParts = [`SPAWNS ${spawnCount}`];
  if (teamCount > 1) {
    detailParts.push(`TEAMS ${teamCount}`);
  }

  if (scheme.powerups.length === 0) {
    detailParts.push('POWERUPS DEFAULT');
  } else {
    detailParts.push(`POWERUPS ${allowedPowerups} ON / ${forbiddenPowerups} OFF`);
  }
  detailParts.push(getConveyorDirectionSummary(scheme));
  detailParts.push(getWarpLinkSummary(scheme));

  return {
    detailLabel: detailParts.join(' | '),
    templateLabel: `BASE OPEN ${schemeTiles.open} | SOLID ${schemeTiles.solid} | PRESET BRICKS ${schemeTiles.brick}`,
    layoutLabel: `BRICKS ${brickCount} | TARGET ${scheme.brickDensity}% | CLEARED ${gameGrid.spawnClearedBrickCount} | HIDDEN POWERUPS ${hiddenPowerupCount}`,
    spawnLabel: getGameplaySpawnSummary(activePlayers, scheme),
    inventoryLabel: [
      formatNamedCountList('START WITH', bornWithPowerups),
      formatNamedValueList('OVERRIDES', overridePowerups),
    ].join(' | '),
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
  let powerupManager: PowerupManager;
  let powerupRenderer: PowerupRenderer;
  let particleSystem: ParticleSystem;
  let gameGrid: GameGrid;
  let players: Player[] = [];
  let aiBots: AIBot[] = [];
  let inputManager: InputManager;
  let scheme: ParsedScheme;
  let initialized = false;
  let elapsedTime = 0;
  let currentMapMeta = getGameplayMapMeta(gameConfig.map, gameConfig.mapFile);

  // Countdown state
  let countdownActive = false;
  let countdownTimer = 0;
  const COUNTDOWN_READY_DURATION = 1.5;
  const COUNTDOWN_GO_DURATION = 0.5;
  const COUNTDOWN_TOTAL = COUNTDOWN_READY_DURATION + COUNTDOWN_GO_DURATION;

  // Screen shake state
  let shakeX = 0;
  let shakeY = 0;
  let shakeIntensity = 0; // current intensity in pixels, decays to 0
  const SHAKE_DECAY_RATE = 9; // pixels per second decay
  const SHAKE_BASE_INTENSITY = 0.5; // base px per explosion
  const SHAKE_MAX_INTENSITY = 1.5; // hard cap

  // Win condition state
  let gameOver = false;
  let gameOverTimer = 0;
  let gameOverMessage = '';
  let gameOverWinnerIndex = -1;
  const GAME_OVER_DELAY = 3.0; // seconds before going to round results

  // HUD element reference
  let hudStatsEl: HTMLDivElement | null = null;
  let gameplayHud: GameplayHudElements | null = null;

  function initPlayers(): void {
    players = [];
    aiBots = [];
    const configPlayers = gameConfig.players.filter((p) => p.type !== 'off');

    for (let i = 0; i < configPlayers.length; i++) {
      const spawn = getSpawnForPlayerSlot(scheme, i);
      const spawnX = spawn ? spawn.x : 1;
      const spawnY = spawn ? spawn.y : 1;
      const player = new Player(i, configPlayers[i].type, spawnX, spawnY);
      applySchemeStartingInventory(player, scheme.powerups);
      players.push(player);

      // Create AI controller for AI players
      if (configPlayers[i].type === 'ai') {
        aiBots.push(new AIBot(player));
      }
    }

    inputManager = new InputManager(players);
  }

  function render(): void {
    if (!initialized) return;
    const ctx = canvas.getContext('2d')!;

    // Apply screen shake offset
    ctx.save();
    // Keep shake pixel-aligned to avoid subpixel sampling speckles on pixel-art tiles.
    const snapShakeX = Math.round(shakeX);
    const snapShakeY = Math.round(shakeY);
    ctx.translate(snapShakeX, snapShakeY);
    ctx.imageSmoothingEnabled = false;

    // Draw the grid
    gridRenderer.renderGrid(gameGrid);

    // Draw revealed powerups (after grid, before players)
    powerupRenderer.renderPowerups(
      ctx,
      powerupManager.powerups,
      gridRenderer.tileWidth,
      gridRenderer.tileHeight,
    );

    // Draw explosions (behind players and bombs)
    bombRenderer.renderExplosions(ctx, bombManager.explosions, gridRenderer.tileWidth, gridRenderer.tileHeight);

    // Draw bombs
    bombRenderer.renderBombs(ctx, bombManager.bombs, gridRenderer.tileWidth, gridRenderer.tileHeight, elapsedTime);

    // Draw players
    for (const p of players) {
      playerRenderer.renderPlayer(ctx, p, gridRenderer.tileWidth, gridRenderer.tileHeight, elapsedTime);
    }

    // Draw transient sparks/debris in world space so they inherit screen shake.
    particleSystem.render(ctx, 0, 0, gridRenderer.tileWidth, gridRenderer.tileHeight);

    // Restore from screen shake before drawing overlays (they shouldn't shake)
    ctx.restore();

    // Draw countdown overlay
    if (countdownActive) {
      renderCountdownOverlay(ctx);
    }

    // Draw game over overlay
    if (gameOver) {
      renderGameOverOverlay(ctx);
    }
  }

  function renderGameOverOverlay(ctx: CanvasRenderingContext2D): void {
    const w = canvas.width;
    const h = canvas.height;

    renderFullscreenOverlay(ctx, w, h, 0.6);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    renderCenteredOverlayText(
      ctx,
      gameOverMessage,
      w / 2,
      h / 2 - 10,
      'bold 24px "Press Start 2P", monospace',
      '#FFF',
    );

    const remaining = Math.max(0, Math.ceil(GAME_OVER_DELAY - gameOverTimer));
    renderCenteredOverlayText(
      ctx,
      `Continuing in ${remaining}...`,
      w / 2,
      h / 2 + 25,
      '12px "Press Start 2P", monospace',
      '#aaa',
    );
  }

  function renderCountdownOverlay(ctx: CanvasRenderingContext2D): void {
    const w = canvas.width;
    const h = canvas.height;

    renderFullscreenOverlay(ctx, w, h, 0.5);

    const text = countdownTimer < COUNTDOWN_READY_DURATION ? 'READY...' : 'GO!';
    const isGo = countdownTimer >= COUNTDOWN_READY_DURATION;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isGo) {
      renderCenteredOverlayText(
        ctx,
        text,
        w / 2,
        h / 2,
        'bold 36px "Press Start 2P", monospace',
        '#53d8fb',
        '#53d8fb',
        20,
      );
    } else {
      renderCenteredOverlayText(
        ctx,
        text,
        w / 2,
        h / 2,
        'bold 28px "Press Start 2P", monospace',
        '#e94560',
        '#e94560',
        16,
      );
    }

    resetOverlayTextEffects(ctx);

    renderCenteredOverlayText(
      ctx,
      `ROUND ${matchState.roundNumber}`,
      w / 2,
      h / 2 + 40,
      '10px "Press Start 2P", monospace',
      '#7a7a9e',
    );
  }

  function handleBombPlacement(): BombEvents {
    const triggeredEvents: BombEvents = {
      bricksDestroyed: [],
      explosionPositions: [],
    };

    for (const p of players) {
      if (!p.alive || !p.inputBomb) continue;

      recountActiveBombsForPlayer(p);

      if (p.stats.hasTrigger && p.stats.activeBombs > 0) {
        mergeBombEvents(triggeredEvents, bombManager.triggerOldestBomb(p.index, gameGrid));
      } else if (p.stats.activeBombs < p.stats.maxBombs) {
        const { col, row } = p.getGridPos();

        if (bombManager.placeBomb(col, row, p.index, p.stats.bombRange, p.stats.hasJelly)) {
          p.stats.activeBombs++;
          soundManager.play('BOMBDROP.WAV');
        }
      }

      // Clear the bomb input so it only fires once per press
      p.inputBomb = false;
    }

    return triggeredEvents;
  }

  function recountActiveBombsForPlayer(player: Player): void {
    player.stats.activeBombs = bombManager.bombs.filter(
      (bomb) => !bomb.exploded && bomb.owner === player.index,
    ).length;
  }

  function updateAllActiveBombCounts(): void {
    for (const player of players) {
      recountActiveBombsForPlayer(player);
    }
  }

  function checkPlayerDeaths(): void {
    for (const p of players) {
      if (!p.alive) continue;
      const { col, row } = p.getGridPos();
      if (bombManager.isExploding(col, row)) {
        p.die();
        soundManager.play('DIE.WAV');
      }
    }
  }

  function checkPowerupPickups(): void {
    for (const p of players) {
      if (!p.alive) continue;
      const { col, row } = p.getGridPos();
      const collected = powerupManager.collectAt(col, row);
      if (collected) {
        applyPowerup(collected.type, p);
        soundManager.play('POWERUP.WAV');
      }
    }
  }

  function checkWinCondition(): void {
    if (gameOver) return;

    const alivePlayers = players.filter((p) => p.alive);

    if (alivePlayers.length <= 1) {
      gameOver = true;
      gameOverTimer = 0;

      if (alivePlayers.length === 1) {
        const winner = alivePlayers[0];
        gameOverMessage = `PLAYER ${winner.index + 1} WINS!`;
        gameOverWinnerIndex = winner.index;
      } else {
        gameOverMessage = 'DRAW!';
        gameOverWinnerIndex = -1;
      }
    }
  }

  function updateHudStats(): void {
    if (!hudStatsEl) return;
    hudStatsEl.innerHTML = players.map(renderPlayerHudRow).join('');
  }

  function createGameplayHud(): GameplayHudElements {
    const root = document.createElement('div');
    root.className = 'gameplay-hud hidden';

    const mapMeta = document.createElement('div');
    mapMeta.className = 'gameplay-map-meta';

    const mapName = document.createElement('span');
    mapName.className = 'gameplay-map-name';
    mapMeta.appendChild(mapName);

    const mapSource = document.createElement('span');
    mapSource.className = 'gameplay-map-source';
    mapMeta.appendChild(mapSource);

    const hudSummaries = appendGameplayHudSummaries(mapMeta);

    const controls = document.createElement('span');
    controls.className = 'gameplay-controls';
    controls.textContent = 'Arrows: move | SPACE: bomb | ESC: quit';

    root.append(mapMeta, controls);
    return { root, mapName, mapSource, ...hudSummaries };
  }

  function initializeGameplaySystems(activeScheme: ParsedScheme): GameplaySchemeSummary {
    scheme = activeScheme;
    currentMapMeta = getGameplayMapMeta(
      gameConfig.map,
      gameConfig.mapFile,
      scheme.name,
      scheme.name === 'FALLBACK',
    );
    gameGrid = new GameGrid(scheme);

    gridRenderer = new GridRenderer(canvas);
    playerRenderer = new PlayerRenderer();
    bombManager = new BombManager();
    bombRenderer = new BombRenderer();
    powerupManager = new PowerupManager();
    powerupRenderer = new PowerupRenderer();
    particleSystem = new ParticleSystem();
    powerupManager.generatePowerups(gameGrid, scheme.powerups);

    initPlayers();
    initialized = true;
    elapsedTime = 0;

    return getGameplaySchemeSummary(scheme, gameGrid, powerupManager.powerups.length, players);
  }

  function revealGameplayUi(loadingMsg: HTMLParagraphElement, schemeSummary: GameplaySchemeSummary): void {
    loadingMsg.classList.add('hidden');
    canvas.classList.remove('hidden');
    gameplayHud?.root.classList.remove('hidden');
    hudStatsEl?.classList.remove('hidden');
    canvas.focus(); // ensure keyboard events reach the game

    updateMapHud(schemeSummary);
    updateHudStats();
    render();
  }

  function updateMapHud(schemeSummary?: GameplaySchemeSummary): void {
    if (!gameplayHud) return;
    gameplayHud.mapName.textContent = `MAP ${currentMapMeta.name}`;
    gameplayHud.mapSource.textContent = currentMapMeta.source;

    for (const definition of GAMEPLAY_HUD_SUMMARY_DEFINITIONS) {
      setGameplayHudSummary(
        gameplayHud[definition.key],
        schemeSummary?.[definition.summaryKey],
      );
    }
  }

  return {
    name: 'gameplay',

    onEnter(container: HTMLElement) {
      currentMapMeta = getGameplayMapMeta(gameConfig.map, gameConfig.mapFile);
      const wrapper = document.createElement('div');
      wrapper.className = 'screen gameplay-screen';

      // Loading message while we fetch the scheme
      const loadingMsg = document.createElement('p');
      loadingMsg.className = 'gameplay-loading';
      loadingMsg.textContent = currentMapMeta.loadingLabel;
      wrapper.appendChild(loadingMsg);

      canvas = document.createElement('canvas');
      canvas.className = 'gameplay-canvas hidden';
      canvas.tabIndex = 0; // make canvas focusable so key events work
      wrapper.appendChild(canvas);

      // Player stats HUD (above the bottom info bar)
      hudStatsEl = document.createElement('div');
      hudStatsEl.className = 'gameplay-player-hud hidden';
      wrapper.appendChild(hudStatsEl);

      gameplayHud = createGameplayHud();
      wrapper.appendChild(gameplayHud.root);

      container.appendChild(wrapper);

      // Reset match if first round
      if (matchState.roundNumber === 0) {
        const activeCount = gameConfig.players.filter((p) => p.type !== 'off').length;
        resetMatch(activeCount, gameConfig.winsRequired);
      }
      matchState.roundNumber++;

      // Reset game over state
      gameOver = false;
      gameOverTimer = 0;
      gameOverMessage = '';
      gameOverWinnerIndex = -1;

      // Start countdown
      countdownActive = true;
      countdownTimer = 0;

      // Load scheme asynchronously
      loadScheme(gameConfig.map, gameConfig.mapFile)
        .catch(() => {
          console.warn('No .SCH file found, using fallback scheme');
          currentMapMeta = getGameplayMapMeta(gameConfig.map, gameConfig.mapFile, 'FALLBACK', true);
          return createFallbackScheme();
        })
        .then((loadedScheme) => {
          const schemeSummary = initializeGameplaySystems(loadedScheme);
          revealGameplayUi(loadingMsg, schemeSummary);
        });
    },

    onExit() {
      particleSystem?.clear();
      initialized = false;
      hudStatsEl = null;
      gameplayHud = null;
    },

    onUpdate(dt: number) {
      if (!initialized) return;

      elapsedTime += dt;

      // Handle countdown
      if (countdownActive) {
        countdownTimer += dt;
        if (countdownTimer >= COUNTDOWN_TOTAL) {
          countdownActive = false;
        }
        render();
        return;
      }

      // If game is over, just count down and transition
      if (gameOver) {
        gameOverTimer += dt;
        if (gameOverTimer >= GAME_OVER_DELAY) {
          recordRoundResult(gameOverWinnerIndex);
          onTransition(isMatchOver() ? 'match-victory' : 'round-results');
          return;
        }
        render();
        return;
      }

      // Update AI bots (sets their input flags before movement/bomb handling)
      for (const bot of aiBots) {
        bot.update(dt, gameGrid, bombManager, powerupManager, players);
      }

      // Handle bomb placement / remote trigger input
      const triggeredEvents = handleBombPlacement();

      // Update all players (smooth movement)
      for (const p of players) {
        p.update(dt, gameGrid, bombManager);
      }

      // Update bombs and explosions -- capture events
      const events = bombManager.update(dt, gameGrid);
      mergeBombEvents(events, triggeredEvents);
      particleSystem.update(dt);

      // Play explosion sound and trigger screen shake when new explosions fire
      if (events.explosionPositions.length > 0) {
        soundManager.play('EXPLO.WAV');
        // Scale intensity with number of simultaneous explosion cells
        const added = SHAKE_BASE_INTENSITY + Math.min(events.explosionPositions.length, 5) * 0.18;
        shakeIntensity = Math.min(shakeIntensity + added, SHAKE_MAX_INTENSITY);
        for (const pos of events.explosionPositions) {
          particleSystem.emitExplosionSparks(pos.col, pos.row);
        }
      }

      // Update brick crumble animations
      gridRenderer.update(dt);

      // Animate and reveal powerups under destroyed bricks
      const newlyRevealedPowerups = new Set<string>();
      if (events.bricksDestroyed.length > 0) {
        gridRenderer.onBricksDestroyed(events.bricksDestroyed);
      }
      for (const brick of events.bricksDestroyed) {
        particleSystem.emitBrickDebris(brick.col, brick.row);
        const revealed = powerupManager.revealAt(brick.col, brick.row);
        if (revealed) {
          newlyRevealedPowerups.add(`${revealed.col},${revealed.row}`);
        }
      }

      // Destroy revealed powerups hit by explosions, except those revealed
      // by the same blast tick (they should stay visible for pickup).
      for (const pos of events.explosionPositions) {
        const key = `${pos.col},${pos.row}`;
        if (newlyRevealedPowerups.has(key)) {
          continue;
        }
        const pup = powerupManager.getAt(pos.col, pos.row);
        if (pup && pup.revealed) {
          powerupManager.destroyAt(pos.col, pos.row);
        }
      }

      // Check if any player was killed by explosion
      checkPlayerDeaths();

      // Check powerup pickups
      checkPowerupPickups();

      // Update active bomb counts per player
      updateAllActiveBombCounts();

      // Check win condition
      checkWinCondition();

      // Update screen shake
      if (shakeIntensity > 0) {
        shakeIntensity = Math.max(0, shakeIntensity - SHAKE_DECAY_RATE * dt);
        shakeX = (Math.random() * 2 - 1) * shakeIntensity;
        shakeY = (Math.random() * 2 - 1) * shakeIntensity;
      } else {
        shakeX = 0;
        shakeY = 0;
      }

      // Update HUD
      updateHudStats();

      render();
    },

    onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Reset match so next game starts fresh
        clearMatchProgress();
        onTransition('main-menu');
        return;
      }
      // Prevent browser defaults for game keys (scrolling, etc.)
      if (e.key === ' ' || e.key.startsWith('Arrow')) {
        e.preventDefault();
      }
      if (initialized && !gameOver && !countdownActive) {
        inputManager.onKeyDown(e);
      }
    },

    onKeyUp(e: KeyboardEvent) {
      if (initialized && !gameOver && !countdownActive) {
        inputManager.onKeyUp(e);
      }
    },
  };
}
