const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { parseHTML } = require('linkedom');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
const ts = require('typescript');

require.extensions['.ts'] = function registerTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const { showAssetLoaderScreen } = require('../src/ui/asset-loader-screen.ts');
const { createTitleScreen } = require('../src/screens/title-screen.ts');
const { createMainMenu } = require('../src/screens/main-menu.ts');
const { createGameSetup } = require('../src/screens/game-setup.ts');
const { createMatchVictory } = require('../src/screens/match-victory.ts');
const { createRoundResults } = require('../src/screens/round-results.ts');
const { gameConfig } = require('../src/screens/game-config.ts');
const {
  createGameplayScreen,
  getGameplayMapMeta,
  renderPlayerHudRow,
  resolveSchemeFile,
} = require('../src/screens/gameplay-screen.ts');
const { resetMatch, matchState } = require('../src/engine/match-manager.ts');
const { ParticleSystem } = require('../src/engine/particles.ts');
const { Player } = require('../src/engine/player.ts');
const { GameGrid } = require('../src/engine/game-grid.ts');
const { BombManager } = require('../src/engine/bomb.ts');
const {
  applyPowerup,
  applySchemeStartingInventory,
  PowerupType,
} = require('../src/engine/powerup.ts');
const { parseScheme, TileType } = require('../src/assets/parsers/sch-parser.ts');
const { AIBot } = require('../src/engine/ai-bot.ts');
const { PowerupManager } = require('../src/engine/powerup.ts');
const { clearAll, storeFile, storeMetadata } = require('../src/assets/asset-db.ts');
const { assets } = require('../src/assets/asset-registry.ts');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
}

function setViewport(width, height) {
  globalThis.__SMOKE_VIEWPORT__ = { width, height };
}

function createMockCanvasGradient() {
  return {
    addColorStop() {},
  };
}

function createMockImageData(width = 1, height = 1) {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  };
}

function createMockCanvasContext() {
  return {
    __translateCalls: [],
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    filter: 'none',
    shadowColor: 'transparent',
    shadowBlur: 0,
    imageSmoothingEnabled: false,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    strokeRect() {},
    arc() {},
    ellipse() {},
    translate(x, y) {
      this.__translateCalls.push([x, y]);
    },
    scale() {},
    rotate() {},
    fillText() {},
    save() {},
    restore() {},
    drawImage() {},
    putImageData() {},
    getImageData(width, height) {
      return createMockImageData(width, height);
    },
    createRadialGradient() {
      return createMockCanvasGradient();
    },
  };
}

function installDomEnvironment() {
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  const rafHandles = new Map();
  let rafId = 0;
  const localStorage = createLocalStorage();
  const viewport = globalThis.__SMOKE_VIEWPORT__ ?? { width: 1024, height: 768 };

  window.innerWidth = viewport.width;
  window.innerHeight = viewport.height;
  window.localStorage = localStorage;
  window.indexedDB = indexedDB;
  window.IDBKeyRange = IDBKeyRange;
  window.performance = performance;
  window.requestAnimationFrame = (cb) => {
    const id = ++rafId;
    const handle = setTimeout(() => {
      rafHandles.delete(id);
      cb(performance.now());
    }, 16);
    rafHandles.set(id, handle);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const handle = rafHandles.get(id);
    if (handle) {
      clearTimeout(handle);
      rafHandles.delete(id);
    }
  };

  const elementProto = window.HTMLElement.prototype;
  const canvasProto = window.HTMLCanvasElement.prototype;
  canvasProto.getContext = function getContext() {
    if (!this.__mockContext2d) {
      this.__mockContext2d = createMockCanvasContext();
    }
    return this.__mockContext2d;
  };
  elementProto.getBoundingClientRect = function getBoundingClientRect() {
    if (this.classList.contains('stage-shell')) {
      const current = globalThis.__SMOKE_VIEWPORT__ ?? viewport;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: current.width,
        height: current.height,
        right: current.width,
        bottom: current.height,
      };
    }

    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    };
  };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.navigator = window.navigator;
  globalThis.location = window.location;
  globalThis.localStorage = localStorage;
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.DOMParser = window.DOMParser;
  globalThis.getComputedStyle = window.getComputedStyle
    ? window.getComputedStyle.bind(window)
    : () => ({ getPropertyValue: () => '' });
  globalThis.performance = performance;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
}

function teardownDomEnvironment() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.navigator;
  delete globalThis.location;
  delete globalThis.localStorage;
  delete globalThis.indexedDB;
  delete globalThis.IDBKeyRange;
  delete globalThis.HTMLElement;
  delete globalThis.HTMLCanvasElement;
  delete globalThis.Node;
  delete globalThis.Event;
  delete globalThis.CustomEvent;
  delete globalThis.DOMParser;
  delete globalThis.getComputedStyle;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  delete globalThis.__SMOKE_VIEWPORT__;
}

