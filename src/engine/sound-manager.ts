/**
 * Sound manager for playing game sound effects via Web Audio API.
 *
 * Loads RSS audio assets from IndexedDB (via AssetRegistry), decodes them
 * into AudioBuffers, caches them, and plays them on demand.
 *
 * The AudioContext is created lazily on first use to comply with browser
 * autoplay policies that require a user gesture before audio can start.
 * All errors are swallowed silently so missing files never break gameplay.
 */

import { assets } from '../assets/asset-registry';

export class SoundManager {
  private audioCtx: AudioContext | null = null;

  /** Decoded AudioBuffers keyed by lowercased sound name. */
  private cache = new Map<string, AudioBuffer>();

  /** Names that failed to load — skip retrying them. */
  private failed = new Set<string>();

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Return the AudioContext, creating it on first call. */
  private getContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;

    try {
      this.audioCtx = new AudioContext();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /** Load and cache an AudioBuffer for the given asset name. */
  private async load(name: string): Promise<AudioBuffer | null> {
    const key = name.toLowerCase();

    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.failed.has(key)) return null;

    const ctx = this.getContext();
    if (!ctx) {
      this.failed.add(key);
      return null;
    }

    try {
      const buffer = await assets.getSound(name, ctx);
      this.cache.set(key, buffer);
      return buffer;
    } catch {
      this.failed.add(key);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Play a sound by asset name (e.g. 'BOMBDROP.WAV').
   * Asset name resolution is case-insensitive and bare-filename aware.
   * If the asset doesn't exist or audio is unavailable, this is a no-op.
   */
  play(name: string): void {
    this.load(name).then((buffer) => {
      if (!buffer) return;

      const ctx = this.getContext();
      if (!ctx) return;

      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch {
        // Swallow playback errors silently
      }
    }).catch(() => {
      // Swallow load errors silently
    });
  }
}

/** Singleton instance used throughout the game. */
export const soundManager = new SoundManager();
