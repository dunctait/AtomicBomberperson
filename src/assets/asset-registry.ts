/**
 * Singleton asset registry that lazily parses and caches game assets.
 *
 * Bridges the raw file buffers stored in IndexedDB (via asset-db) with
 * the typed parsers, returning ready-to-use objects (canvases, audio
 * buffers, scheme data).
 */

import { getFile, getAllFileNames } from './asset-db';
import {
  parsePCX,
  parseANI,
  parseRSS,
  rssToAudioBuffer,
  parseScheme,
  type ParsedScheme,
} from './parsers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ParsedPCX / ANIFrame RGBA pixel data into an HTMLCanvasElement. */
function pixelsToCanvas(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  if (width > 0 && height > 0) {
    const ctx = canvas.getContext('2d')!;
    const imageData = new ImageData(pixels, width, height);
    ctx.putImageData(imageData, 0, 0);
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// AssetRegistry
// ---------------------------------------------------------------------------

export class AssetRegistry {
  /** All filenames stored in IndexedDB (populated on first access). */
  private fileList: string[] | null = null;

  /** Lookup map: lowercased bare filename -> full path in IndexedDB. */
  private fileIndex: Map<string, string> | null = null;

  /** Parsed-asset caches keyed by the resolved full path. */
  private imageCache = new Map<string, HTMLCanvasElement>();
  private animCache = new Map<string, { frames: HTMLCanvasElement[]; hotspots: { x: number; y: number }[] }>();
  private soundCache = new Map<string, AudioBuffer>();
  private schemeCache = new Map<string, ParsedScheme>();
  private rawCache = new Map<string, ArrayBuffer>();

  // -----------------------------------------------------------------------
  // File-index helpers
  // -----------------------------------------------------------------------

  /** Build / return the list of all stored filenames. */
  private async ensureFileList(): Promise<string[]> {
    if (!this.fileList) {
      this.fileList = await getAllFileNames();
      this.fileIndex = new Map();
      for (const fullPath of this.fileList) {
        // Index by lowercased bare filename for fuzzy lookups
        const bare = fullPath.split('/').pop()!.toLowerCase();
        // First match wins (shouldn't have duplicates in practice)
        if (!this.fileIndex.has(bare)) {
          this.fileIndex.set(bare, fullPath);
        }
      }
    }
    return this.fileList;
  }

  /**
   * Resolve a user-supplied filename to the exact key stored in IndexedDB.
   *
   * Supports:
   *  - Exact full path match (case-insensitive)
   *  - Bare filename match  (case-insensitive)
   */
  private async resolve(filename: string): Promise<string | null> {
    const list = await this.ensureFileList();

    // 1. Try exact match (case-insensitive)
    const lower = filename.toLowerCase();
    for (const entry of list) {
      if (entry.toLowerCase() === lower) return entry;
    }

    // 2. Try bare-filename match
    const bare = filename.split('/').pop()!.toLowerCase();
    const match = this.fileIndex!.get(bare);
    return match ?? null;
  }

  /**
   * Fetch the raw ArrayBuffer for a filename, throwing if not found.
   */
  private async fetchRaw(filename: string): Promise<{ key: string; buffer: ArrayBuffer }> {
    const key = await this.resolve(filename);
    if (!key) {
      throw new Error(`Asset not found: "${filename}"`);
    }

    // Check raw cache first
    if (this.rawCache.has(key)) {
      return { key, buffer: this.rawCache.get(key)! };
    }

    const buffer = await getFile(key);
    if (!buffer) {
      throw new Error(`Asset data missing in IndexedDB for key: "${key}"`);
    }

    this.rawCache.set(key, buffer);
    return { key, buffer };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Get a parsed PCX image as an HTMLCanvasElement (for easy drawing). */
  async getImage(filename: string): Promise<HTMLCanvasElement> {
    const { key, buffer } = await this.fetchRaw(filename);

    if (this.imageCache.has(key)) {
      return this.imageCache.get(key)!;
    }

    const pcx = parsePCX(buffer);
    const canvas = pixelsToCanvas(pcx.pixels, pcx.width, pcx.height);

    this.imageCache.set(key, canvas);
    return canvas;
  }

  /** Get parsed ANI animation frames as HTMLCanvasElement[]. */
  async getAnimation(
    filename: string,
  ): Promise<{ frames: HTMLCanvasElement[]; hotspots: { x: number; y: number }[] }> {
    const { key, buffer } = await this.fetchRaw(filename);

    if (this.animCache.has(key)) {
      return this.animCache.get(key)!;
    }

    const ani = parseANI(buffer);
    const frames: HTMLCanvasElement[] = [];
    const hotspots: { x: number; y: number }[] = [];

    for (const frame of ani.frames) {
      frames.push(pixelsToCanvas(frame.pixels, frame.width, frame.height));
      hotspots.push({ x: frame.hotspotX, y: frame.hotspotY });
    }

    const result = { frames, hotspots };
    this.animCache.set(key, result);
    return result;
  }

  /** Get a parsed sound as an AudioBuffer. */
  async getSound(filename: string, audioCtx: AudioContext): Promise<AudioBuffer> {
    const { key, buffer } = await this.fetchRaw(filename);

    if (this.soundCache.has(key)) {
      return this.soundCache.get(key)!;
    }

    const rss = parseRSS(buffer);
    const audioBuf = rssToAudioBuffer(rss, audioCtx);

    this.soundCache.set(key, audioBuf);
    return audioBuf;
  }

  /** Get a parsed scheme/map. */
  async getScheme(filename: string): Promise<ParsedScheme> {
    const { key, buffer } = await this.fetchRaw(filename);

    if (this.schemeCache.has(key)) {
      return this.schemeCache.get(key)!;
    }

    const text = new TextDecoder('utf-8').decode(buffer);
    const scheme = parseScheme(text);

    this.schemeCache.set(key, scheme);
    return scheme;
  }

  /** List all available files matching a given extension (e.g. ".SCH", ".ANI"). */
  async listFiles(extension: string): Promise<string[]> {
    const list = await this.ensureFileList();
    const ext = extension.toLowerCase().replace(/^\.?/, '.');
    return list.filter((f) => f.toLowerCase().endsWith(ext));
  }

  /** Get the raw buffer for any file. */
  async getRaw(filename: string): Promise<ArrayBuffer> {
    const { buffer } = await this.fetchRaw(filename);
    return buffer;
  }

  /**
   * Invalidate all caches (e.g. after re-importing assets).
   * The next access will re-read from IndexedDB.
   */
  invalidate(): void {
    this.fileList = null;
    this.fileIndex = null;
    this.imageCache.clear();
    this.animCache.clear();
    this.soundCache.clear();
    this.schemeCache.clear();
    this.rawCache.clear();
  }
}

/** Singleton instance. */
export const assets = new AssetRegistry();