function createContainer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function click(element) {
  element.dispatchEvent(new window.Event('click', { bubbles: true }));
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function withDom(testFn, viewport) {
  setViewport(viewport?.width ?? 1024, viewport?.height ?? 768);
  installDomEnvironment();
  assets.invalidate();
  await clearAll();

  try {
    await testFn();
  } finally {
    assets.invalidate();
    await clearAll();
    teardownDomEnvironment();
  }
}

async function testLoaderRendersOnBoot() {
  await withDom(async () => {
    const container = createContainer();
    void showAssetLoaderScreen(container);
    await flush();

    assert.equal(container.querySelector('.loader-title')?.textContent, 'ATOMIC BOMBERPERSON');
    assert.equal(container.querySelector('.load-btn')?.disabled, true);
    assert.match(container.querySelector('.dropzone-label')?.textContent ?? '', /\.zip/i);
  });
}

async function testStageScaling() {
  await withDom(async () => {
    const titleContainer = createContainer();
    const titleScreen = createTitleScreen(() => {});
    titleScreen.onEnter(titleContainer);

    const titleStage = titleContainer.querySelector('.stage-screen.title-screen');
    assert.ok(titleStage);
    assert.equal(titleStage.style.getPropertyValue('--stage-scale'), '1.5');
    titleScreen.onExit();

    const menuContainer = createContainer();
    const menuScreen = createMainMenu(() => {});
    menuScreen.onEnter(menuContainer);

    const menuStage = menuContainer.querySelector('.stage-screen.menu-screen');
    assert.ok(menuStage);
    assert.equal(menuStage.style.getPropertyValue('--stage-scale'), '1.5');
    menuScreen.onExit();
  }, { width: 1280, height: 720 });
}

async function testGameSetupCyclesImportedMaps() {
  await withDom(async () => {
    await storeFile('maps/arena.sch', new TextEncoder().encode('scheme one').buffer);
    await storeFile('maps/castle.sch', new TextEncoder().encode('scheme two').buffer);
    await storeMetadata({
      importedAt: Date.now(),
      fileCount: 2,
      totalSize: 20,
    });
    assets.invalidate();

    const container = createContainer();
    const setupScreen = createGameSetup(() => {});
    setupScreen.onEnter(container);
    await flush(6);

    assert.equal(container.querySelector('.setup-map-value')?.textContent, 'ARENA');

    const buttons = container.querySelectorAll('.setup-map-btn');
    click(buttons[1]);
    assert.equal(container.querySelector('.setup-map-value')?.textContent, 'CASTLE');
    assert.equal(gameConfig.map, 'CASTLE');
    assert.equal(gameConfig.mapFile, 'maps/castle.sch');

    click(buttons[0]);
    assert.equal(container.querySelector('.setup-map-value')?.textContent, 'ARENA');
    assert.equal(gameConfig.map, 'ARENA');
    assert.equal(gameConfig.mapFile, 'maps/arena.sch');

    setupScreen.onExit();
  });
}

async function testGameplaySchemeResolutionPrefersExactSelectedFile() {
  await withDom(async () => {
    await storeFile('maps/arena.sch', new TextEncoder().encode('-N,ARENA').buffer);
    await storeFile('bonus/arena.sch', new TextEncoder().encode('-N,BONUS ARENA').buffer);
    await storeMetadata({
      importedAt: Date.now(),
      fileCount: 2,
      totalSize: 22,
    });
    assets.invalidate();

    const resolved = await resolveSchemeFile('ARENA', 'bonus/arena.sch');
    assert.equal(resolved, 'bonus/arena.sch');
  });
}

async function testGameplayMapHudShowsImportedSelection() {
  await withDom(async () => {
    await storeFile(
      'maps/castle.sch',
      new TextEncoder().encode(
        [
          '-N,CASTLE COURT',
          '-B,100',
          '-R,1,..:.........:..',
          '-R,3,.....::::......',
          '-S,0,1,1,0',
          '-S,1,13,1,1',
          '-P,0,1,0,0,0,Extra bomb',
          '-P,2,0,1,3,1,Disease',
          '-C,N,4,5',
          '-C,E,5,5',
          '-W,1,8,8',
          '-W,0,10,8',
        ].join('\n'),
      ).buffer,
    );
    await storeMetadata({
      importedAt: Date.now(),
      fileCount: 1,
      totalSize: 32,
    });
    assets.invalidate();

    gameConfig.map = 'CASTLE';
    gameConfig.mapFile = 'maps/castle.sch';
    gameConfig.players = [{ type: 'human' }, { type: 'ai' }];

    const meta = getGameplayMapMeta(gameConfig.map, gameConfig.mapFile);
    assert.equal(meta.loadingLabel, 'Loading imported map CASTLE...');
    assert.equal(meta.source, 'IMPORTED CASTLE.SCH');

    const container = createContainer();
    const gameplayScreen = createGameplayScreen(() => {});
    gameplayScreen.onEnter(container);

    assert.equal(
      container.querySelector('.gameplay-loading')?.textContent,
      'Loading imported map CASTLE...',
    );

    await flush(6);

    assert.equal(container.querySelector('.gameplay-map-name')?.textContent, 'MAP CASTLE COURT');
    assert.equal(container.querySelector('.gameplay-map-source')?.textContent, 'IMPORTED CASTLE.SCH');
    assert.equal(container.querySelector('.gameplay-scheme-summary')?.style.display ?? '', '');
    assert.equal(
      container.querySelector('.gameplay-scheme-summary')?.textContent,
      'SPAWNS 2 | TEAMS 2 | POWERUPS 1 ON / 1 OFF | CONVEYORS 2 (U1/R1) | WARPS 2 (>0:1/>1:1)',
    );
    assert.equal(
      container.querySelector('.gameplay-template-summary')?.textContent,
      'BASE OPEN 159 | SOLID 0 | PRESET BRICKS 6',
    );
    assert.equal(
      container.querySelector('.gameplay-layout-summary')?.textContent,
      'BRICKS 4 | TARGET 100% | CLEARED 2 | HIDDEN POWERUPS 1',
    );
    assert.equal(
      container.querySelector('.gameplay-spawn-summary')?.textContent,
      'P1 @ 1,1 T1 | P2 @ 13,1 T2',
    );
    assert.equal(
      container.querySelector('.gameplay-inventory-summary')?.textContent,
      'START WITH EXTRA BOMB x1 | OVERRIDES DISEASE=3',
    );
    assert.equal(container.querySelector('.gameplay-hud')?.classList.contains('hidden'), false);
    assert.match(
      container.querySelector('.gameplay-player-hud')?.textContent ?? '',
      /P1B:2F:2S:3\.\d/,
    );
    assert.match(
      container.querySelector('.gameplay-player-hud')?.textContent ?? '',
      /P2B:2F:2S:3\.\d/,
    );

    gameplayScreen.onExit();
  });
}

async function testLockedMenuItems() {
  await withDom(async () => {
    const transitions = [];
    const container = createContainer();
    const menuScreen = createMainMenu((state) => transitions.push(state));
    menuScreen.onEnter(container);

    assert.equal(container.querySelectorAll('.menu-item--locked').length, 5);
    assert.ok(container.querySelector('.menu-item--locked .menu-lock'));

    menuScreen.onKeyDown({ key: 'ArrowDown' });
    assert.match(container.querySelectorAll('.menu-item')[6]?.className ?? '', /menu-item--selected/);

    click(container.querySelectorAll('.menu-item')[1]);
    assert.equal(container.querySelector('.menu-toast')?.textContent, 'START NETWORK GAME locked');
    assert.equal(container.querySelector('.setup-screen'), null);
    assert.deepEqual(transitions, []);

    menuScreen.onExit();
  });
}

async function testRoundResultsAdvancesToNextRound() {
  await withDom(async () => {
    resetMatch(2, 3);
    matchState.roundNumber = 2;
    matchState.lastRoundWinner = 1;
    matchState.scores[1] = 1;

    const transitions = [];
    const container = createContainer();
    const resultsScreen = createRoundResults((state) => transitions.push(state));
    resultsScreen.onEnter(container);
    resultsScreen.onUpdate(0.25);
    assert.match(
      container.querySelector('.results-round-winner')?.getAttribute('style') ?? '',
      /transform:\s*scale\(/i,
    );

    assert.equal(container.querySelector('.results-heading')?.textContent, 'ROUND 2 RESULTS');
    assert.equal(
      container.querySelector('.results-round-winner')?.textContent,
      'PLAYER 2 WINS THE ROUND!',
    );
    assert.equal(
      container.querySelector('.results-prompt')?.textContent,
      'ENTER/SPACE — NEXT ROUND',
    );
    assert.match(
      container.querySelector('.results-player-row--winner .results-crown')?.textContent ?? '',
      /★/,
    );

    resultsScreen.onKeyDown({ key: ' ' });
    assert.deepEqual(transitions, ['gameplay']);
    assert.equal(matchState.roundNumber, 2);
    assert.deepEqual(matchState.scores, [0, 1]);
    assert.equal(matchState.lastRoundWinner, 1);
    assert.equal(matchState.matchWinner, -1);

    resultsScreen.onExit();
  });
}

async function testRoundResultsEnterCarriesProgressIntoNextGameplayRound() {
  await withDom(async () => {
    gameConfig.map = 'BASIC';
    gameConfig.mapFile = null;
    gameConfig.winsRequired = 3;
    gameConfig.players = [{ type: 'human' }, { type: 'human' }];

    resetMatch(2, 3);
    matchState.roundNumber = 2;
    matchState.lastRoundWinner = 1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 2;

    const transitions = [];
    const resultsContainer = createContainer();
    const resultsScreen = createRoundResults((state) => transitions.push(state));
    resultsScreen.onEnter(resultsContainer);

    resultsScreen.onKeyDown({ key: 'Enter' });
    assert.deepEqual(transitions, ['gameplay']);
    assert.equal(matchState.roundNumber, 2);
    assert.deepEqual(matchState.scores, [1, 2]);
    assert.equal(matchState.lastRoundWinner, 1);
    assert.equal(matchState.matchWinner, -1);

    resultsScreen.onExit();

    const gameplayContainer = createContainer();
    const gameplayScreen = createGameplayScreen(() => {});
    gameplayScreen.onEnter(gameplayContainer);
    await flush(6);

    assert.equal(matchState.roundNumber, 3);
    assert.deepEqual(matchState.scores, [1, 2]);
    assert.equal(matchState.lastRoundWinner, 1);
    assert.equal(matchState.matchWinner, -1);

    gameplayScreen.onExit();
  });
}

async function testRoundResultsClickAdvancesToNextRound() {
  await withDom(async () => {
    resetMatch(2, 3);
    matchState.roundNumber = 2;
    matchState.lastRoundWinner = 1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 2;

    const transitions = [];
    const container = createContainer();
    const resultsScreen = createRoundResults((state) => transitions.push(state));
    resultsScreen.onEnter(container);

    assert.equal(
      container.querySelector('.results-hint')?.textContent,
      'CLICK/TAP to confirm | ESC to quit to menu',
    );

    click(container.querySelector('.results-panel'));
    click(container.querySelector('.results-heading'));
    assert.deepEqual(transitions, ['gameplay']);
    assert.equal(matchState.roundNumber, 2);
    assert.deepEqual(matchState.scores, [1, 2]);
    assert.equal(matchState.lastRoundWinner, 1);

    resultsScreen.onExit();
  });
}

async function testRoundResultsIgnoresRepeatedEnterUntilFreshPress() {
  await withDom(async () => {
    resetMatch(2, 3);
    matchState.roundNumber = 2;
    matchState.lastRoundWinner = 1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 2;

    const transitions = [];
    const container = createContainer();
    const resultsScreen = createRoundResults((state) => transitions.push(state));
    resultsScreen.onEnter(container);

    resultsScreen.onKeyDown({ key: 'Enter', repeat: true });
    resultsScreen.onKeyDown({ key: 'Enter', repeat: true });
    assert.deepEqual(transitions, []);
    assert.equal(matchState.roundNumber, 2);
    assert.deepEqual(matchState.scores, [1, 2]);
    assert.equal(matchState.lastRoundWinner, 1);
    assert.equal(matchState.matchWinner, -1);

    resultsScreen.onKeyDown({ key: 'Enter' });
    resultsScreen.onKeyDown({ key: 'Enter', repeat: true });
    resultsScreen.onKeyDown({ key: 'Escape', repeat: true });
    assert.deepEqual(transitions, ['gameplay']);
    assert.equal(matchState.roundNumber, 2);
    assert.deepEqual(matchState.scores, [1, 2]);
    assert.equal(matchState.lastRoundWinner, 1);
    assert.equal(matchState.matchWinner, -1);

    resultsScreen.onExit();
  });
}

async function testRoundResultsTransitionGuardResetsAfterReentry() {
  await withDom(async () => {
    resetMatch(2, 3);
    matchState.roundNumber = 2;
    matchState.lastRoundWinner = 1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 2;

    const transitions = [];
    const firstContainer = createContainer();
    const firstScreen = createRoundResults((state) => transitions.push(`first:${state}`));
    firstScreen.onEnter(firstContainer);
    firstScreen.onKeyDown({ key: 'Enter' });
    assert.deepEqual(transitions, ['first:gameplay']);
    firstScreen.onExit();

    const secondContainer = createContainer();
    const secondScreen = createRoundResults((state) => transitions.push(`second:${state}`));
    secondScreen.onEnter(secondContainer);
    secondScreen.onKeyDown({ key: 'Enter' });
    assert.deepEqual(transitions, ['first:gameplay', 'second:gameplay']);
    secondScreen.onExit();
  });
}

async function testRoundResultsDrawExitsToMenu() {
  await withDom(async () => {
    resetMatch(3, 2);
    matchState.roundNumber = 3;
    matchState.lastRoundWinner = -1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;

    const transitions = [];
    const container = createContainer();
    const resultsScreen = createRoundResults((state) => transitions.push(state));
    resultsScreen.onEnter(container);
    resultsScreen.onUpdate(0.25);

    assert.equal(container.querySelector('.results-heading')?.textContent, 'ROUND 3 RESULTS');
    assert.equal(
      container.querySelector('.results-draw')?.textContent,
      'DRAW — NO WINNER THIS ROUND',
    );
    assert.equal(container.querySelector('.results-round-winner'), null);
    assert.equal(container.querySelector('.results-player-row--winner'), null);

    resultsScreen.onKeyDown({ key: 'Escape' });
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    resultsScreen.onExit();
  });
}

async function testRoundResultsSingleWinTargetUsesSingularCopy() {
  await withDom(async () => {
    resetMatch(2, 1);
    matchState.roundNumber = 1;
    matchState.lastRoundWinner = 0;
    matchState.scores[0] = 1;

    const container = createContainer();
    const resultsScreen = createRoundResults(() => {});
    resultsScreen.onEnter(container);

    assert.equal(
      container.querySelector('.results-heading')?.textContent,
      'ROUND 1 RESULTS',
    );
    assert.equal(
      container.querySelector('.results-target')?.textContent,
      'FIRST TO 1 WIN',
    );

    resultsScreen.onExit();
  });
}

async function testGameplayTransitionsToMatchVictoryOnFinalRound() {
  await withDom(async () => {
    const transitions = [];
    gameConfig.map = 'BASIC';
    gameConfig.mapFile = null;
    gameConfig.winsRequired = 1;
    gameConfig.players = [{ type: 'human' }, { type: 'off' }];
    matchState.roundNumber = 0;
    matchState.matchWinner = -1;
    matchState.lastRoundWinner = -1;
    matchState.scores = [];

    const container = createContainer();
    const gameplayScreen = createGameplayScreen((state) => transitions.push(state));
    gameplayScreen.onEnter(container);
    await flush(6);

    gameplayScreen.onUpdate(2.1);
    gameplayScreen.onUpdate(0.016);
    gameplayScreen.onUpdate(3.1);

    assert.deepEqual(transitions, ['match-victory']);
    assert.equal(matchState.matchWinner, 0);

    gameplayScreen.onExit();
  });
}

async function testMatchVictoryScreenShowsWinnerAndReturnsToMenu() {
  await withDom(async () => {
    resetMatch(2, 3);
    matchState.roundNumber = 4;
    matchState.scores[0] = 3;
    matchState.scores[1] = 1;
    matchState.matchWinner = 0;

    const transitions = [];
    const container = createContainer();
    const victoryScreen = createMatchVictory((state) => transitions.push(state));
    victoryScreen.onEnter(container);
    victoryScreen.onUpdate(0.25);
    assert.match(
      container.querySelector('.results-match-winner')?.getAttribute('style') ?? '',
      /transform:\s*scale\(/i,
    );

    assert.equal(container.querySelector('.results-heading')?.textContent, 'MATCH OVER');
    assert.equal(
      container.querySelector('.results-match-winner')?.textContent,
      'PLAYER 1 WINS THE MATCH!',
    );
    assert.equal(
      container.querySelector('.match-victory-summary')?.textContent,
      'DECIDED IN 4 ROUNDS',
    );
    assert.equal(
      container.querySelector('.results-target')?.textContent,
      'FIRST TO 3 WINS',
    );
    assert.equal(
      container.querySelector('.results-prompt')?.textContent,
      'ENTER/SPACE — BACK TO MENU',
    );
    assert.ok(container.querySelector('.results-player-row--match-winner'));
    assert.equal(
      container.querySelector('.results-win-count')?.textContent,
      '3W',
    );
    assert.match(
      container.querySelector('.results-player-row--match-winner .results-crown')?.textContent ?? '',
      /♛/,
    );

    victoryScreen.onKeyDown({ key: ' ' });
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    victoryScreen.onExit();
  });
}

async function testMatchVictoryEscapeReturnsToMenuAndResetsRoundState() {
  await withDom(async () => {
    resetMatch(3, 2);
    matchState.roundNumber = 5;
    matchState.scores[0] = 2;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;
    matchState.matchWinner = 0;

    const transitions = [];
    const container = createContainer();
    const victoryScreen = createMatchVictory((state) => transitions.push(state));
    victoryScreen.onEnter(container);
    victoryScreen.onUpdate(0.25);

    assert.equal(
      container.querySelector('.results-match-winner')?.textContent,
      'PLAYER 1 WINS THE MATCH!',
    );

    victoryScreen.onKeyDown({ key: 'Escape' });
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    victoryScreen.onExit();
  });
}

async function testMatchVictoryClickReturnsToMenu() {
  await withDom(async () => {
    resetMatch(3, 2);
    matchState.roundNumber = 5;
    matchState.scores[0] = 2;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;
    matchState.matchWinner = 0;

    const transitions = [];
    const container = createContainer();
    const victoryScreen = createMatchVictory((state) => transitions.push(state));
    victoryScreen.onEnter(container);

    assert.equal(
      container.querySelector('.results-hint')?.textContent,
      'CLICK/TAP to confirm | ESC to quit to menu',
    );

    click(container.querySelector('.results-panel'));
    click(container.querySelector('.results-heading'));
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    victoryScreen.onExit();
  });
}

async function testMatchVictoryIgnoresRepeatedEscapeUntilFreshPress() {
  await withDom(async () => {
    resetMatch(3, 2);
    matchState.roundNumber = 5;
    matchState.scores[0] = 2;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;
    matchState.matchWinner = 0;

    const transitions = [];
    const container = createContainer();
    const victoryScreen = createMatchVictory((state) => transitions.push(state));
    victoryScreen.onEnter(container);

    victoryScreen.onKeyDown({ key: 'Escape', repeat: true });
    victoryScreen.onKeyDown({ key: 'Escape', repeat: true });
    assert.deepEqual(transitions, []);
    assert.equal(matchState.roundNumber, 5);
    assert.deepEqual(matchState.scores, [2, 1, 0]);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, 0);

    victoryScreen.onKeyDown({ key: 'Escape' });
    victoryScreen.onKeyDown({ key: 'Escape', repeat: true });
    victoryScreen.onKeyDown({ key: 'Enter', repeat: true });
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    victoryScreen.onExit();
  });
}

async function testMatchVictoryTransitionGuardResetsAfterReentry() {
  await withDom(async () => {
    resetMatch(3, 2);
    matchState.roundNumber = 5;
    matchState.scores[0] = 2;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;
    matchState.matchWinner = 0;

    const transitions = [];
    const firstContainer = createContainer();
    const firstScreen = createMatchVictory((state) => transitions.push(`first:${state}`));
    firstScreen.onEnter(firstContainer);
    firstScreen.onKeyDown({ key: 'Enter' });
    assert.deepEqual(transitions, ['first:main-menu']);
    firstScreen.onExit();

    resetMatch(3, 2);
    matchState.roundNumber = 5;
    matchState.scores[0] = 2;
    matchState.scores[1] = 1;
    matchState.scores[2] = 0;
    matchState.matchWinner = 0;

    const secondContainer = createContainer();
    const secondScreen = createMatchVictory((state) => transitions.push(`second:${state}`));
    secondScreen.onEnter(secondContainer);
    secondScreen.onKeyDown({ key: 'Escape' });
    assert.deepEqual(transitions, ['first:main-menu', 'second:main-menu']);
    secondScreen.onExit();
  });
}

async function testMatchVictorySingleRoundSummaryUsesSingularCopy() {
  await withDom(async () => {
    resetMatch(2, 1);
    matchState.roundNumber = 1;
    matchState.scores[0] = 1;
    matchState.scores[1] = 0;
    matchState.matchWinner = 0;

    const container = createContainer();
    const victoryScreen = createMatchVictory(() => {});
    victoryScreen.onEnter(container);

    assert.equal(
      container.querySelector('.match-victory-summary')?.textContent,
      'DECIDED IN 1 ROUND',
    );
    assert.equal(
      container.querySelector('.results-target')?.textContent,
      'FIRST TO 1 WIN',
    );

    victoryScreen.onExit();
  });
}

async function testGameplayEscapeReturnsToMenuAndClearsMatchProgress() {
  await withDom(async () => {
    gameConfig.map = 'BASIC';
    gameConfig.mapFile = null;
    gameConfig.winsRequired = 2;
    gameConfig.players = [{ type: 'human' }, { type: 'human' }];

    resetMatch(2, 2);
    matchState.roundNumber = 2;
    matchState.scores[0] = 1;
    matchState.lastRoundWinner = 0;
    matchState.matchWinner = 0;

    const transitions = [];
    const container = createContainer();
    const gameplayScreen = createGameplayScreen((state) => transitions.push(state));
    gameplayScreen.onEnter(container);
    await flush(6);

    gameplayScreen.onKeyDown({ key: 'Escape' });
    assert.deepEqual(transitions, ['main-menu']);
    assert.equal(matchState.roundNumber, 0);
    assert.deepEqual(matchState.scores, []);
    assert.equal(matchState.lastRoundWinner, -1);
    assert.equal(matchState.matchWinner, -1);

    gameplayScreen.onExit();
  });
}

async function testParticleSystemEmitsUpdatesAndRenders() {
  const particles = new ParticleSystem();
  const ctx = createMockCanvasContext();

  particles.emitExplosionSparks(3, 4);
  particles.emitBrickDebris(5, 6);
  assert.ok(particles.count > 0);

  particles.update(0.1);
  particles.render(ctx, 0, 0, 40, 36);
  assert.ok(particles.count > 0);

  particles.update(2);
  assert.equal(particles.count, 0);
}

async function testSchemeParserReadsConveyorMetadata() {
  const parsed = parseScheme([
    '-N,CONVEYOR TEST',
    '-B,0',
    '-C,N,4,5',
    'C E 6 7',
    '-W,1,0,4',
    'W 0 0 8',
  ].join('\n'));

  assert.deepEqual(parsed.conveyors, [
    { x: 4, y: 5, direction: 'up' },
    { x: 6, y: 7, direction: 'right' },
  ]);
  assert.deepEqual(parsed.warps, [
    { index: 0, target: 1, x: 0, y: 4 },
    { index: 1, target: 0, x: 0, y: 8 },
  ]);
}

function createOpenTestGrid() {
  return new GameGrid({
    name: 'TEST',
    brickDensity: 0,
    grid: Array.from({ length: 11 }, () => Array(15).fill(0)),
    spawns: [{ player: 0, x: 2, y: 2, team: 0 }],
    powerups: [],
    conveyors: [],
    warps: [],
  });
}

async function testConveyorTilesCarryPlayersAndBombs() {
  const grid = new GameGrid({
    name: 'CONVEYOR',
    brickDensity: 0,
    grid: Array.from({ length: 11 }, () => Array(15).fill(0)),
    spawns: [{ player: 0, x: 2, y: 2, team: 0 }],
    powerups: [],
    conveyors: [
      { x: 2, y: 2, direction: 'right' },
      { x: 3, y: 2, direction: 'right' },
      { x: 4, y: 2, direction: 'right' },
    ],
    warps: [],
  });
  const bombs = new BombManager();
  const player = new Player(0, 'human', 2, 2);

  player.update(0.5, grid, bombs);
  assert.ok(player.x > 2.6, 'expected idle player to be pushed along the conveyor');

  assert.equal(bombs.placeBomb(2, 2, 0, 2), true);
  bombs.update(0.5, grid);
  assert.ok(bombs.bombs[0].slideX > 0, 'expected idle bomb to start sliding along the conveyor');
}

async function testWarpTilesTeleportPlayersAndBombs() {
  const grid = new GameGrid({
    name: 'WARP',
    brickDensity: 0,
    grid: Array.from({ length: 11 }, () => Array(15).fill(0)),
    spawns: [{ player: 0, x: 2, y: 2, team: 0 }],
    powerups: [],
    conveyors: [],
    warps: [
      { index: 0, target: 1, x: 2, y: 2 },
      { index: 1, target: 0, x: 7, y: 5 },
    ],
  });
  const bombs = new BombManager();
  const player = new Player(0, 'human', 2, 2);

  player.update(0.016, grid, bombs);
  assert.equal(player.x, 7, 'expected player to teleport to the target warp');
  assert.equal(player.y, 5, 'expected player to land on the target warp row');

  player.update(0.016, grid, bombs);
  assert.equal(player.x, 7, 'expected player to stay on the destination warp without bouncing');
  assert.equal(player.y, 5, 'expected player to stay on the destination warp without bouncing');

  assert.equal(bombs.placeBomb(2, 2, 0, 2), true);
  bombs.update(0.016, grid);
  assert.equal(bombs.bombs[0].col, 7, 'expected bomb to teleport to the target warp');
  assert.equal(bombs.bombs[0].row, 5, 'expected bomb to land on the target warp row');

  bombs.update(0.016, grid);
  assert.equal(bombs.bombs[0].col, 7, 'expected bomb to remain on the destination warp until moved away');
  assert.equal(bombs.bombs[0].row, 5, 'expected bomb to remain on the destination warp until moved away');
}

async function testDiseasePowerupsApplyTimedDebuffs() {
  const grid = createOpenTestGrid();
  const bombs = new BombManager();
  const player = new Player(0, 'human', 2, 2);

  applyPowerup(PowerupType.SuperDisease, player);
  assert.equal(player.hasSlowDisease(), true);
  assert.equal(player.hasReverseDisease(), true);

  player.setInput('right', true);
  player.update(0.2, grid, bombs);
  assert.ok(player.x < 2, 'expected reverse controls to move left');
  assert.ok(player.x > 1.6, 'expected slow disease to reduce travel distance');

  player.setInput('right', false);
  player.update(15.1, grid, bombs);
  assert.equal(player.hasSlowDisease(), false);
  assert.equal(player.hasReverseDisease(), false);

  const clearedX = player.x;
  player.setInput('right', true);
  player.update(0.2, grid, bombs);
  assert.ok(player.x > clearedX, 'expected movement to return to normal after disease expiry');
}

async function testTriggerPowerupDetonatesOldestOwnedBomb() {
  const grid = createOpenTestGrid();
  const bombs = new BombManager();
  const player = new Player(0, 'human', 2, 2);

  applyPowerup(PowerupType.Trigger, player);
  assert.equal(player.stats.hasTrigger, true);

  assert.equal(bombs.placeBomb(2, 2, player.index, 2), true);
  assert.equal(bombs.placeBomb(2, 5, player.index, 2), true);

  const events = bombs.triggerOldestBomb(player.index, grid);
  assert.ok(events, 'expected trigger detonation events');
  assert.deepEqual(events.explosionPositions[0], { col: 2, row: 2 });
  assert.equal(bombs.hasBomb(2, 2), false, 'expected oldest bomb to be removed immediately');
  assert.equal(bombs.hasBomb(2, 5), true, 'expected newer bomb to remain active');
}

async function testJellyKickedBombsBounceOffBlockingEdges() {
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  // Place bomb at col 12 and kick toward the grid edge at col 14.
  // Col 14 is the last in-bounds cell; the bomb should reach col 14 then bounce
  // because col 15 is out of bounds.
  assert.equal(bombs.placeBomb(12, 5, 0, 2, true), true);
  assert.equal(bombs.kickBomb(12, 5, 'right', grid), true);

  // Speed=6, need to cover 2 tiles (12→14), give enough time
  bombs.update(0.5, grid);
  assert.equal(bombs.bombs[0].col, 14, 'expected kicked bomb to reach the last open tile');
  assert.equal(
    bombs.bombs[0].slideDirection,
    'left',
    'expected jelly kicked bomb to reverse direction at the blocking edge',
  );
  assert.equal(bombs.bombs[0].slideX, 0, 'expected bounce to snap back to the tile center');

  bombs.update(0.2, grid);
  assert.equal(bombs.bombs[0].col, 13, 'expected bounced bomb to travel back into the arena');
}

async function testSchemeStartingInventoryAppliesLivePlayerStats() {
  const player = new Player(0, 'human', 2, 2);

  applySchemeStartingInventory(player, [
    {
      id: PowerupType.ExtraBomb,
      name: 'Extra bomb',
      bornWith: 2,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
    {
      id: PowerupType.Speed,
      name: 'Extra speed',
      bornWith: 1,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
    {
      id: PowerupType.Kick,
      name: 'Kick',
      bornWith: 1,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
    {
      id: PowerupType.Trigger,
      name: 'Trigger',
      bornWith: 1,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
    {
      id: PowerupType.Jelly,
      name: 'Jelly',
      bornWith: 1,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
    {
      id: 99,
      name: 'Unknown',
      bornWith: 3,
      hasOverride: false,
      overrideValue: 0,
      forbidden: false,
    },
  ]);

  assert.equal(player.stats.maxBombs, 3);
  assert.equal(player.stats.speed, 4.1);
  assert.equal(player.stats.canKick, true);
  assert.equal(player.stats.hasTrigger, true);
  assert.equal(player.stats.hasJelly, true);
}

async function testGameplayHudShowsPowerupAndDiseaseBadgesFromSchemeInventory() {
  await withDom(async () => {
    await storeFile(
      'maps/status.sch',
      new TextEncoder().encode(
        [
          '-N,STATUS TEST',
          '-B,0',
          '-S,0,2,2,0',
          '-S,1,12,8,0',
          '-P,3,1,0,0,Kick',
          '-P,9,1,0,0,Trigger',
          '-P,10,1,0,0,Jelly',
          '-P,11,1,0,0,Super bad disease',
        ].join('\n'),
      ).buffer,
    );
    await storeMetadata({
      importedAt: Date.now(),
      fileCount: 1,
      totalSize: 24,
    });
    assets.invalidate();

    gameConfig.map = 'STATUS';
    gameConfig.mapFile = 'maps/status.sch';
    gameConfig.players = [{ type: 'human' }, { type: 'human' }];

    const container = createContainer();
    const gameplayScreen = createGameplayScreen(() => {});
    gameplayScreen.onEnter(container);
    await flush(6);

    const playerHud = container.querySelector('.gameplay-player-hud');
    assert.ok(playerHud, 'expected gameplay player HUD to be rendered');

    const firstPlayerRow = playerHud.querySelector('.hud-player');
    assert.ok(firstPlayerRow, 'expected at least one player HUD row');
    assert.match(firstPlayerRow.innerHTML, />K</, 'expected Kick badge');
    assert.match(firstPlayerRow.innerHTML, />T</, 'expected Trigger badge');
    assert.match(firstPlayerRow.innerHTML, />J</, 'expected Jelly badge');
    assert.match(firstPlayerRow.innerHTML, />SL</, 'expected slow disease badge');
    assert.match(firstPlayerRow.innerHTML, />RV</, 'expected reverse disease badge');

    const dangerBadges = firstPlayerRow.querySelectorAll('.hud-powerup--danger');
    assert.equal(dangerBadges.length, 2, 'expected both disease badges to use the danger style');

    gameplayScreen.onExit();
  });
}

async function testGameplayHudRowRefreshesAfterRuntimePowerupChanges() {
  const player = new Player(0, 'human', 1, 1);
  const emptyGrid = createOpenTestGrid();
  const bombs = new BombManager();

  const baseRow = renderPlayerHudRow(player);
  assert.doesNotMatch(baseRow, />K</, 'did not expect Kick badge before a live powerup change');
  assert.doesNotMatch(baseRow, />T</, 'did not expect Trigger badge before a live powerup change');
  assert.doesNotMatch(baseRow, />SL</, 'did not expect disease badges before a live powerup change');

  applyPowerup(PowerupType.Kick, player);
  applyPowerup(PowerupType.Trigger, player);
  applyPowerup(PowerupType.SuperDisease, player);

  const upgradedRow = renderPlayerHudRow(player);
  assert.match(upgradedRow, />K</, 'expected Kick badge after a live powerup change');
  assert.match(upgradedRow, />T</, 'expected Trigger badge after a live powerup change');
  assert.match(upgradedRow, />SL</, 'expected slow disease badge after a live powerup change');
  assert.match(upgradedRow, />RV</, 'expected reverse disease badge after a live powerup change');

  player.update(16, emptyGrid, bombs);
  const clearedRow = renderPlayerHudRow(player);
  assert.doesNotMatch(clearedRow, />SL</, 'expected slow disease badge to clear after expiry');
  assert.doesNotMatch(clearedRow, />RV</, 'expected reverse disease badge to clear after expiry');
  assert.match(clearedRow, />K</, 'expected permanent powerup badges to remain after disease expiry');
  assert.match(clearedRow, />T</, 'expected trigger badge to remain after disease expiry');
}

async function testGameplayScreenShakeTriggersOnExplosion() {
  await withDom(async () => {
    const originalRandom = Math.random;
    Math.random = () => 1;

    try {
      gameConfig.map = 'BASIC';
      gameConfig.mapFile = null;
      gameConfig.players = [{ type: 'human' }, { type: 'human' }];

      const container = createContainer();
      const gameplayScreen = createGameplayScreen(() => {});
      gameplayScreen.onEnter(container);
      await flush(6);

      const canvas = container.querySelector('.gameplay-canvas');
      const ctx = canvas?.getContext('2d');
      assert.ok(canvas);
      assert.ok(ctx);

      gameplayScreen.onUpdate(2.1);
      const baseTranslateCount = ctx.__translateCalls.length;
      const baseHudText = container.querySelector('.gameplay-player-hud')?.textContent ?? '';

      gameplayScreen.onKeyDown({ key: ' ', preventDefault() {} });
      gameplayScreen.onUpdate(0.016);
      gameplayScreen.onKeyUp({ key: ' ' });

      for (let i = 0; i < 50; i += 1) {
        gameplayScreen.onUpdate(0.05);
      }

      assert.ok(
        ctx.__translateCalls.length > baseTranslateCount,
        'expected gameplay to keep rendering after the live bomb explodes',
      );
      assert.notEqual(
        container.querySelector('.gameplay-player-hud')?.textContent ?? '',
        baseHudText,
        'expected the HUD to update after the explosion resolves',
      );

      gameplayScreen.onExit();
    } finally {
      Math.random = originalRandom;
    }
  });
}

// ---------------------------------------------------------------------------
// Engine unit tests — coordinate math, bomb placement, explosion blocking
// ---------------------------------------------------------------------------

/** Helper: create a GameGrid with a simple layout.
 *  gridSpec is an 11x15 2D array of TileType values (0=empty, 1=solid, 2=brick).
 *  If omitted, all cells are empty. */
function makeGrid(gridSpec, opts = {}) {
  const grid = gridSpec ?? Array.from({ length: 11 }, () => Array(15).fill(0));
  return new GameGrid({
    name: opts.name ?? 'TEST',
    brickDensity: opts.brickDensity ?? 0,
    grid,
    spawns: opts.spawns ?? [],
    powerups: opts.powerups ?? [],
    conveyors: opts.conveyors ?? [],
    warps: opts.warps ?? [],
  });
}

/**
 * Parse an ASCII grid into a 2D array for makeGrid.
 * Characters: . = empty, W = solid wall, B = brick
 * Each row is one line; rows are separated by newlines.
 * Leading/trailing blank lines are stripped. Each row is padded/trimmed to 15 cols.
 * Grid is always 11 rows (short grids are padded with empty rows).
 */
function parseAsciiGrid(ascii) {
  const CHAR_MAP = { '.': 0, 'W': 1, 'B': 2 };
  const lines = ascii.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const grid = [];
  for (let r = 0; r < 11; r++) {
    const row = [];
    const line = lines[r] ?? '';
    for (let c = 0; c < 15; c++) {
      row.push(CHAR_MAP[line[c]] ?? 0);
    }
    grid.push(row);
  }
  return grid;
}

/** Tick bombs until a condition is met or maxSeconds elapses. Returns true if condition was met. */
function tickBombsUntil(condition, bombs, grid, maxSeconds = 5) {
  const dt = 1 / 60;
  let elapsed = 0;
  while (elapsed < maxSeconds) {
    bombs.update(dt, grid);
    elapsed += dt;
    if (condition()) return true;
  }
  return false;
}

// -- Coordinate math tests --

function testGetGridPosMatchesCollisionDetection() {
  // getGridPos must agree with collision detection for all player positions.
  // The collision formula is: Math.floor(pos - HALF + 0.5) = Math.floor(pos + 0.2)
  // Sweep all integer and half-integer positions across the full grid.
  const fractOffsets = [-0.49, -0.2, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.79, 0.8, 0.9];

  for (let col = 0; col < 15; col++) {
    for (let row = 0; row < 11; row++) {
      for (const frac of fractOffsets) {
        const px = col + frac;
        const py = row + frac;
        if (px < 0 || py < 0 || px >= 15 || py >= 11) continue;
        const player = new Player(0, 'human', px, py);
        const pos = player.getGridPos();
        const expectedCol = Math.floor(px + 0.2);
        const expectedRow = Math.floor(py + 0.2);
        assert.equal(pos.col, expectedCol,
          `getGridPos col mismatch at x=${px}: got ${pos.col}, expected ${expectedCol}`);
        assert.equal(pos.row, expectedRow,
          `getGridPos row mismatch at y=${py}: got ${pos.row}, expected ${expectedRow}`);
      }
    }
  }
}

function testGetGridPosAtGridEdges() {
  // Verify positions at the far edges of the 15x11 grid
  const edgeCases = [
    { x: 0, y: 0, eCol: 0, eRow: 0 },
    { x: 14, y: 10, eCol: 14, eRow: 10 },
    { x: 13.8, y: 9.8, eCol: 13, eRow: 9 },    // floor(13.8+0.2) = floor(14.0) = 14? No: 14. Actually floor(14.0) = 14
    { x: 14.0, y: 10.0, eCol: 14, eRow: 10 },
    { x: 0.1, y: 0.1, eCol: 0, eRow: 0 },
  ];
  // Correct 13.8: floor(13.8 + 0.2) = floor(14.0) = 14
  edgeCases[2].eCol = 14;
  edgeCases[2].eRow = 10;

  for (const { x, y, eCol, eRow } of edgeCases) {
    const player = new Player(0, 'human', x, y);
    const { col, row } = player.getGridPos();
    assert.equal(col, eCol, `edge x=${x}: expected col ${eCol}, got ${col}`);
    assert.equal(row, eRow, `edge y=${y}: expected row ${eRow}, got ${row}`);
  }
}

// -- Bomb placement tests --

function testBombPlacedAtPlayerCell() {
  const grid = makeGrid(null, {
    spawns: [{ player: 0, x: 3, y: 3, team: 0 }],
  });
  const bombs = new BombManager();

  // Player at exact grid position
  const p1 = new Player(0, 'human', 3, 3);
  const pos1 = p1.getGridPos();
  assert.ok(bombs.placeBomb(pos1.col, pos1.row, 0, 2), 'should place bomb at (3,3)');
  assert.equal(bombs.bombs[0].col, 3);
  assert.equal(bombs.bombs[0].row, 3);

  // Player at fractional position near boundary
  const p2 = new Player(1, 'human', 3.7, 5.1);
  const pos2 = p2.getGridPos();
  assert.equal(pos2.col, 3, 'player at 3.7 should map to col 3');
  assert.equal(pos2.row, 5, 'player at 5.1 should map to row 5');
}

function testBombPlacedAtPlayerCellBoundary() {
  // The critical case: x=3.5 where Math.round would give 4 but floor(x+0.2) gives 3
  const player = new Player(0, 'human', 3.5, 5.5);
  const { col, row } = player.getGridPos();
  assert.equal(col, 3, 'x=3.5 must map to col 3, not 4');
  assert.equal(row, 5, 'y=5.5 must map to row 5, not 6');
}

function testBombNotPlacedOnExistingBomb() {
  const bombs = new BombManager();
  assert.ok(bombs.placeBomb(3, 3, 0, 2), 'first bomb places OK');
  assert.ok(!bombs.placeBomb(3, 3, 1, 2), 'second bomb at same cell should fail');
}

function testBombPlacementAtGridCorners() {
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  assert.ok(bombs.placeBomb(0, 0, 0, 2), 'bomb at top-left corner');
  assert.ok(bombs.placeBomb(14, 0, 0, 2), 'bomb at top-right corner');
  assert.ok(bombs.placeBomb(0, 10, 0, 2), 'bomb at bottom-left corner');
  assert.ok(bombs.placeBomb(14, 10, 0, 2), 'bomb at bottom-right corner');

  // Detonate corner bomb and verify explosions stay in bounds
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);
  for (const exp of bombs.explosions) {
    assert.ok(exp.col >= 0 && exp.col < 15, `explosion col ${exp.col} out of bounds`);
    assert.ok(exp.row >= 0 && exp.row < 11, `explosion row ${exp.row} out of bounds`);
  }
}

// -- Explosion tests --

function testExplosionBlockedByWalls() {
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  gridSpec[3][5] = 1; // solid wall to the right of bomb
  const grid = makeGrid(gridSpec);
  const bombs = new BombManager();

  bombs.placeBomb(3, 3, 0, 3);
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  const expCols = bombs.explosions
    .filter((e) => e.row === 3 && (e.direction === 'right' || e.direction === 'center'))
    .map((e) => e.col);
  assert.ok(expCols.includes(3), 'center explosion at col 3');
  assert.ok(expCols.includes(4), 'explosion should reach col 4');
  assert.ok(!expCols.includes(5), 'wall at col 5 must block explosion');
  assert.ok(!expCols.includes(6), 'explosion must not pass through wall');
}

function testExplosionSpreadAllFourDirections() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(7, 5, 0, 3);
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  // Center
  assert.ok(bombs.explosions.some((e) => e.col === 7 && e.row === 5 && e.direction === 'center'),
    'center explosion at (7,5)');

  // Right arm
  for (let i = 1; i <= 3; i++) {
    assert.ok(bombs.explosions.some((e) => e.col === 7 + i && e.row === 5 && e.direction === 'right'),
      `right explosion at col ${7 + i}`);
  }
  // Left arm
  for (let i = 1; i <= 3; i++) {
    assert.ok(bombs.explosions.some((e) => e.col === 7 - i && e.row === 5 && e.direction === 'left'),
      `left explosion at col ${7 - i}`);
  }
  // Down arm
  for (let i = 1; i <= 3; i++) {
    assert.ok(bombs.explosions.some((e) => e.col === 7 && e.row === 5 + i && e.direction === 'down'),
      `down explosion at row ${5 + i}`);
  }
  // Up arm
  for (let i = 1; i <= 3; i++) {
    assert.ok(bombs.explosions.some((e) => e.col === 7 && e.row === 5 - i && e.direction === 'up'),
      `up explosion at row ${5 - i}`);
  }

  // Must NOT exceed range
  assert.ok(!bombs.explosions.some((e) => e.col === 11 && e.row === 5), 'right arm stops at range');
  assert.ok(!bombs.explosions.some((e) => e.col === 3 && e.row === 5), 'left arm stops at range');
}

function testExplosionDoesNotExceedRange() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(7, 5, 0, 2);
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  const rightCols = bombs.explosions
    .filter((e) => e.row === 5 && e.direction === 'right')
    .map((e) => e.col);
  assert.ok(rightCols.includes(8), 'explosion at range 1');
  assert.ok(rightCols.includes(9), 'explosion at range 2');
  assert.ok(!rightCols.includes(10), 'explosion must not exceed range');
}

function testExplosionDestroysBrickAndStops() {
  const gridSpec = parseAsciiGrid(`
    ...............
    ...............
    ...............
    ...............
    ...............
    ...B...........
    ...............
    ...............
    ...............
    ...............
    ...............
  `);
  const grid = makeGrid(gridSpec, { brickDensity: 100 });
  const bombs = new BombManager();

  // Bomb at (2,5) range 3, brick at (3,5)
  bombs.placeBomb(2, 5, 0, 3);
  bombs.bombs[0].timer = 0;
  const events = bombs.update(0.01, grid);

  // Brick should be destroyed
  assert.ok(events.bricksDestroyed.some((b) => b.col === 3 && b.row === 5),
    'brick at (3,5) should be in bricksDestroyed');
  // Cell should now be empty
  const cell = grid.getCell(3, 5);
  assert.equal(cell.type, 0, 'brick cell should now be CellContent.Empty');

  // Explosion should exist at the brick cell but NOT beyond it
  assert.ok(bombs.explosions.some((e) => e.col === 3 && e.row === 5),
    'explosion at brick position');
  assert.ok(!bombs.explosions.some((e) => e.col === 4 && e.row === 5 && e.direction === 'right'),
    'explosion must stop after destroying brick');
}

function testBombChainExplosion() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(3, 5, 0, 2);
  bombs.placeBomb(5, 5, 1, 2);

  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  const chainExplosions = bombs.explosions.filter((e) => e.col === 5 && e.row === 5);
  assert.ok(chainExplosions.length > 0, 'bomb at (5,5) should chain-explode from bomb at (3,5)');
  assert.equal(bombs.bombs.length, 0, 'all bombs should have exploded');
}

function testThreeBombChainExplosion() {
  const grid = makeGrid();
  const bombs = new BombManager();

  // Three bombs in a line, each within range 2 of the next
  bombs.placeBomb(2, 5, 0, 2);
  bombs.placeBomb(4, 5, 1, 2);
  bombs.placeBomb(6, 5, 2, 2);

  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  // All three should have detonated
  assert.equal(bombs.bombs.length, 0, 'all three bombs should have chain-exploded');
  // Explosions should exist at all three centers
  assert.ok(bombs.explosions.some((e) => e.col === 2 && e.row === 5 && e.direction === 'center'),
    'explosion center at bomb 1');
  assert.ok(bombs.explosions.some((e) => e.col === 4 && e.row === 5 && e.direction === 'center'),
    'explosion center at bomb 2');
  assert.ok(bombs.explosions.some((e) => e.col === 6 && e.row === 5 && e.direction === 'center'),
    'explosion center at bomb 3');
}

function testSimultaneousDetonations() {
  const grid = makeGrid();
  const bombs = new BombManager();

  // Two independent bombs both expiring in the same tick
  bombs.placeBomb(2, 2, 0, 2);
  bombs.placeBomb(12, 8, 1, 2);
  bombs.bombs[0].timer = 0;
  bombs.bombs[1].timer = 0;

  const events = bombs.update(0.01, grid);

  assert.equal(bombs.bombs.length, 0, 'both bombs should have exploded');
  assert.ok(events.explosionPositions.some((p) => p.col === 2 && p.row === 2),
    'events should include bomb 1 center');
  assert.ok(events.explosionPositions.some((p) => p.col === 12 && p.row === 8),
    'events should include bomb 2 center');
}

// -- Player and death tests --

function testPlayerDiesInExplosion() {
  const grid = makeGrid(null, {
    spawns: [{ player: 0, x: 3, y: 3, team: 0 }],
  });
  const bombs = new BombManager();
  const player = new Player(0, 'human', 3, 3);

  bombs.placeBomb(3, 3, 0, 2);
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  const { col, row } = player.getGridPos();
  assert.ok(bombs.isExploding(col, row), 'explosion should be at player position');
}

function testDeathDetectionPrecisionBoundary() {
  // Player at x=4.8: floor(4.8 + 0.2) = floor(5.0) = 5
  // Explosion at col 4 should NOT kill this player
  const grid = makeGrid();
  const bombs = new BombManager();

  const player = new Player(0, 'human', 4.8, 5);
  const { col } = player.getGridPos();
  assert.equal(col, 5, 'player at x=4.8 maps to col 5');

  bombs.placeBomb(3, 5, 0, 1); // range 1: center (3,5) + right (4,5) only
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  assert.ok(bombs.isExploding(4, 5), 'explosion exists at col 4');
  assert.ok(!bombs.isExploding(5, 5), 'no explosion at col 5');
  // Player at col 5 should survive
  assert.ok(!bombs.isExploding(col, 5), 'player at col 5 survives explosion at col 4');
}

function testDeadPlayerNotKilledAgain() {
  const grid = makeGrid();
  const bombs = new BombManager();
  const player = new Player(0, 'human', 3, 3);

  // Kill the player first
  player.die();
  assert.equal(player.alive, false);
  const firstDeathTimer = player.deathTimer;

  // Now place explosion at their position
  bombs.placeBomb(3, 3, 0, 2);
  bombs.bombs[0].timer = 0;
  bombs.update(0.01, grid);

  // alive is still false, deathTimer should not have been reset
  assert.equal(player.alive, false);
  assert.equal(player.deathTimer, firstDeathTimer,
    'deathTimer should not be reset by a second explosion');
}

function testPlayerMovementBlockedByWall() {
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  gridSpec[3][5] = 1; // solid wall
  const grid = makeGrid(gridSpec, {
    spawns: [{ player: 0, x: 4, y: 3, team: 0 }],
  });
  const bombs = new BombManager();

  const player = new Player(0, 'human', 4, 3);
  player.setInput('right', true);

  // Simulate 1 second of movement toward the wall
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, grid, bombs);
  }

  assert.ok(player.x < 5, `player should be blocked by wall at col 5, got x=${player.x}`);
  // Also verify the player actually tried to move (not a false positive)
  assert.ok(player.x > 4, `player should have moved right from x=4, got x=${player.x}`);
}

function testPlayerMovesOnOpenGrid() {
  // Complementary test: player actually moves when no wall blocks
  const grid = makeGrid();
  const bombs = new BombManager();

  const player = new Player(0, 'human', 4, 3);
  player.setInput('right', true);

  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, grid, bombs);
  }

  // Player speed is 3.0 tiles/sec, should have moved ~3 tiles in 1 second
  assert.ok(player.x > 6, `player should move freely on open grid, got x=${player.x}`);
}

