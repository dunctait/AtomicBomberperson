import type { Player, Direction } from '../engine/player';

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
  /** Draw a player on the grid using fractional grid coordinates. */
  renderPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    tileW: number,
    tileH: number,
  ): void {
    const cx = player.x * tileW + tileW / 2;
    const cy = player.y * tileH + tileH / 2;
    const radius = Math.min(tileW, tileH) * 0.35;
    const color = PLAYER_COLORS[player.index] || '#FFF';

    if (!player.alive) {
      // Dead player: gray circle with X eyes
      this.renderDeadPlayer(ctx, cx, cy, radius, player.index);
      return;
    }

    // Body circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
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
    ctx.fillText(String(player.index + 1), cx, cy + 1);

    // Facing direction indicator (small triangle)
    this.renderFacingIndicator(ctx, cx, cy, radius, player.facing);
  }

  /** Draw a small triangle on the edge of the player circle showing facing direction. */
  private renderFacingIndicator(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    facing: Direction,
  ): void {
    if (facing === 'none') return;

    const triSize = radius * 0.3;
    const dist = radius + triSize * 0.5;
    let angle = 0;

    switch (facing) {
      case 'up':    angle = -Math.PI / 2; break;
      case 'down':  angle =  Math.PI / 2; break;
      case 'left':  angle =  Math.PI;     break;
      case 'right': angle =  0;           break;
    }

    const tipX = cx + Math.cos(angle) * dist;
    const tipY = cy + Math.sin(angle) * dist;
    const baseAngle1 = angle + Math.PI * 0.75;
    const baseAngle2 = angle - Math.PI * 0.75;
    const b1x = tipX + Math.cos(baseAngle1) * triSize;
    const b1y = tipY + Math.sin(baseAngle1) * triSize;
    const b2x = tipX + Math.cos(baseAngle2) * triSize;
    const b2y = tipY + Math.sin(baseAngle2) * triSize;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(b1x, b1y);
    ctx.lineTo(b2x, b2y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Draw a dead player: grayed out with X eyes. */
  private renderDeadPlayer(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    index: number,
  ): void {
    // Gray body
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#666';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // X eyes
    const eyeSize = radius * 0.2;
    const eyeOffsetX = radius * 0.3;
    const eyeOffsetY = radius * 0.15;

    ctx.strokeStyle = '#C00';
    ctx.lineWidth = 2;

    // Left eye X
    ctx.beginPath();
    ctx.moveTo(cx - eyeOffsetX - eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx - eyeOffsetX + eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.moveTo(cx - eyeOffsetX + eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx - eyeOffsetX - eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.stroke();

    // Right eye X
    ctx.beginPath();
    ctx.moveTo(cx + eyeOffsetX - eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx + eyeOffsetX + eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.moveTo(cx + eyeOffsetX + eyeSize, cy - eyeOffsetY - eyeSize);
    ctx.lineTo(cx + eyeOffsetX - eyeSize, cy - eyeOffsetY + eyeSize);
    ctx.stroke();

    // Player number (dimmed)
    ctx.fillStyle = '#999';
    ctx.font = `bold ${Math.floor(radius * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), cx, cy + radius * 0.35);
  }
}
