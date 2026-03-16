import { type GameGrid, GRID_COLS, GRID_ROWS, CellContent } from './game-grid';
import { type ParsedScheme, type PowerupSetting } from '../assets/parsers/sch-parser';
import { type DiseaseEffect, Player } from './player';

export enum PowerupType {
  ExtraBomb = 0,
  LongerFlame = 1,
  Disease = 2,
  Kick = 3,
  Speed = 4,
  Punch = 5,
  Grab = 6,
  Spooger = 7,
  GoldFlame = 8,
  Trigger = 9,
  Jelly = 10,
  SuperDisease = 11,
  Random = 12,
}

export interface Powerup {
  col: number;
  row: number;
  type: PowerupType;
  revealed: boolean; // only visible after brick is destroyed
}

/**
 * Default weights for powerup distribution. Higher weight = more likely to appear.
 * These are used when the scheme does not provide override values.
 */
const DEFAULT_POWERUP_WEIGHTS: Record<number, number> = {
  [PowerupType.ExtraBomb]: 5,
  [PowerupType.LongerFlame]: 5,
  [PowerupType.Disease]: 1,
  [PowerupType.Kick]: 2,
  [PowerupType.Speed]: 4,
  [PowerupType.Punch]: 2,
  [PowerupType.Grab]: 2,
  [PowerupType.Spooger]: 1,
  [PowerupType.GoldFlame]: 1,
  [PowerupType.Trigger]: 2,
  [PowerupType.Jelly]: 1,
  [PowerupType.SuperDisease]: 1,
  [PowerupType.Random]: 1,
};

/** Essential powerups that are guaranteed a minimum spawn count per match */
const ESSENTIAL_MINIMUMS: Partial<Record<PowerupType, number>> = {
  [PowerupType.ExtraBomb]: 3,
  [PowerupType.LongerFlame]: 3,
  [PowerupType.Speed]: 2,
};

/** Powerup density: fraction of bricks that should contain powerups */
const POWERUP_BRICK_RATIO = 0.35;

/** Pick a random powerup type using weighted selection */
function pickWeighted(
  entries: { type: PowerupType; weight: number }[],
  totalWeight: number,
): PowerupType {
  let roll = Math.random() * totalWeight;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.type;
  }
  // Fallback (should not happen with valid weights)
  return entries[entries.length - 1].type;
}

export class PowerupManager {
  powerups: Powerup[] = [];

  /** Generate powerups hidden under bricks based on scheme settings */
  generatePowerups(grid: GameGrid, schemeSettings: PowerupSetting[]): void {
    this.powerups = [];

    // Build set of forbidden powerup IDs and scheme overrides
    const forbidden = new Set<number>();
    const schemeWeights = new Map<number, number>();
    for (const setting of schemeSettings) {
      if (setting.forbidden) {
        forbidden.add(setting.id);
      } else if (setting.hasOverride) {
        // Use scheme override value as weight (0 means effectively disabled)
        schemeWeights.set(setting.id, setting.overrideValue);
      }
    }

    // Build weighted table of allowed powerup types
    // Use scheme overrides where available, fall back to defaults
    const weightedTypes: { type: PowerupType; weight: number }[] = [];
    let totalWeight = 0;
    for (const typeVal of Object.values(PowerupType)) {
      if (typeof typeVal !== 'number') continue;
      if (forbidden.has(typeVal)) continue;
      const weight = schemeWeights.has(typeVal)
        ? schemeWeights.get(typeVal)!
        : (DEFAULT_POWERUP_WEIGHTS[typeVal] ?? 1);
      if (weight <= 0) continue;
      weightedTypes.push({ type: typeVal, weight });
      totalWeight += weight;
    }

    if (weightedTypes.length === 0 || totalWeight === 0) return;

    // Collect all brick positions
    const brickPositions: { col: number; row: number }[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = grid.getCell(c, r);
        if (cell && cell.type === CellContent.Brick) {
          brickPositions.push({ col: c, row: r });
        }
      }
    }

    // Place powerups under ~35% of bricks
    const powerupCount = Math.floor(brickPositions.length * POWERUP_BRICK_RATIO);
    if (powerupCount === 0) return;

    // Shuffle brick positions (Fisher-Yates)
    for (let i = brickPositions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [brickPositions[i], brickPositions[j]] = [brickPositions[j], brickPositions[i]];
    }