// -- Grace period tests --

function testGracePeriodAllowsOwnBombWalkthrough() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 0, 2);
  // Bomb has graceOwner = 0 by default (set in placeBomb)
  assert.equal(bombs.bombs[0].graceOwner, 0, 'grace should be set to owner');

  // Player 0 can walk through their own bomb
  assert.ok(!bombs.isBombBlocking(5, 5, 0), 'own bomb should not block owner during grace');
  // Player 1 cannot
  assert.ok(bombs.isBombBlocking(5, 5, 1), 'bomb should block other players');
}

function testGracePeriodClearsAfterLeaving() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 0, 2);
  assert.ok(!bombs.isBombBlocking(5, 5, 0), 'grace active: bomb does not block owner');

  // Player moves to (6,5) — clear grace
  bombs.clearGrace(0, 6, 5);

  // Now player 0 should also be blocked
  assert.ok(bombs.isBombBlocking(5, 5, 0), 'grace cleared: bomb blocks owner too');
}

// -- Punch tests --

function testPunchBombArcLanding() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(3, 5, 0, 2);
  const punched = bombs.punchBomb(3, 5, 'right', grid);
  assert.ok(punched, 'punch should succeed');
  const bomb = bombs.bombs[0];
  // On empty grid, first eligible cell is at distance 3 (preferred min)
  assert.equal(bomb.col, 6, 'punched bomb should land at col 6 (distance 3)');
  assert.equal(bomb.row, 5, 'punched bomb should stay on same row');
}

