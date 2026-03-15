import './style.css';

const GRID_COLS = 15;
const GRID_ROWS = 11;

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, h);

  // Calculate grid dimensions to fit centered on screen
  const cellSize = Math.min(
    Math.floor(w / GRID_COLS),
    Math.floor(h / GRID_ROWS)
  );
  const gridW = cellSize * GRID_COLS;
  const gridH = cellSize * GRID_ROWS;
  const offsetX = Math.floor((w - gridW) / 2);
  const offsetY = Math.floor((h - gridH) / 2);

  // Draw grid cells
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = offsetX + col * cellSize;
      const y = offsetY + row * cellSize;

      // Checkerboard pattern
      ctx.fillStyle = (row + col) % 2 === 0 ? '#16213e' : '#0f3460';
      ctx.fillRect(x, y, cellSize, cellSize);

      // Cell border
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, cellSize, cellSize);
    }
  }

  // Draw title text
  ctx.fillStyle = '#e94560';
  ctx.font = `bold ${Math.max(24, cellSize)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Atomic Bomberperson', w / 2, h / 2);

  // Subtitle
  ctx.fillStyle = '#aaa';
  ctx.font = `${Math.max(14, cellSize * 0.4)}px monospace`;
  ctx.fillText('scaffold ready', w / 2, h / 2 + cellSize);
}

window.addEventListener('resize', resize);
resize();
