import { rampDir, tileDef, type World } from '@gruntz/core';
import { CLIFF_TOP } from './tileKit.ts';

/** World units per height level (one cliff). */
export const LEVEL_H = CLIFF_TOP;

/** Cliff walls: solid high ground drawn by the dual grid. */
export function isWall(tile: number): boolean {
  return tileDef(tile).visual.kind === 'cliff';
}

/**
 * Top level of every tile as drawn: walkable tiles at their height, walls one level above
 * the highest walkable ground next to them (so a wall never looks like ground you could
 * walk onto).
 */
export function renderLevels(
  width: number,
  height: number,
  tiles: readonly number[],
  heights: readonly number[],
): number[] {
  const out = heights.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isWall(tiles[i]!)) continue;
      let base = heights[i]!;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (!isWall(tiles[j]!)) base = Math.max(base, heights[j]!);
        }
      out[i] = base + 1;
    }
  return out;
}

/** Height of the walkable surface under a point (tile units, x/z), stairz included. */
export function groundY(w: World, fx: number, fz: number): number {
  const x = Math.floor(fx);
  const y = Math.floor(fz);
  if (!w.inBounds(x, y) || w.maxLevel === 0) return 0;
  const h = w.level(x, y);
  const ramp = rampDir(w, x, y);
  if (ramp === undefined) return h * LEVEL_H;
  const u = fx - x;
  const v = fz - y;
  const t = ramp === 0 ? 1 - v : ramp === 2 ? u : ramp === 4 ? v : 1 - u;
  return (h + Math.min(1, Math.max(0, t))) * LEVEL_H;
}

/** Height of a tile's centre. */
export function tileY(w: World, x: number, y: number): number {
  return groundY(w, x + 0.5, y + 0.5);
}
