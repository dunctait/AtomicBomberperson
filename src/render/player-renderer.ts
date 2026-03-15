export interface PlayerVisual {
  gridX: number;  // Can be fractional for smooth movement
  gridY: number;
  color: string;
  playerIndex: number;
  alive: boolean;
}

/** Player colors matching the original Atomic Bomberman */
export const PLAYER_COLORS: string[] = [
  '#FFFFFF', // Player 1: White
  '#FF0000', // Player 2: Red
  '#0000FF', // Player 3: Blue
  '#00CC00', // Player 4: Green
  '#FFFF00', // Player 5: Yellow
  '#00FFFF', // Player 6: Cyan
  '#FF8800', // Player 7: Orange
  '#AA00FF', // Player 8: Purple
  '#888888', // Player 9: Gray
  '#FF88CC', // Player 10: Pink
];

export class PlayerRenderer {
  /** Draw a player as a colored circle on the grid */
  renderPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerVisual,
    tileW: number,
    tileH: number,
  ): void {
    if (!player.alive) return;

    const cx = player.gridX * tileW + tileW / 2;
    const cy = player.gridY * tileH + tileH / 2;
    const radius = Math.min(tileW, tileH) * 0.35;

    // Body circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();

    // Dark outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight (small white circle in upper-left for 3D effect)
    ctx.beginPath();
    ctx.arc(cx - radius * 0.25, cy - radius * 0.25, radius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();

    // Player number label
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.floor(radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(player.playerIndex + 1), cx, cy + 1);
  }
}
