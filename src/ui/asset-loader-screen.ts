/**
 * Asset loader screen: the first thing users see.
 * Provides a drag-and-drop zone, URL input, and cached-asset shortcut.
 */

import {
  loadAssets,
  getMetadata,
  hasAssets,
  clearAll,
  type AssetSummary,
} from '../assets/asset-manager';

/** Mount the asset loader UI into the given container and return a promise
 *  that resolves once assets are ready (loaded or retrieved from cache). */
export function showAssetLoaderScreen(
  container: HTMLElement,
): Promise<AssetSummary | 'cached'> {
  return new Promise((resolve) => {
    container.innerHTML = '';

    const wrapper = el('div', 'loader-screen');

    // --- Title ---
    const title = el('h1', 'loader-title');
    title.textContent = 'ATOMIC BOMBERPERSON';
    wrapper.appendChild(title);

    const subtitle = el('p', 'loader-subtitle');
    subtitle.textContent = 'Load the original game assets to begin';
    wrapper.appendChild(subtitle);

    // --- Cached assets banner (filled async) ---
    const cachedBanner = el('div', 'cached-banner hidden');
    wrapper.appendChild(cachedBanner);

    // --- Upload area ---
    const uploadSection = el('div', 'upload-section');

    // Drop zone
    const dropzone = el('div', 'dropzone') as HTMLDivElement;
    dropzone.innerHTML =
      '<span class="dropzone-icon">&#128230;</span>' +
      '<span class="dropzone-label">Drag &amp; drop a <strong>.zip</strong> file here</span>' +
      '<span class="dropzone-hint">or click to browse</span>';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.zip';
    fileInput.style.display = 'none';
    dropzone.appendChild(fileInput);
    uploadSection.appendChild(dropzone);

    // Separator
    const sep = el('div', 'separator');
    sep.textContent = '- OR -';
    uploadSection.appendChild(sep);

    // URL input
    const urlRow = el('div', 'url-row');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'url-input';
    urlInput.placeholder = 'Paste URL to a hosted .zip file';
    urlRow.appendChild(urlInput);
    uploadSection.appendChild(urlRow);

    // Load button
    const loadBtn = document.createElement('button');
    loadBtn.className = 'load-btn';
    loadBtn.textContent = 'Load Assets';
    loadBtn.disabled = true;
    uploadSection.appendChild(loadBtn);

    wrapper.appendChild(uploadSection);

    // --- Progress area (hidden until loading) ---
    const progressArea = el('div', 'progress-area hidden');
    const progressBar = el('div', 'progress-bar');
    const progressFill = el('div', 'progress-fill');
    progressBar.appendChild(progressFill);
    progressArea.appendChild(progressBar);
    const statusMsg = el('p', 'status-msg');
    statusMsg.textContent = 'Preparing...';
    progressArea.appendChild(statusMsg);
    wrapper.appendChild(progressArea);

    // --- Error area ---
    const errorArea = el('p', 'error-msg hidden');
    wrapper.appendChild(errorArea);

    container.appendChild(wrapper);

    // ===== State =====
    let selectedFile: File | null = null;

    // ===== Dropzone interactions =====
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        selectFile(fileInput.files[0]);
      }
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        selectFile(e.dataTransfer.files[0]);
      }
    });

    function selectFile(file: File) {
      selectedFile = file;
      const label = dropzone.querySelector('.dropzone-label');
      if (label) label.textContent = file.name;
      urlInput.value = '';
      loadBtn.disabled = false;
    }

    // URL input enables button
    urlInput.addEventListener('input', () => {
      if (urlInput.value.trim().length > 0) {
        selectedFile = null;
        loadBtn.disabled = false;
      } else if (!selectedFile) {
        loadBtn.disabled = true;
      }
    });

    // ===== Load button =====
    loadBtn.addEventListener('click', async () => {
      const source: File | string =
        selectedFile ?? urlInput.value.trim();
      if (!source) return;

      hideError();
      uploadSection.classList.add('hidden');
      cachedBanner.classList.add('hidden');
      progressArea.classList.remove('hidden');

      try {
        const summary = await loadAssets(source, (msg, frac) => {
          statusMsg.textContent = msg;
          (progressFill as HTMLDivElement).style.width = `${(frac * 100).toFixed(1)}%`;
        });
        resolve(summary);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unknown error occurred';
        showError(message);
        progressArea.classList.add('hidden');
        uploadSection.classList.remove('hidden');
      }
    });

    // ===== Cached assets check =====
    (async () => {
      try {
        if (await hasAssets()) {
          const meta = await getMetadata();
          if (meta) {
            cachedBanner.classList.remove('hidden');
            const date = new Date(meta.importedAt);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            const sizeStr = formatBytes(meta.totalSize);
            cachedBanner.innerHTML = '';

            const info = el('p', 'cached-info');
            info.textContent =
              `Cached assets available: ${meta.fileCount} files (${sizeStr}), imported ${dateStr}`;
            cachedBanner.appendChild(info);

            const btnRow = el('div', 'cached-btn-row');
            const useBtn = document.createElement('button');
            useBtn.className = 'cached-btn';
            useBtn.textContent = 'Use Cached Assets';
            useBtn.addEventListener('click', () => resolve('cached'));
            btnRow.appendChild(useBtn);

            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-btn';
            clearBtn.textContent = 'Clear Cache';
            clearBtn.addEventListener('click', async () => {
              await clearAll();
              cachedBanner.classList.add('hidden');
            });
            btnRow.appendChild(clearBtn);

            cachedBanner.appendChild(btnRow);
          }
        }
      } catch {
        // Silently ignore — cache check is non-critical
      }
    })();

    // ===== Helpers =====
    function showError(msg: string) {
      errorArea.textContent = msg;
      errorArea.classList.remove('hidden');
    }
    function hideError() {
      errorArea.classList.add('hidden');
    }
  });
}

// ---- tiny DOM helpers ----
function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
