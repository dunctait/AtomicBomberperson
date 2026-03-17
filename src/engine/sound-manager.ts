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

  /** Currently playing music source node. */
  private musicSource: AudioBufferSourceNode | null = null;

  /** GainNode controlling music volume. */
  private musicGain: GainNode | null = null;

  /** Music volume, 0.0 to 1.0. */
  private musicVolume = 0.3;

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

  /**
   * Load an audio file as a raw buffer and decode it via the Web Audio API.
   * Unlike load(), this uses decodeAudioData so it works with standard WAV/
   * MP3 files in addition to the custom RSS raw-PCM format.
   */
  private async loadRaw(name: string): Promise<AudioBuffer | null> {
    const key = `raw:${name.toLowerCase()}`;

    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.failed.has(key)) return null;

    const ctx = this.getContext();
    if (!ctx) {
      this.failed.add(key);
      return null;
    }

    try {
      const raw = await assets.getRaw(name);
      // decodeAudioData consumes the buffer — pass a copy so the registry's
      // rawCache entry is not neutered.
      const copy = raw.slice(0);
      const audioBuf = await ctx.decodeAudioData(copy);
      this.cache.set(key, audioBuf);
      return audioBuf;
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

  /**
   * Start looping background music by asset name (e.g. 'BOMBHP.WAV').
   * If music is already playing it is stopped first. Silently skipped if the
   * asset is missing or audio is unavailable.
   */
  playMusic(name: string): void {
    this.stopMusic();

    this.loadRaw(name).then((buffer) => {
      if (!buffer) return;

      const ctx = this.getContext();
      if (!ctx) return;

      try {
        // Ensure gain node exists and is connected
        if (!this.musicGain) {
          this.musicGain = ctx.createGain();
          this.musicGain.connect(ctx.destination);
        }
        this.musicGain.gain.setValueAtTime(this.musicVolume, ctx.currentTime);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.musicGain);
        source.start(0);
        this.musicSource = source;
      } catch {
        // Swallow playback errors silently
      }
    }).catch(() => {
      // Swallow load errors silently
    });
  }

  /** Stop the currently playing background music. */
  stopMusic(): void {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        // Already stopped
      }
      this.musicSource = null;
    }
  }

  /**
   * Set the background music volume (0.0 to 1.0).
   * Takes effect immediately if music is playing.
   */
  setMusicVolume(vol: number): void {
    this.musicVolume = Math.max(0, Math.min(1, vol));
    if (this.musicGain) {
      const ctx = this.getContext();
      if (ctx) {
        this.musicGain.gain.setValueAtTime(this.musicVolume, ctx.currentTime);
      }
    }
  }
}

/** Singleton instance used throughout the game. */
export const soundManager = new SoundManager();
