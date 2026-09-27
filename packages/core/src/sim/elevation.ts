import { tileDef } from '../data/tiles.ts';
import { chebyshev, type Dir, type Point } from '../point.ts';
import type { World } from './world.ts';

/**
 * Height rules. Every tile sits on a height level (World.heights); a grunt can only step
 * between two tiles whose shared edge is at the same height. Stairz (RAMP tiles) are one
 * level higher on their top side than on their bottom side and closed on the other two,
 * which is how you get from one level to the next.
 */

/** Direction a stairz tile climbs towards (undefined for everything else). */
export function rampDir(w: World, x: number, y: number): Dir | undefined {
  const tile = w.tileAt(x, y);
  return tile < 0 ? undefined : tileDef(tile).ramp;
}

/** Height of a tile's edge on one side (0 N, 2 E, 4 S, 6 W); NaN for the closed sides of stairz. */
export function edgeLevel(w: World, x: number, y: number, side: Dir): number {
  const h = w.level(x, y);
  const ramp = rampDir(w, x, y);
  if (ramp === undefined) return h;
  if (side === ramp) return h + 1;
  if (side === (ramp + 4) % 8) return h;
  return NaN;
}

function sideOf(dx: number, dy: number): Dir {
  return dy < 0 ? 0 : dx > 0 ? 2 : dy > 0 ? 4 : 6;
}

/** Plain (no stairz) tile at the given level. */
function flatAt(w: World, x: number, y: number, level: number): boolean {
  return w.level(x, y) === level && rampDir(w, x, y) === undefined;
}

/**
 * Do the heights allow moving from one tile to another (a neighbour, or two tiles away for
 * a spring jump)? Walls and hazards are not checked here.
 */
export function levelsConnect(w: World, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return true;
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  if (span === 1 && (dx === 0 || dy === 0)) {
    const side = sideOf(dx, dy);
    const a = edgeLevel(w, from.x, from.y, side);
    const b = edgeLevel(w, to.x, to.y, ((side + 4) % 8) as Dir);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      // Side by side stairz of one flight form a wide staircase.
      return (
        Number.isNaN(a) &&
        Number.isNaN(b) &&
        rampDir(w, from.x, from.y) === rampDir(w, to.x, to.y) &&
        w.level(from.x, from.y) === w.level(to.x, to.y)
      );
    }
    return a === b;
  }
  // Diagonal steps and jumps: only across flat ground of one level; a jump may clear
  // anything that is not higher than where it starts.
  const h = w.level(from.x, from.y);
  if (!flatAt(w, from.x, from.y, h) || !flatAt(w, to.x, to.y, h)) return false;
  if (span === 1) return flatAt(w, from.x + dx, from.y, h) && flatAt(w, from.x, from.y + dy, h);
  // Everything in the box between the two tiles is jumped over.
  for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      if ((x === from.x && y === from.y) || (x === to.x && y === to.y)) continue;
      if (w.level(x, y) > h || rampDir(w, x, y) !== undefined) return false;
    }
  return true;
}

/** Can two gruntz reach each other with a hand-held tool (next to each other, no cliff between)? */
export function inReach(w: World, a: Point, b: Point): boolean {
  return chebyshev(a, b) <= 1 && levelsConnect(w, a, b);
}