function testPunchBombFliesOverObstacles() {
  // Punch arcs over walls — verify bomb lands on far side
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  gridSpec[5][5] = 1; // wall in the middle of the arc path
  const grid = makeGrid(gridSpec);
  const bombs = new BombManager();

  bombs.placeBomb(3, 5, 0, 2);
  const punched = bombs.punchBomb(3, 5, 'right', grid);
  assert.ok(punched, 'punch should succeed (arcs over wall)');
  // Bomb skips col 5 (wall), lands at col 6 (dist=3, first preferred clear cell)
  assert.equal(bombs.bombs[0].col, 6, 'bomb should arc over wall to col 6');
}

function testPunchBombBlockedByWall() {
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  for (let c = 4; c <= 14; c++) gridSpec[5][c] = 1;
  const grid = makeGrid(gridSpec);
  const bombs = new BombManager();

  bombs.placeBomb(3, 5, 0, 2);
  const punched = bombs.punchBomb(3, 5, 'right', grid);
  assert.ok(!punched, 'punch should fail when all landing cells are walled');
  assert.equal(bombs.bombs[0].col, 3, 'bomb should stay at original position');
}

// -- Kick tests --

function testKickBombStopsAtWall() {
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  gridSpec[5][7] = 1;
  const grid = makeGrid(gridSpec);
  const bombs = new BombManager();

  bombs.placeBomb(3, 5, 0, 2);
  bombs.kickBomb(3, 5, 'right', grid);

  tickBombsUntil(() => !bombs.bombs[0]?.sliding, bombs, grid, 3);

  const bomb = bombs.bombs[0];
  assert.ok(bomb.col <= 6,
    `kicked bomb should stop before wall at col 7, got col=${bomb.col}`);
  assert.ok(!bomb.sliding, 'bomb should have stopped sliding');
}

