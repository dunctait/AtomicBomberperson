import { assets } from '../assets/asset-registry';

/**
 * Load an animation by `primaryName`; if that fails, try `fallbackName`.
 * Resolves to the first successful result that has at least `minFrames` frames,
 * or `null` if both attempts fail or the frame count requirement is not met.
 */
export function loadAnimationWithFallback(
  primaryName: string,
  fallbackName: string,
  minFrames = 1,
): Promise<{ frames: HTMLCanvasElement[]; hotspots: { x: number; y: number }[] } | null> {
  return assets.getAnimation(primaryName)
    .then((anim) => (anim.frames.length >= minFrames ? anim : null))
    .catch(() =>
      assets.getAnimation(fallbackName)
        .then((anim) => (anim.frames.length >= minFrames ? anim : null))
        .catch(() => null),
    );
}
