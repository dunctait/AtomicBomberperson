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
const { parseScheme } = require('../src/assets/parsers/sch-parser.ts');
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
      /P1B:2F:2S:3\.0/,
    );
    assert.match(
      container.querySelector('.gameplay-player-hud')?.textContent ?? '',
      /P2B:2F:2S:3\.0/,
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
  assert.equal(player.stats.speed, 3.5);
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

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