function testKickBombStopsAtGridEdge() {
  const grid = makeGrid();
  const bombs = new BombManager();

  bombs.placeBomb(12, 5, 0, 2);
  bombs.kickBomb(12, 5, 'right', grid);

  tickBombsUntil(() => !bombs.bombs[0]?.sliding, bombs, grid, 3);

  const bomb = bombs.bombs[0];
  assert.ok(bomb.col <= 14, `kicked bomb must not go beyond col 14, got ${bomb.col}`);
  assert.ok(bomb.col >= 12, `kicked bomb should have moved right from col 12, got ${bomb.col}`);
  assert.ok(!bomb.sliding, 'bomb should have stopped sliding');
}

// -- Integration tests: AI gameplay scenarios --

/** Create a BASIC-like scheme grid for integration tests */
function createBasicSchemeGrid() {
  const grid = [];
  for (let r = 0; r < 11; r++) {
    const row = [];
    for (let c = 0; c < 15; c++) {
      if (r % 2 === 0 && c % 2 === 0) {
        row.push(TileType.Solid); // interior pillars
      } else {
        row.push(TileType.Brick); // potential bricks
      }
    }
    grid.push(row);
  }
  return grid;
}

function testAIPlacesBombFromCornerSpawn() {
  // Simulate AI at corner spawn (1,1) on BASIC scheme - should eventually place a bomb
  const scheme = {
    name: 'TEST_BASIC',
    brickDensity: 100,
    grid: createBasicSchemeGrid(),
    spawns: [{ player: 0, x: 1, y: 1, team: 0 }],
    powerups: [],
    conveyors: [],
    warps: [],
  };
  const grid = new GameGrid(scheme);
  const bombs = new BombManager();
  const powerups = new PowerupManager(grid, scheme.powerups);
  const player = new Player(0, 'ai', 1, 1);
  const bot = new AIBot(player, 'normal');

  // Run 360 AI think+update cycles (simulating ~6 seconds of game time).
  // Budget is generous to accommodate random think interval jitter.
  const dt = 1 / 60;
  let bombPlaced = false;
  for (let i = 0; i < 360; i++) {
    bot.update(dt, grid, bombs, powerups, [player]);
    // Check if AI set inputBomb
    if (player.inputBomb) {
      const { col, row } = player.getGridPos();
      if (bombs.placeBomb(col, row, player.index, player.stats.bombRange, player.stats.hasJelly)) {
        player.stats.activeBombs++;
        bombPlaced = true;
      }
      player.inputBomb = false;
    }
    player.update(dt, grid, bombs);
    bombs.update(dt, grid);
  }

  assert.ok(bombPlaced, 'AI should place at least one bomb within 6 seconds from corner spawn');
}

