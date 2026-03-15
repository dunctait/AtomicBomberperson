/**
 * Asset manager: accepts a zip File or URL, extracts with JSZip,
 * and stores raw buffers in IndexedDB.  Emits progress callbacks.
 */

import JSZip from 'jszip';
import {
  storeFile,
  storeMetadata,
  getMetadata,
  getAllFileNames,
  hasAssets,
  clearAll,
  type AssetMetadata,
} from './asset-db';

export type ProgressCallback = (message: string, fraction: number) => void;

export interface AssetSummary {
  fileCount: number;
  totalSize: number;
  extensions: Record<string, number>; // extension -> count
}

const FETCH_TIMEOUT_MS = 30_000;
const REQUIRED_GAME_EXTENSIONS = ['.pcx', '.ani', '.sch'];

/** Read a File into an ArrayBuffer. */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Load assets from either a user-supplied File or a URL string.
 * Extracts the zip and stores every file in IndexedDB.
 */
export async function loadAssets(
  source: File | string,
  onProgress?: ProgressCallback,
): Promise<AssetSummary> {
  const report = (msg: string, frac: number) => onProgress?.(msg, frac);

  // --- Obtain the raw zip bytes ---
  let zipBuffer: ArrayBuffer;

  if (source instanceof File) {
    if (!source.name.toLowerCase().endsWith('.zip')) {
      throw new Error('Please select a .zip file.');
    }
    report('Reading uploaded file...', 0);
    zipBuffer = await readFileAsArrayBuffer(source);
  } else {
    const url = source.trim();
    if (!url) {
      throw new Error('Please enter a URL.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Please enter a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http:// or https:// URLs are supported.');
    }

    report('Downloading zip from URL...', 0);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), { signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Download timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`);
      }
      throw new Error('Failed to download zip from URL.');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    zipBuffer = await response.arrayBuffer();
  }

  report('Opening zip archive...', 0.1);

  // --- Parse the zip ---
  const zip = await JSZip.loadAsync(zipBuffer);

  // Collect non-directory entries
  const entries: { name: string; zipObj: JSZip.JSZipObject }[] = [];
  zip.forEach((relativePath, zipObj) => {
    if (!zipObj.dir) {
      entries.push({ name: relativePath, zipObj });
    }
  });

  const totalFiles = entries.length;
  if (totalFiles === 0) {
    throw new Error('The zip archive contains no files.');
  }

  const hasExpectedGameFiles = entries.some(({ name }) => {
    const lower = name.toLowerCase();
    return REQUIRED_GAME_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });
  if (!hasExpectedGameFiles) {
    throw new Error(
      'Zip did not include expected Atomic Bomberman files (.PCX, .ANI, .SCH).',
    );
  }

  report(`Found ${totalFiles} files. Extracting...`, 0.15);

  // --- Clear previous data before importing ---
  await clearAll();

  // --- Extract & store each file ---
  const extensions: Record<string, number> = {};
  let totalSize = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const data = await entry.zipObj.async('arraybuffer');
    await storeFile(entry.name, data);

    totalSize += data.byteLength;

    // Tally extension
    const dot = entry.name.lastIndexOf('.');
    const ext = dot !== -1 ? entry.name.slice(dot).toLowerCase() : '(none)';
    extensions[ext] = (extensions[ext] ?? 0) + 1;

    // Progress: map extraction across 0.15 -> 0.95
    const frac = 0.15 + (i + 1) / totalFiles * 0.8;
    if (i % 20 === 0 || i === entries.length - 1) {
      report(`Extracting: ${entry.name}`, frac);
    }
  }

  // --- Save metadata ---
  report('Saving metadata...', 0.96);
  await storeMetadata({
    importedAt: Date.now(),
    fileCount: totalFiles,
    totalSize,
  });

  report('Done!', 1);

  return { fileCount: totalFiles, totalSize, extensions };
}

/** Re-export helpers for the UI layer. */
export { getMetadata, getAllFileNames, hasAssets, clearAll };
export type { AssetMetadata };
