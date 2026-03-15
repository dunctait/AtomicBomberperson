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
const { gameConfig } = require('../src/screens/game-config.ts');
const {
  createGameplayScreen,
  getGameplayMapMeta,
  resolveSchemeFile,
} = require('../src/screens/gameplay-screen.ts');
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
    return {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '10px monospace',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      filter: 'none',
      imageSmoothingEnabled: false,
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      fillRect() {},
      strokeRect() {},
      arc() {},
      fillText() {},
      save() {},
      restore() {},
      drawImage() {},
      putImageData() {},
    };
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
    assert.equal(
      container.querySelector('.gameplay-scheme-summary')?.textContent,
      'SPAWNS 2 | TEAMS 2 | POWERUPS 1 ON / 1 OFF',
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

    gameplayScreen.onExit();
  });
}

async function testLockedMenuItems() {
  await withDom(async () => {
    const transitions = [];
    const container = createContainer();
    const menuScreen = createMainMenu((state) => transitions.push(state));
    menuScreen.onEnter(container);

    assert.equal(container.querySelectorAll('.menu-item--locked').length, 6);
    assert.ok(container.querySelector('.menu-item--locked .menu-lock'));

    menuScreen.onKeyDown({ key: 'ArrowDown' });
    assert.match(container.querySelectorAll('.menu-item')[1]?.className ?? '', /menu-item--selected/);

    menuScreen.onKeyDown({ key: 'Enter' });
    assert.equal(container.querySelector('.menu-toast')?.textContent, 'START NETWORK GAME locked');
    assert.equal(container.querySelector('.setup-screen'), null);
    assert.deepEqual(transitions, []);

    menuScreen.onExit();
  });
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

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