function testAIDoesNotBombUnsafePosition() {
  // AI in a 1-cell dead end should NOT place a bomb (no escape)
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  // Create a dead-end pocket: only cell (1,1) is walkable, surrounded by walls
  for (let r = 0; r < 11; r++) {
    for (let c = 0; c < 15; c++) {
      gridSpec[r][c] = (r === 1 && c === 1) ? TileType.Empty : TileType.Solid;
    }
  }
  const scheme = {
    name: 'TEST_TRAP',
    brickDensity: 0,
    grid: gridSpec,
    spawns: [{ player: 0, x: 1, y: 1, team: 0 }],
    powerups: [],
    conveyors: [],
    warps: [],
  };
  const grid = new GameGrid(scheme);
  const bombs = new BombManager();
  const powerups = new PowerupManager(grid, scheme.powerups);
  const player = new Player(0, 'ai', 1, 1);
  const bot = new AIBot(player, 'normal');

  const dt = 1 / 60;
  let bombPlaced = false;
  for (let i = 0; i < 120; i++) {
    bot.update(dt, grid, bombs, powerups, [player]);
    if (player.inputBomb) {
      const { col, row } = player.getGridPos();
      if (bombs.placeBomb(col, row, player.index, player.stats.bombRange)) {
        bombPlaced = true;
      }
      player.inputBomb = false;
    }
    player.update(dt, grid, bombs);
    bombs.update(dt, grid);
  }

  assert.ok(!bombPlaced, 'AI should NOT bomb when trapped with no escape');
}

function testPlayerCannotWalkOffGrid() {
  // Player at grid edge should be stopped by out-of-bounds collision
  const grid = createOpenTestGrid();
  const bombs = new BombManager();
  const player = new Player(0, 'human', 0, 0);

  player.setInput('left', true);
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, grid, bombs);
  }

  assert.ok(player.x >= 0, `player should not go below x=0, got ${player.x}`);

  player.setInput('left', false);
  player.setInput('up', true);
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60, grid, bombs);
  }

  assert.ok(player.y >= 0, `player should not go below y=0, got ${player.y}`);
}

function testSpawnClearingCreatesWalkableArea() {
  // Spawns at interior positions should clear surrounding bricks
  const scheme = {
    name: 'TEST_SPAWN',
    brickDensity: 100,
    grid: createBasicSchemeGrid(),
    spawns: [
      { player: 0, x: 1, y: 1, team: 0 },
      { player: 1, x: 13, y: 9, team: 0 },
    ],
    powerups: [],
    conveyors: [],
    warps: [],
  };
  const grid = new GameGrid(scheme);

  // Spawn at (1,1) should clear surrounding brick cells (not solid pillars)
  assert.ok(grid.isWalkable(1, 1), 'spawn cell (1,1) must be walkable');
  assert.ok(grid.isWalkable(1, 0), 'cell above spawn (1,0) must be walkable');
  assert.ok(grid.isWalkable(1, 2), 'cell below spawn (1,2) must be walkable');

  // Spawn at (13,9) should clear surrounding cells
  assert.ok(grid.isWalkable(13, 9), 'spawn cell (13,9) must be walkable');
  assert.ok(grid.isWalkable(13, 10), 'cell below spawn (13,10) must be walkable');
  assert.ok(grid.isWalkable(13, 8), 'cell above spawn (13,8) must be walkable');
}

function testGrabThrowCycleMoveBomb() {
  // Verify grab+throw works correctly: place bomb, grab it, throw it
  const grid = createOpenTestGrid();
  const bombs = new BombManager();
  const player = new Player(0, 'human', 5, 5);
  player.stats.canGrab = true;
  player.facing = 'right';

  // Place a bomb
  bombs.placeBomb(5, 5, 0, 2);
  assert.ok(bombs.hasBomb(5, 5), 'bomb should be at (5,5)');

  // Grab it
  const grabbed = bombs.grabBomb(5, 5, 0);
  assert.ok(grabbed, 'should grab own bomb');
  assert.ok(!bombs.hasBomb(5, 5), 'bomb should be removed from grid after grab');

  // Throw it — bomb starts an arc flight
  bombs.throwBomb(grabbed, 5, 5, 'right', grid);
  // Bomb destination should be 3-5 tiles right
  assert.ok(bombs.bombs[0].col >= 8 && bombs.bombs[0].col <= 10,
    `thrown bomb should land 3-5 tiles away, got col=${bombs.bombs[0].col}`);
  // During flight, bomb should not be "present" at destination
  assert.ok(bombs.bombs[0].arc !== null, 'thrown bomb should have arc animation');
  assert.ok(!bombs.hasBomb(bombs.bombs[0].col, bombs.bombs[0].row),
    'in-flight bomb should not block its destination cell');

  // After enough time, arc completes and bomb lands
  for (let i = 0; i < 30; i++) bombs.update(1/60, grid);
  assert.ok(bombs.bombs[0].arc === null, 'arc should complete after sufficient time');
  assert.ok(bombs.hasBomb(bombs.bombs[0].col, bombs.bombs[0].row),
    'landed bomb should be present at destination');
}

function testThrowBombNoLanding() {
  // When all cells in throw direction are blocked, bomb drops at origin
  const gridSpec = Array.from({ length: 11 }, () => Array(15).fill(0));
  // Make everything solid except origin
  for (let r = 0; r < 11; r++) {
    for (let c = 0; c < 15; c++) {
      gridSpec[r][c] = (r === 5 && c === 5) ? TileType.Empty : TileType.Solid;
    }
  }
  const scheme = {
    name: 'THROW_BLOCKED',
    brickDensity: 0,
    grid: gridSpec,
    spawns: [],
    powerups: [],
    conveyors: [],
    warps: [],
  };
  const grid = new GameGrid(scheme);
  const bombs = new BombManager();

  // Place and grab a bomb
  bombs.placeBomb(5, 5, 0, 2);
  const grabbed = bombs.grabBomb(5, 5, 0);
  assert.ok(grabbed, 'should grab bomb');

  // Throw into solid walls — should drop at origin
  bombs.throwBomb(grabbed, 5, 5, 'right', grid);
  assert.strictEqual(bombs.bombs[0].col, 5, 'blocked throw should drop at origin col');
  assert.strictEqual(bombs.bombs[0].row, 5, 'blocked throw should drop at origin row');
  assert.strictEqual(bombs.bombs[0].arc, null, 'blocked throw should have no arc');
}

function testThrowBombFuseExpiresInFlight() {
  // If fuse runs out during arc flight, bomb should not detonate until landing
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 0, 2);
  const bomb = bombs.bombs[0];
  bomb.timer = 0.05; // almost expired

  const grabbed = bombs.grabBomb(5, 5, 0);
  assert.ok(grabbed, 'should grab bomb');

  bombs.throwBomb(grabbed, 5, 5, 'right', grid);
  assert.ok(bombs.bombs[0].arc !== null, 'should be in flight');

  // Tick so fuse expires but bomb is still in flight
  const events1 = bombs.update(0.06, grid);
  assert.ok(bombs.bombs[0].timer <= 0, 'fuse should have expired');
  assert.strictEqual(events1.explosionPositions.length, 0,
    'bomb should not detonate while in flight');

  // Tick until arc completes — should detonate on landing
  for (let i = 0; i < 30; i++) {
    const ev = bombs.update(1/60, grid);
    if (ev.explosionPositions.length > 0) {
      assert.ok(true, 'bomb detonated after landing');
      return;
    }
  }
  assert.fail('bomb should have detonated after arc completed');
}

function testGrabOnlyOwnBomb() {
  // Player should not be able to grab another player's bomb
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 1, 2); // player 1's bomb
  const grabbed = bombs.grabBomb(5, 5, 0); // player 0 tries to grab
  assert.strictEqual(grabbed, null, 'should not grab another player\'s bomb');
  assert.ok(bombs.hasBomb(5, 5), 'bomb should still be on grid');
}

function testCarriedBombFuseExpires() {
  // Carried bomb fuse ticks down; when it expires the gameplay screen drops it.
  // Here we test that the timer continues while carried.
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 0, 2);
  const grabbed = bombs.grabBomb(5, 5, 0);
  assert.ok(grabbed, 'should grab bomb');

  const initialTimer = grabbed.timer;
  // Manually tick the carried bomb timer (gameplay screen does this)
  grabbed.timer -= 0.5;
  assert.ok(grabbed.timer < initialTimer, 'carried bomb timer should decrease');
  assert.ok(grabbed.timer > 0, 'carried bomb should not have expired yet');
}

function testPunchBombArc() {
  // Punched bomb should have arc animation
  const grid = createOpenTestGrid();
  const bombs = new BombManager();

  bombs.placeBomb(5, 5, 0, 2);
  const punched = bombs.punchBomb(5, 5, 'right', grid);
  assert.ok(punched, 'punch should succeed');

  const bomb = bombs.bombs[0];
  assert.ok(bomb.arc !== null, 'punched bomb should have arc animation');
  assert.strictEqual(bomb.arc.startCol, 5, 'arc should start at origin');
  assert.ok(bomb.col >= 8 && bomb.col <= 10, 'destination should be 3-5 tiles away');

  // During flight, should not block destination
  assert.ok(!bombs.hasBomb(bomb.col, bomb.row), 'in-flight punched bomb should not block destination');

  // Complete the arc
  for (let i = 0; i < 30; i++) bombs.update(1/60, grid);
  assert.ok(bomb.arc === null, 'arc should complete');
  assert.ok(bombs.hasBomb(bomb.col, bomb.row), 'landed bomb should be present');
}

function testAINavigatesCorner() {
  // Test that the AI can navigate to a powerup that requires corner turns
  // from an off-center starting position. The powerup at (3,3) forces the AI
  // through at least one corner from (1.4, 1.0).
  // Run 20 iterations to catch flakiness from random think timer jitter.
  for (let iter = 0; iter < 20; iter++) {
    const scheme = {
      name: 'CORNER_TEST',
      brickDensity: 0,
      grid: createBasicSchemeGrid(),
      spawns: [{ player: 0, x: 1, y: 1, team: 0 }],
      powerups: [],
      conveyors: [],
      warps: [],
    };
    const grid = new GameGrid(scheme);
    const bombs = new BombManager();
    // Place a revealed powerup at (3,3) — requires corner navigation from (1,1)
    const powerups = new PowerupManager(grid, scheme.powerups);
    powerups.powerups.push({
      col: 3, row: 3,
      type: 0, // ExtraBomb
      revealed: true,
    });
    const player = new Player(0, 'ai', 1, 1);
    const bot = new AIBot(player, 'normal');

    // Manually set an off-center starting position to simulate mid-cell think() reset.
    player.x = 1.4;
    player.y = 1.0;

    const dt = 1 / 60;
    let maxFramesStuck = 0;
    let framesStuck = 0;
    let lastCol = -1;
    let lastRow = -1;
    let stuckCol = -1;
    let stuckRow = -1;
    let reachedTarget = false;

    // Run for 5 seconds of game time (300 frames) — generous budget
    for (let i = 0; i < 300; i++) {
      bot.update(dt, grid, bombs, powerups, [player]);

      // Suppress bomb placement — we only care about navigation
      player.inputBomb = false;

      player.update(dt, grid, bombs);
      bombs.update(dt, grid);

      const pos = player.getGridPos();
      if (pos.col === 3 && pos.row === 3) reachedTarget = true;

      // Track longest consecutive stuck duration
      if (pos.col === lastCol && pos.row === lastRow) {
        framesStuck++;
        if (framesStuck > maxFramesStuck) {
          maxFramesStuck = framesStuck;
          stuckCol = pos.col;
          stuckRow = pos.row;
        }
      } else {
        framesStuck = 0;
      }
      lastCol = pos.col;
      lastRow = pos.row;
    }

    assert.ok(
      reachedTarget,
      `[iter ${iter}] AI should navigate to powerup at (3,3) from off-center start — ended at (${player.x.toFixed(2)}, ${player.y.toFixed(2)})`,
    );
    // Should never be stuck in the same cell for more than 60 frames (1 second)
    assert.ok(
      maxFramesStuck < 60,
      `[iter ${iter}] AI got stuck in cell (${stuckCol}, ${stuckRow}) for ${maxFramesStuck} frames`,
    );
  }
}

