import { test, expect } from '@playwright/test';

test('loader screen renders on boot', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.loader-title')).toHaveText('ATOMIC BOMBERPERSON');
  await expect(page.locator('.load-btn')).toBeDisabled();
  await expect(page.locator('.dropzone-label')).toContainText('.zip');
});

test('title and menu screens stay inside a scaled 4:3 virtual stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    window.localStorage.clear();

    const openRequest = indexedDB.open('AtomicBomberperson', 1);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata');
      }
    };

    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const tx = db.transaction(['files', 'metadata'], 'readwrite');
      tx.objectStore('files').clear();
      tx.objectStore('metadata').clear();
      tx.objectStore('metadata').put({
        importedAt: Date.now(),
        fileCount: 0,
        totalSize: 0,
      }, 'import');
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Use Cached Assets' }).click();

  const titleStage = page.locator('.stage-screen.title-screen');
  await expect(titleStage).toBeVisible();

  const titleBox = await titleStage.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(titleBox!.width / titleBox!.height).toBeCloseTo(4 / 3, 2);
  expect(titleBox!.width).toBeCloseTo(960, 0);
  expect(titleBox!.height).toBeCloseTo(720, 0);

  await page.keyboard.press('Enter');

  const menuStage = page.locator('.stage-screen.menu-screen');
  await expect(menuStage).toBeVisible();

  const menuBox = await menuStage.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.width / menuBox!.height).toBeCloseTo(4 / 3, 2);
  expect(menuBox!.width).toBeCloseTo(960, 0);
  expect(menuBox!.height).toBeCloseTo(720, 0);
});

test('game setup cycles imported map names from cached assets', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();

    const openRequest = indexedDB.open('AtomicBomberperson', 1);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata');
      }
    };

    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const tx = db.transaction(['files', 'metadata'], 'readwrite');
      tx.objectStore('files').clear();
      tx.objectStore('metadata').clear();
      tx.objectStore('files').put(new TextEncoder().encode('scheme one').buffer, 'maps/arena.sch');
      tx.objectStore('files').put(new TextEncoder().encode('scheme two').buffer, 'maps/castle.sch');
      tx.objectStore('metadata').put({
        importedAt: Date.now(),
        fileCount: 2,
        totalSize: 20,
      }, 'import');
    };
  });

  await page.goto('/');

  await page.getByRole('button', { name: 'Use Cached Assets' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const mapValue = page.locator('.setup-map-value');
  await expect(mapValue).toHaveText('ARENA');

  await page.locator('.setup-map-btn').last().click();
  await expect(mapValue).toHaveText('CASTLE');

  await page.locator('.setup-map-btn').first().click();
  await expect(mapValue).toHaveText('ARENA');
});

test('main menu marks unavailable items as locked and surfaces their phase hint', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();

    const openRequest = indexedDB.open('AtomicBomberperson', 1);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata');
      }
    };

    openRequest.onsuccess = () => {
      const db = openRequest.result;
      const tx = db.transaction(['files', 'metadata'], 'readwrite');
      tx.objectStore('files').clear();
      tx.objectStore('metadata').clear();
      tx.objectStore('metadata').put({
        importedAt: Date.now(),
        fileCount: 0,
        totalSize: 0,
      }, 'import');
    };
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Use Cached Assets' }).click();
  await page.keyboard.press('Enter');

  await expect(page.locator('.menu-item--locked')).toHaveCount(3);
  await expect(page.locator('.menu-item--locked .menu-lock').first()).toBeVisible();
  await expect(page.locator('.menu-item--locked .menu-phase-hint').first()).toHaveText('PHASE 2');

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu-item').nth(1)).toHaveClass(/menu-item--selected/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-toast')).toHaveText('OPTIONS locked - PHASE 2');
  await expect(page.locator('.setup-screen')).toHaveCount(0);
});
