import { assets } from '../assets/asset-registry';

interface ApplyBakedStageArtOptions {
  stage: HTMLElement;
  assetName: string;
  bakedClassName: string;
  hiddenElements?: HTMLElement[];
  onApplied?: () => void;
}

export function applyBakedStageArt({
  stage,
  assetName,
  bakedClassName,
  hiddenElements = [],
  onApplied,
}: ApplyBakedStageArtOptions): void {
  void assets.getImage(assetName).then((canvas) => {
    if (!stage.isConnected) return;

    stage.classList.add(bakedClassName);
    stage.style.backgroundImage = `url(${canvas.toDataURL()})`;
    stage.style.backgroundSize = '100% 100%';
    stage.style.backgroundPosition = 'center';
    hiddenElements.forEach((element) => {
      element.hidden = true;
    });
    onApplied?.();
  }).catch(() => {
    // Asset not available; keep the CSS-only screen.
  });
}