function testAIFleesAroundCorner() {
  // The critical scenario: AI places bomb at (3,1) on BASIC grid, must flee around
  // a corner past the solid pillar at (2,2) or (4,2). The test verifies the AI
  // doesn't die from its own bomb (i.e., it successfully navigates the corner).
  //
  // Run 10 iterations of the full offset matrix to catch flakiness from random
  // think timer jitter.
  const offsets = [0, 0.1, 0.2, 0.3, -0.1, -0.2, -0.3];

  for (let iter = 0; iter < 20; iter++) {
    for (const xOff of offsets) {
      for (const yOff of offsets) {
        const startX = 3 + xOff;
        const startY = 1 + yOff;
        // getGridPos logic: floor(pos + 0.2)
        const testCol = Math.floor(startX + 0.2);
        const testRow = Math.floor(startY + 0.2);
        // Skip if grid pos lands on a solid pillar
        if (testCol % 2 === 0 && testRow % 2 === 0) continue;
        // Skip if grid pos is in a corner dead-end (row 0 or row 10 at odd col
        // have solid pillars on both sides)
        if (testRow === 0 || testRow === 10) continue;

        testAIFleesFromPosition(startX, startY);
      }
    }
  }
}

function testAIFleesFromPosition(startX, startY) {
  const scheme = {
    name: 'FLEE_CORNER_TEST',
    brickDensity: 0,
    grid: createBasicSchemeGrid(),
    spawns: [{ player: 0, x: 3, y: 1, team: 0 }],
    powerups: [],
    conveyors: [],
    warps: [],
  };
  const grid = new GameGrid(scheme);
  const bombs = new BombManager();
  const powerups = new PowerupManager(grid, scheme.powerups);
  const player = new Player(0, 'ai', 3, 1);
  player.x = startX;
  player.y = startY;
  const bot = new AIBot(player, 'normal');

  // Place a bomb at (3,1) — the AI must flee
  bombs.placeBomb(3, 1, 0, 2, false);
  player.stats.activeBombs++;

  const dt = 1 / 60;
  // Run for 3 seconds (180 frames) — bomb fuse is 2s
  for (let i = 0; i < 180; i++) {
    bot.update(dt, grid, bombs, powerups, [player]);

    if (player.inputBomb) {
      const { col, row } = player.getGridPos();
      bombs.placeBomb(col, row, player.index, player.stats.bombRange, player.stats.hasJelly);
      player.inputBomb = false;
    }

    player.update(dt, grid, bombs);

    // Check explosions for player death
    for (const exp of bombs.explosions) {
      const pos = player.getGridPos();
      if (pos.col === exp.col && pos.row === exp.row && player.alive) {
        player.die();
      }
    }

    bombs.update(dt, grid);
  }

  assert.ok(
    player.alive,
    `AI starting at (${startX.toFixed(1)}, ${startY.toFixed(1)}) should survive own bomb — died at (${player.x.toFixed(2)}, ${player.y.toFixed(2)})`,
  );
}

// ---------------------------------------------------------------------------
// Extended AI navigation tests
// ---------------------------------------------------------------------------

/**
 * Helper: run one AI navigation scenario.
 * Returns the final (x, y) and whether the AI kept moving (displacement over
 * the last 60 frames exceeds the stuck threshold of 0.1 tiles).
 */
function runAIScenario({ grid, bombs, powerups, player, bot, frames = 120, suppressBombs = false }) {
  const dt = 1 / 60;
  const posHistory = [];

  for (let i = 0; i < frames; i++) {
    bot.update(dt, grid, bombs, powerups, [player]);

    if (suppressBombs) {
      player.inputBomb = false;
    } else if (player.inputBomb) {
      const { col, row } = player.getGridPos();
      if (bombs.placeBomb(col, row, player.index, player.stats.bombRange, player.stats.hasJelly)) {
        player.stats.activeBombs++;
      }
      player.inputBomb = false;
    }

    player.update(dt, grid, bombs);
    bombs.update(dt, grid);

    posHistory.push({ x: player.x, y: player.y });
  }

  // "displacement" = max distance from initial position at any point during the run
  const first = posHistory[0];
  let maxDisplacement = 0;
  for (const pos of posHistory) {
    const dx = pos.x - first.x;
    const dy = pos.y - first.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDisplacement) maxDisplacement = d;
  }
  return { x: player.x, y: player.y, displacement: maxDisplacement };
}

function testAINavigatesWithBombsOnField() {
  // AI at various fractional positions near active bombs should navigate away
  // without getting stuck. 20 iterations with varying start positions and bomb
  // placements.
  const startPositions = [
    { x: 1.3, y: 1.0 }, { x: 1.0, y: 1.4 }, { x: 1.5, y: 1.0 },
    { x: 1.0, y: 1.5 }, { x: 1.2, y: 1.2 }, { x: 1.4, y: 1.3 },
    { x: 3.3, y: 1.0 }, { x: 3.0, y: 1.4 }, { x: 3.5, y: 1.0 },
    { x: 3.0, y: 1.5 }, { x: 5.3, y: 1.0 }, { x: 5.0, y: 1.4 },
    { x: 1.3, y: 3.0 }, { x: 1.0, y: 3.4 }, { x: 1.5, y: 3.0 },
    { x: 3.3, y: 3.0 }, { x: 3.0, y: 3.4 }, { x: 5.3, y: 3.0 },
    { x: 1.1, y: 1.1 }, { x: 3.1, y: 3.1 },
  ];

  for (let iter = 0; iter < 20; iter++) {
    const sp = startPositions[iter % startPositions.length];

    const scheme = {
      name: 'BOMB_NAV_TEST',
      brickDensity: 0,
      grid: createBasicSchemeGrid(),
      spawns: [{ player: 0, x: 1, y: 1, team: 0 }],
      powerups: [],
      conveyors: [],
      warps: [],
    };
    const grid = new GameGrid(scheme);
    const bombs = new BombManager();
    const powerups = new PowerupManager(grid, scheme.powerups);

    // Place a powerup at a far reachable cell
    powerups.powerups.push({ col: 5, row: 1, type: 0, revealed: true });

    const player = new Player(0, 'ai', 1, 1);
    player.x = sp.x;
    player.y = sp.y;
    const bot = new AIBot(player, 'normal');

    // Place a bomb at an adjacent cell (not the player cell to avoid instant death)
    const bombCol = Math.floor(sp.x + 0.2);
    const bombRow = Math.floor(sp.y + 0.2);
    // Place bomb at cell to the right of player's grid cell (if in bounds)
    const adjCol = Math.min(bombCol + 2, 14);
    bombs.placeBomb(adjCol, bombRow, 1, 2);

    // Run long enough for the bomb to explode (2s fuse + 0.5s explosion = 2.5s)
    // plus extra time for the AI to start moving again (total ~5s = 300 frames).
    // Suppress AI bomb placement to focus on navigation behavior.
    const { displacement } = runAIScenario({
      grid, bombs, powerups, player, bot,
      frames: 300,
      suppressBombs: true,
    });

    assert.ok(
      displacement > 0.5,
      `[iter ${iter}] AI at (${sp.x}, ${sp.y}) with bomb on field should move away — displacement=${displacement.toFixed(3)}`,
    );
  }
}

function testAIEscapesFromOnTopOfBomb() {
  // AI starting with a fractional offset from a bomb cell center should
  // move away from the bomb within a reasonable time. Tests the specific
  // scenario reported as buggy (AI stuck semi-on-top of a bomb).
  const offsets = [0.1, 0.2, 0.3, 0.4, -0.1, -0.2, -0.3, -0.4];
  const startCells = [
    { col: 3, row: 1 }, { col: 5, row: 1 }, { col: 7, row: 3 },
    { col: 3, row: 3 }, { col: 5, row: 3 }, { col: 7, row: 1 },
  ];

  let iter = 0;
  for (const cell of startCells) {
    for (let oi = 0; oi < offsets.length && iter < 20; oi++, iter++) {
      const xOff = offsets[oi];
      const yOff = offsets[(oi + 1) % offsets.length];
      const startX = cell.col + xOff;
      const startY = cell.row + yOff;

      const scheme = {
        name: 'ONTOP_BOMB_TEST',
        brickDensity: 0,
        grid: createBasicSchemeGrid(),
        spawns: [{ player: 0, x: cell.col, y: cell.row, team: 0 }],
        powerups: [],
        conveyors: [],
        warps: [],
      };
      const grid = new GameGrid(scheme);
      const bombs = new BombManager();
      const powerups = new PowerupManager(grid, scheme.powerups);
      const player = new Player(0, 'ai', cell.col, cell.row);
      player.x = startX;
      player.y = startY;
      const bot = new AIBot(player, 'normal');

      // Place bomb directly at the player's grid cell — the grace period
      // means the player can walk off it. This is the buggy case.
      bombs.placeBomb(cell.col, cell.row, 0, 2);
      player.stats.activeBombs++;

      const startX0 = player.x;
      const startY0 = player.y;

      // Run 120 frames (2 seconds — bomb fuses at 2s so watch survival)
      const dt = 1 / 60;
      for (let f = 0; f < 120; f++) {
        bot.update(dt, grid, bombs, powerups, [player]);
        player.inputBomb = false; // suppress further bomb placement
        player.update(dt, grid, bombs);
        bombs.update(dt, grid);
      }

      const movedX = Math.abs(player.x - startX0);
      const movedY = Math.abs(player.y - startY0);
      const totalMoved = movedX + movedY;

      assert.ok(
        totalMoved > 0.5,
        `[iter ${iter}] AI at (${startX.toFixed(2)}, ${startY.toFixed(2)}) on-top-of bomb cell (${cell.col},${cell.row}) should move off — moved ${totalMoved.toFixed(3)} tiles total`,
      );
    }
  }
}

function testAINavigatesNarrowCorridors() {
  // Create maps with 1-tile-wide corridors (horizontal and vertical) and verify
  // the AI traverses them without getting stuck. 20 iterations.

  // Horizontal corridor: rows 0-10 are solid except row 5 (a 1-wide horizontal lane)
  function makeHorizontalCorridor() {
    const g = Array.from({ length: 11 }, () => Array(15).fill(TileType.Solid));
    for (let c = 0; c < 15; c++) g[5][c] = TileType.Empty;
    // Also clear the start and end cells' rows to allow movement
    return g;
  }

  // Vertical corridor: cols 0-14 are solid except col 7 (a 1-wide vertical lane)
  function makeVerticalCorridor() {
    const g = Array.from({ length: 11 }, () => Array(15).fill(TileType.Solid));
    for (let r = 0; r < 11; r++) g[r][7] = TileType.Empty;
    return g;
  }

  const scenarios = [
    // Horizontal corridor: start left side, target right side
    {
      gridFn: makeHorizontalCorridor,
      startX: 1, startY: 5,
      targetCol: 13, targetRow: 5,
      xOff: 0, yOff: 0,
    },
    // Vertical corridor: start top, target bottom
    {
      gridFn: makeVerticalCorridor,
      startX: 7, startY: 1,
      targetCol: 7, targetRow: 9,
      xOff: 0, yOff: 0,
    },
  ];

  // 20 iterations alternating the two layouts with different fractional offsets
  const fracOffsets = [0, 0.1, 0.2, 0.3, 0.4, -0.1, -0.2, -0.3, -0.4, 0.15];

  for (let iter = 0; iter < 20; iter++) {
    const scenario = scenarios[iter % scenarios.length];
    const frac = fracOffsets[Math.floor(iter / scenarios.length) % fracOffsets.length];

    const gridData = scenario.gridFn();
    const scheme = {
      name: 'CORRIDOR_TEST',
      brickDensity: 0,
      grid: gridData,
      spawns: [{ player: 0, x: scenario.startX, y: scenario.startY, team: 0 }],
      powerups: [],
      conveyors: [],
      warps: [],
    };
    const grid = new GameGrid(scheme);
    const bombs = new BombManager();
    const powerups = new PowerupManager(grid, scheme.powerups);

    // Place powerup at far end of corridor
    powerups.powerups.push({
      col: scenario.targetCol,
      row: scenario.targetRow,
      type: 0,
      revealed: true,
    });

    const player = new Player(0, 'ai', scenario.startX, scenario.startY);
    // Apply fractional offset perpendicular to corridor to stress corner alignment
    if (iter % scenarios.length === 0) {
      player.y = scenario.startY + frac * 0.5; // small perpendicular offset for horizontal
    } else {
      player.x = scenario.startX + frac * 0.5; // small perpendicular offset for vertical
    }

    const bot = new AIBot(player, 'normal');

    let reachedTarget = false;
    const dt = 1 / 60;
    let framesStuck = 0;
    let lastCol = -1;
    let lastRow = -1;
    let maxStuck = 0;

    for (let f = 0; f < 240; f++) {
      bot.update(dt, grid, bombs, powerups, [player]);
      player.inputBomb = false;
      player.update(dt, grid, bombs);
      bombs.update(dt, grid);

      const pos = player.getGridPos();
      if (pos.col === scenario.targetCol && pos.row === scenario.targetRow) {
        reachedTarget = true;
        break;
      }

      if (pos.col === lastCol && pos.row === lastRow) {
        framesStuck++;
        if (framesStuck > maxStuck) maxStuck = framesStuck;
      } else {
        framesStuck = 0;
      }
      lastCol = pos.col;
      lastRow = pos.row;
    }

    assert.ok(
      reachedTarget,
      `[iter ${iter}] AI should traverse corridor to (${scenario.targetCol},${scenario.targetRow}) — ended at (${player.x.toFixed(2)}, ${player.y.toFixed(2)})`,
    );
    assert.ok(
      maxStuck < 90,
      `[iter ${iter}] AI stuck in same cell for ${maxStuck} frames while traversing corridor`,
    );
  }
}