    // Phase 1: Place guaranteed minimum essential powerups first
    let placed = 0;
    for (const [essentialType, minCount] of Object.entries(ESSENTIAL_MINIMUMS)) {
      const typeNum = Number(essentialType) as PowerupType;
      if (forbidden.has(typeNum)) continue;
      // Check this type exists in our weighted table
      if (!weightedTypes.some((wt) => wt.type === typeNum)) continue;
      for (let i = 0; i < minCount! && placed < powerupCount; i++) {
        const pos = brickPositions[placed];
        this.powerups.push({
          col: pos.col,
          row: pos.row,
          type: typeNum,
          revealed: false,
        });
        placed++;
      }
    }

    // Phase 2: Fill remaining slots with weighted random selection
    for (let i = placed; i < powerupCount && i < brickPositions.length; i++) {
      const pos = brickPositions[i];
      const type = pickWeighted(weightedTypes, totalWeight);
      this.powerups.push({
        col: pos.col,
        row: pos.row,
        type,
        revealed: false,
      });
    }
  }

  /** Reveal a powerup at a position (called when brick is destroyed) */
  revealAt(col: number, row: number): Powerup | null {
    const p = this.getAt(col, row);
    if (p && !p.revealed) {
      p.revealed = true;
      return p;
    }
    return null;
  }

  /** Collect a powerup at a position (called when player walks over it). Returns the collected powerup or null */
  collectAt(col: number, row: number): Powerup | null {
    const idx = this.powerups.findIndex(
      (p) => p.col === col && p.row === row && p.revealed,
    );
    if (idx !== -1) {
      const collected = this.powerups[idx];
      this.powerups.splice(idx, 1);
      return collected;
    }
    return null;
  }

  /** Remove a powerup (destroyed by explosion) */
  destroyAt(col: number, row: number): void {
    const idx = this.powerups.findIndex(
      (p) => p.col === col && p.row === row,
    );
    if (idx !== -1) {
      this.powerups.splice(idx, 1);
    }
  }

  /** Get powerup at position */
  getAt(col: number, row: number): Powerup | null {
    return (
      this.powerups.find((p) => p.col === col && p.row === row) ?? null
    );
  }
}

const DISEASE_DURATION_SECONDS = 10;
const SUPER_DISEASE_DURATION_SECONDS = 15;
const DISEASE_EFFECTS: DiseaseEffect[] = ['slow', 'reverse'];

function applyDiseasePowerup(player: Player, duration: number): void {
  const picked = DISEASE_EFFECTS[Math.floor(Math.random() * DISEASE_EFFECTS.length)];
  player.applyDisease(picked, duration);
}

function isPowerupType(value: number): value is PowerupType {
  return typeof PowerupType[value] === 'string';
}

export function applySchemeStartingInventory(
  player: Player,
  schemePowerups: ParsedScheme['powerups'],
): void {
  for (const powerup of schemePowerups) {
    if (!isPowerupType(powerup.id) || powerup.bornWith <= 0) {
      continue;
    }

    for (let count = 0; count < powerup.bornWith; count += 1) {
      applyPowerup(powerup.id, player);
    }
  }
}

/** Apply a collected powerup to a player */
export function applyPowerup(type: PowerupType, player: Player): void {
  const { stats } = player;
  switch (type) {
    case PowerupType.ExtraBomb:
      stats.maxBombs += 1;
      break;
    case PowerupType.LongerFlame:
      stats.bombRange += 1;
      break;
    case PowerupType.Speed:
      stats.speed += 0.5;
      break;
    case PowerupType.GoldFlame:
      stats.bombRange = 99;
      break;
    case PowerupType.Kick:
      stats.canKick = true;
      break;
    case PowerupType.Punch:
      stats.canPunch = true;
      break;
    case PowerupType.Grab:
      stats.canGrab = true;
      break;
    case PowerupType.Trigger:
      stats.hasTrigger = true;
      break;
    case PowerupType.Jelly:
      stats.hasJelly = true;
      break;
    case PowerupType.Spooger:
      stats.hasSpooger = true;
      break;
    case PowerupType.Random: {
      // Pick a random beneficial powerup to apply
      const beneficial = [
        PowerupType.ExtraBomb,
        PowerupType.LongerFlame,
        PowerupType.Speed,
        PowerupType.Kick,
        PowerupType.Punch,
        PowerupType.Grab,
      ];
      const picked = beneficial[Math.floor(Math.random() * beneficial.length)];
      applyPowerup(picked, player);
      break;
    }
    case PowerupType.Disease:
      applyDiseasePowerup(player, DISEASE_DURATION_SECONDS);
      break;
    case PowerupType.SuperDisease:
      player.applyDisease('slow', SUPER_DISEASE_DURATION_SECONDS);
      player.applyDisease('reverse', SUPER_DISEASE_DURATION_SECONDS);
      break;
  }
}
