import './style.css';
import { showAssetLoaderScreen } from './ui/asset-loader-screen';

async function main() {
  const app = document.createElement('div');
  app.id = 'app';
  document.body.appendChild(app);

  const result = await showAssetLoaderScreen(app);

  // Transition to placeholder "game loading" screen
  app.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'loading-placeholder';

  if (result === 'cached') {
    msg.innerHTML =
      '<h1 class="loader-title">ATOMIC BOMBERPERSON</h1>' +
      '<p class="loader-subtitle">Assets loaded from cache. Game loading...</p>';
  } else {
    msg.innerHTML =
      '<h1 class="loader-title">ATOMIC BOMBERPERSON</h1>' +
      `<p class="loader-subtitle">${result.fileCount} files extracted (${formatBytes(result.totalSize)}). Game loading...</p>`;
  }
  app.appendChild(msg);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main();