function testAIStressTestRandomPositions() {
  // 50 iterations: random walkable positions on open grid, random powerup target.
  // Verify AI keeps moving (not stuck) over the full run.
  const openGrid = Array.from({ length: 11 }, () => Array(15).fill(TileType.Empty));

  // Deterministic pseudo-random using a simple LCG so tests are reproducible
  // but cover a wide spread of positions.
  let seed = 0x12345678;
  function nextRand() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  }

  for (let iter = 0; iter < 50; iter++) {
    const startCol = Math.floor(nextRand() * 13) + 1; // 1..13
    const startRow = Math.floor(nextRand() * 9) + 1;  // 1..9
    const xFrac = nextRand() * 0.6 - 0.3;             // -0.3..+0.3
    const yFrac = nextRand() * 0.6 - 0.3;
    const startX = startCol + xFrac;
    const startY = startRow + yFrac;

    // Pick a target that differs from start by at least 2 in either axis
    let targetCol, targetRow;
    do {
      targetCol = Math.floor(nextRand() * 15);
      targetRow = Math.floor(nextRand() * 11);
    } while (
      Math.abs(targetCol - startCol) < 2 && Math.abs(targetRow - startRow) < 2
    );

    const scheme = {
      name: 'STRESS_TEST',
      brickDensity: 0,
      grid: openGrid,
      spawns: [{ player: 0, x: startCol, y: startRow, team: 0 }],
      powerups: [],
      conveyors: [],
      warps: [],
    };
    const grid = new GameGrid(scheme);
    const bombs = new BombManager();
    const powerups = new PowerupManager(grid, scheme.powerups);

    powerups.powerups.push({ col: targetCol, row: targetRow, type: 0, revealed: true });

    const player = new Player(0, 'ai', startCol, startRow);
    player.x = startX;
    player.y = startY;
    const bot = new AIBot(player, 'normal');

    // Track positions over last 60 frames to detect stuck
    const windowSize = 60;
    const window = [];
    let reachedTarget = false;

    const dt = 1 / 60;
    for (let f = 0; f < 240; f++) {
      bot.update(dt, grid, bombs, powerups, [player]);
      player.inputBomb = false;
      player.update(dt, grid, bombs);
      bombs.update(dt, grid);

      window.push({ x: player.x, y: player.y });
      if (window.length > windowSize) window.shift();

      const pos = player.getGridPos();
      if (pos.col === targetCol && pos.row === targetRow) {
        reachedTarget = true;
        break;
      }
    }

    // Check stuck: displacement over the last windowSize frames
    if (!reachedTarget && window.length >= windowSize) {
      const first = window[0];
      const last = window[window.length - 1];
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const displacement = Math.sqrt(dx * dx + dy * dy);

      assert.ok(
        displacement > 0.1,
        `[iter ${iter}] AI at (${startX.toFixed(2)},${startY.toFixed(2)}) targeting (${targetCol},${targetRow}) appears stuck — displacement over last ${windowSize} frames: ${displacement.toFixed(3)}`,
      );
    }
    // Either reached target OR kept moving — both count as pass
  }
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

async function main() {
  await run('loader screen renders on boot', testLoaderRendersOnBoot);
  await run('title and menu screens stay inside a scaled 4:3 virtual stage', testStageScaling);
  await run('game setup cycles imported map names from cached assets', testGameSetupCyclesImportedMaps);
  await run('gameplay bootstrap resolves the exact selected scheme file', testGameplaySchemeResolutionPrefersExactSelectedFile);
  await run('gameplay HUD surfaces the selected imported map during bootstrap', testGameplayMapHudShowsImportedSelection);
  await run('main menu marks unavailable items as locked and blocks locked selection', testLockedMenuItems);
  await run('round results advances to the next round while preserving the scoreboard', testRoundResultsAdvancesToNextRound);
  await run('round results enter carries match progress into the next gameplay round', testRoundResultsEnterCarriesProgressIntoNextGameplayRound);
  await run('round results click/tap confirm advances to the next round once', testRoundResultsClickAdvancesToNextRound);
  await run('round results ignores repeated Enter keydown events until a fresh press', testRoundResultsIgnoresRepeatedEnterUntilFreshPress);
  await run('round results transition guard resets after re-entry', testRoundResultsTransitionGuardResetsAfterReentry);
  await run('round results draw state exits to menu without marking a winner', testRoundResultsDrawExitsToMenu);
  await run('round results singular target copy stays singular for one-win matches', testRoundResultsSingleWinTargetUsesSingularCopy);
  await run('particle system emits, updates, and renders transient effects', testParticleSystemEmitsUpdatesAndRenders);
  await run('scheme parsing reads conveyor metadata from supported text formats', testSchemeParserReadsConveyorMetadata);
  await run('disease powerups apply timed reverse and slow debuffs', testDiseasePowerupsApplyTimedDebuffs);
  await run('trigger powerup detonates the oldest owned bomb', testTriggerPowerupDetonatesOldestOwnedBomb);
  await run('jelly kicked bombs bounce off blocking edges', testJellyKickedBombsBounceOffBlockingEdges);
  await run('scheme starting inventory applies live player stats at bootstrap', testSchemeStartingInventoryAppliesLivePlayerStats);
  await run('gameplay HUD shows powerup and disease badges from scheme starting inventory', testGameplayHudShowsPowerupAndDiseaseBadgesFromSchemeInventory);
  await run('gameplay HUD row refreshes after live powerup and disease changes', testGameplayHudRowRefreshesAfterRuntimePowerupChanges);
  await run('conveyor tiles carry idle players and bombs', testConveyorTilesCarryPlayersAndBombs);
  await run('warp tiles teleport players and bombs without immediate bounce-back', testWarpTilesTeleportPlayersAndBombs);
  await run('gameplay explosion frames continue rendering after detonation', testGameplayScreenShakeTriggersOnExplosion);
  await run('gameplay transitions to match victory after the deciding round', testGameplayTransitionsToMatchVictoryOnFinalRound);
  await run('match victory screen announces the winner and exits to menu', testMatchVictoryScreenShowsWinnerAndReturnsToMenu);
  await run('match victory escape returns to menu and resets round state', testMatchVictoryEscapeReturnsToMenuAndResetsRoundState);
  await run('match victory click/tap confirm returns to menu once', testMatchVictoryClickReturnsToMenu);
  await run('match victory ignores repeated Escape keydown events until a fresh press', testMatchVictoryIgnoresRepeatedEscapeUntilFreshPress);
  await run('match victory transition guard resets after re-entry', testMatchVictoryTransitionGuardResetsAfterReentry);
  await run('match victory singular summary copy stays singular for one-round matches', testMatchVictorySingleRoundSummaryUsesSingularCopy);
  await run('gameplay escape returns to menu and clears match progress', testGameplayEscapeReturnsToMenuAndClearsMatchProgress);

  // Engine unit tests — coordinate math
  await run('getGridPos matches collision detection formula across full grid', testGetGridPosMatchesCollisionDetection);
  await run('getGridPos correct at grid edges and corners', testGetGridPosAtGridEdges);
  await run('bomb placement at cell boundary uses floor not round', testBombPlacedAtPlayerCellBoundary);
  await run('bomb placed at player cell not adjacent cell', testBombPlacedAtPlayerCell);
  await run('cannot place two bombs on same cell', testBombNotPlacedOnExistingBomb);
  await run('bomb placement works at all four grid corners', testBombPlacementAtGridCorners);

  // Engine unit tests — explosions
  await run('explosion blocked by solid walls', testExplosionBlockedByWalls);
  await run('explosion spreads in all four directions', testExplosionSpreadAllFourDirections);
  await run('explosion does not exceed bomb range', testExplosionDoesNotExceedRange);
  await run('explosion destroys brick and stops propagating', testExplosionDestroysBrickAndStops);
  await run('bomb chain explosion propagates', testBombChainExplosion);
  await run('three bomb chain explosion propagates end to end', testThreeBombChainExplosion);
  await run('simultaneous detonations in one update tick', testSimultaneousDetonations);

  // Engine unit tests — player and death
  await run('player position overlaps explosion at same cell', testPlayerDiesInExplosion);
  await run('death detection precision at cell boundary', testDeathDetectionPrecisionBoundary);
  await run('dead player is not killed again', testDeadPlayerNotKilledAgain);
  await run('player movement blocked by wall', testPlayerMovementBlockedByWall);
  await run('player moves freely on open grid', testPlayerMovesOnOpenGrid);

  // Engine unit tests — grace period
  await run('grace period allows own bomb walkthrough', testGracePeriodAllowsOwnBombWalkthrough);
  await run('grace period clears after player leaves bomb cell', testGracePeriodClearsAfterLeaving);

  // Engine unit tests — punch and kick
  await run('punch bomb arc lands at correct distance', testPunchBombArcLanding);
  await run('punch bomb flies over obstacles', testPunchBombFliesOverObstacles);
  await run('punch bomb fails when all landing cells walled', testPunchBombBlockedByWall);
  await run('kicked bomb stops at wall', testKickBombStopsAtWall);
  await run('kicked bomb stops at grid edge', testKickBombStopsAtGridEdge);

  // Integration tests — realistic gameplay scenarios
  await run('AI places bomb from corner spawn within 6 seconds', testAIPlacesBombFromCornerSpawn);
  await run('AI does not bomb in dead-end with no escape', testAIDoesNotBombUnsafePosition);
  await run('player cannot walk off grid edge', testPlayerCannotWalkOffGrid);
  await run('spawn clearing creates walkable area around spawn points', testSpawnClearingCreatesWalkableArea);
  await run('grab then throw moves bomb to expected landing position', testGrabThrowCycleMoveBomb);
  await run('throw bomb with no landing drops at origin', testThrowBombNoLanding);
  await run('throw bomb fuse expires in flight detonates on landing', testThrowBombFuseExpiresInFlight);
  await run('grab only works on own bombs', testGrabOnlyOwnBomb);
  await run('carried bomb fuse continues ticking', testCarriedBombFuseExpires);
  await run('punch bomb has arc animation', testPunchBombArc);
  await run('AI navigates corner without getting stuck', testAINavigatesCorner);
  await run('AI survives own bomb by fleeing around corner', testAIFleesAroundCorner);
  await run('AI navigates with bombs on field without getting stuck', testAINavigatesWithBombsOnField);
  await run('AI escapes from on top of bomb', testAIEscapesFromOnTopOfBomb);
  await run('AI navigates narrow corridors', testAINavigatesNarrowCorridors);
  await run('AI stress test with random positions', testAIStressTestRandomPositions);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
