import { TOOL_INFO } from '../data/items.ts';
import { T } from '../data/tiles.ts';
import { DIRS, type Dir, type Point } from '../point.ts';
import { levelsConnect } from './elevation.ts';
import type { Grunt } from './types.ts';
import type { World } from './world.ts';

export const STRAIGHT = 10;
export const DIAGONAL = 14;
export const UNREACHABLE = Number.MAX_SAFE_INTEGER;

const cost = (dir: number) => ((dir & 1) === 1 ? DIAGONAL : STRAIGHT);

/** Tiles a grunt will not path through unless allowed. */
const BLOCKED = T.NOGO | T.SOLID | T.WATER | T.DEATH | T.PAIN | T.HOLE | T.ARROW;
/** Hazards a player grunt happily walks into ("Gruntz are extremely dumb creaturez"). */
const DUMB_ALLOW = T.DEATH | T.PAIN | T.HOLE | T.ARROW;
/** Tiles a springz grunt can jump over. */
export const SPRINGABLE = T.DEATH | T.WATER | T.HOLE | T.PAIN;

export function canUseWater(grunt: Grunt): boolean {
  return grunt.tool !== null && TOOL_INFO[grunt.tool].water === true;
}

/**
 * Walking between two tiles is blocked diagonally by solid corners (and a two-tile
 * spring jump needs its whole corridor free of solid tiles), and by cliffs between
 * height levels (see elevation.ts).
 */
export function canMoveBetween(w: World, from: Point, to: Point): boolean {
  if (!levelsConnect(w, from, to)) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) === 2 || Math.abs(dy) === 2) {
    if (dx !== 0 && dy !== 0) {
      const sx = dx / 2;
      const sy = dy / 2;
      return !(
        w.has(from.x, from.y + sy, T.SOLID) ||
        w.has(from.x + sx, from.y, T.SOLID) ||
        w.has(from.x + sx, from.y + dy, T.SOLID) ||
        w.has(from.x + dx, from.y + sy, T.SOLID)
      );
    }
    return true;
  }
  if (dx !== 0 && dy !== 0) {
    return !(w.has(from.x, from.y + dy, T.SOLID) || w.has(from.x + dx, from.y, T.SOLID));
  }
  return true;
}

/** Can a grunt start moving into `to` right now (terrain + occupancy). */
export function canMoveTo(w: World, from: Point, to: Point, water: boolean): boolean {
  if (!w.inBounds(to.x, to.y)) return false;
  if (!canMoveBetween(w, from, to)) return false;
  const traits = w.traits(to.x, to.y);
  if (traits & (T.NOGO | T.SOLID)) return false;
  if (traits & T.WATER && !water) return false;
  return !w.occupancy.has(w.index(to.x, to.y));
}

export interface FloodOptions {
  /** Avoid hazards (AI gruntz, bots, "safe pathfinding"). */
  safe: boolean;
  water: boolean;
  spring: boolean;
  /** AI helpers path through what they fix. */
  allowHoles?: boolean;
  allowBreakable?: boolean;
}

export function floodOptions(w: World, grunt: Grunt, safe: boolean): FloodOptions {
  return {
    safe,
    water: canUseWater(grunt),
    spring: grunt.tool === 'SPRING',
    allowHoles: grunt.ai === 'Digger',
    allowBreakable: grunt.ai === 'RockBreaker',
  };
}

/**
 * Distance field towards a target tile (Dijkstra from the target), like the original
 * game's flood. The target tile itself always has distance 0 even when it is blocked,
 * which is how "walk next to that rock and smash it" works.
 */
export class Flood {
  readonly dist: Int32Array;
  private readonly allow: number;

  constructor(
    readonly w: World,
    readonly target: Point,
    readonly team: number,
    readonly opts: FloodOptions,
    source?: Point,
  ) {
    this.dist = new Int32Array(w.width * w.height).fill(-1);
    let allow = opts.safe ? 0 : DUMB_ALLOW;
    if (opts.water) allow |= T.WATER;
    if (opts.allowHoles) allow |= T.HOLE;
    this.allow = allow;
    this.run(source);
  }

  get(p: Point): number {
    if (!this.w.inBounds(p.x, p.y)) return UNREACHABLE;
    const d = this.dist[this.w.index(p.x, p.y)]!;
    return d < 0 ? UNREACHABLE : d;
  }

  isValid(p: Point): boolean {
    const w = this.w;
    if (!w.inBounds(p.x, p.y)) return false;
    const blocker = w.gruntAt(p.x, p.y);
    if (blocker && blocker.task === null && blocker.team !== this.team) return false;
    const traits = w.traits(p.x, p.y);
    if (this.opts.allowBreakable && traits & T.BREAK) return true;
    if ((traits & BLOCKED) === 0) return true;
    // Every blocking trait must be allowed.
    return (traits & BLOCKED & ~this.allow) === 0;
  }

  isSpringable(p: Point): boolean {
    const w = this.w;
    if (!w.inBounds(p.x, p.y)) return false;
    const blocker = w.gruntAt(p.x, p.y);
    if (blocker && blocker.task === null && blocker.team !== this.team) return false;
    return (w.traits(p.x, p.y) & SPRINGABLE) !== 0;
  }

  private run(source?: Point): void {
    const { w, target } = this;
    const width = w.width;
    // Simple binary heap of [dist, index].
    const heapD: number[] = [];
    const heapI: number[] = [];
    const push = (d: number, i: number) => {
      heapD.push(d);
      heapI.push(i);
      let c = heapD.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heapD[p]! < heapD[c]! || (heapD[p] === heapD[c] && heapI[p]! <= heapI[c]!)) break;
        [heapD[p], heapD[c]] = [heapD[c]!, heapD[p]!];
        [heapI[p], heapI[c]] = [heapI[c]!, heapI[p]!];
        c = p;
      }
    };
    const pop = (): [number, number] => {
      const d = heapD[0]!;
      const i = heapI[0]!;
      const ld = heapD.pop()!;
      const li = heapI.pop()!;
      if (heapD.length > 0) {
        heapD[0] = ld;
        heapI[0] = li;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1;
          const r = l + 1;
          let m = c;
          const better = (a: number, b: number) =>
            heapD[a]! < heapD[b]! || (heapD[a] === heapD[b] && heapI[a]! < heapI[b]!);
          if (l < heapD.length && better(l, m)) m = l;
          if (r < heapD.length && better(r, m)) m = r;
          if (m === c) break;
          [heapD[m], heapD[c]] = [heapD[c]!, heapD[m]!];
          [heapI[m], heapI[c]] = [heapI[c]!, heapI[m]!];
          c = m;
        }
      }
      return [d, i];
    };

    const best = new Int32Array(w.width * w.height).fill(-1);
    const start = w.index(target.x, target.y);
    best[start] = 0;
    push(0, start);
    const sourceIndex = source ? w.index(source.x, source.y) : -1;
    let stopAt = UNREACHABLE;

    while (heapD.length > 0) {
      const [d, i] = pop();
      if (this.dist[i]! >= 0) continue;
      if (d > stopAt) break;
      this.dist[i] = d;
      if (i === sourceIndex) stopAt = d + DIAGONAL * 2;
      const here = { x: i % width, y: (i / width) | 0 };
      for (let dir = 0; dir < 8; dir++) {
        const delta = DIRS[dir]!;
        const next = { x: here.x + delta.x, y: here.y + delta.y };
        if (!w.inBounds(next.x, next.y)) continue;
        if (this.opts.spring && this.isSpringable(next)) {
          const jump = { x: next.x + delta.x, y: next.y + delta.y };
          if (this.isValid(jump) && canMoveBetween(w, here, jump)) {
            const ji = w.index(jump.x, jump.y);
            const nd = d + cost(dir) * 2;
            if (this.dist[ji]! < 0 && (best[ji]! < 0 || nd < best[ji]!)) {
              best[ji] = nd;
              push(nd, ji);
            }
            continue;
          }
        }
        if (!this.isValid(next) || !canMoveBetween(w, here, next)) continue;
        const ni = w.index(next.x, next.y);
        let nd = d + cost(dir);
        // A springz grunt jumps hazards instead of walking into them (walking onto spikez
        // would even break the spring), so make stepping on them expensive.
        if (this.opts.spring && w.has(next.x, next.y, T.DEATH | T.HOLE | T.PAIN)) nd += STRAIGHT * 6;
        if (this.dist[ni]! < 0 && (best[ni]! < 0 || nd < best[ni]!)) {
          best[ni] = nd;
          push(nd, ni);
        }
      }
    }
  }

  reaches(p: Point): boolean {
    return this.get(p) !== UNREACHABLE;
  }
}

export interface StepChoice {
  to: Point;
  /** Spring jump over a hazard. */
  jump: boolean;
  /** `to` is the target itself (adjacent): use tool / toy on it. */
  atTarget: boolean;
}

/**
 * Picks the next tile to step on, following the original getWalkTarget rules.
 * Returns undefined when arrived or blocked.
 */
export function chooseStep(w: World, grunt: Grunt, flood: Flood, useItem: boolean): StepChoice | undefined {
  const here = { x: grunt.x, y: grunt.y };
  const weight = flood.get(here);
  if (weight === 0) return undefined;
  const water = canUseWater(grunt);
  let choice: StepChoice | undefined;
  let choiceWeight = UNREACHABLE;
  for (let dir = 0 as Dir; dir < 8; dir = (dir + 1) as Dir) {
    const delta = DIRS[dir]!;
    const next = { x: here.x + delta.x, y: here.y + delta.y };
    const nextWeight = flood.get(next);
    if (nextWeight === 0 && useItem) return { to: next, jump: false, atTarget: true };
    if (grunt.tool === 'SPRING' && flood.isSpringable(next)) {
      const jump = { x: next.x + delta.x, y: next.y + delta.y };
      if (!canMoveTo(w, here, jump, water)) continue;
      const jumpWeight = flood.get(jump);
      if (choice ? jumpWeight < choiceWeight : jumpWeight < weight + cost(dir) * 2) {
        choice = { to: jump, jump: true, atTarget: false };
        choiceWeight = jumpWeight;
      }
      continue;
    }
    if (!canMoveTo(w, here, next, water)) continue;
    if (choice) {
      if (nextWeight < choiceWeight) {
        choice = { to: next, jump: false, atTarget: false };
        choiceWeight = nextWeight;
      }
    } else if (weight < 2 * STRAIGHT ? nextWeight < weight : nextWeight < weight + cost(dir)) {
      choice = { to: next, jump: false, atTarget: false };
      choiceWeight = nextWeight;
    }
  }
  return choice;
}

/** Full predicted path (for path preview and client-side prediction). */
export function predictPath(w: World, grunt: Grunt, target: Point, safe: boolean, maxSteps = 256): Point[] {
  const flood = new Flood(w, target, grunt.team, floodOptions(w, grunt, safe), grunt);
  const path: Point[] = [];
  let here = { x: grunt.x, y: grunt.y };
  const visited = new Set<number>([w.index(here.x, here.y)]);
  for (let i = 0; i < maxSteps; i++) {
    const weight = flood.get(here);
    if (weight === 0 || weight === UNREACHABLE) break;
    let best: Point | undefined;
    let bestWeight = weight;
    for (let dir = 0; dir < 8; dir++) {
      const d = DIRS[dir]!;
      const next = { x: here.x + d.x, y: here.y + d.y };
      const nw = flood.get(next);
      if (nw < bestWeight && canMoveBetween(w, here, next) && !(w.traits(next.x, next.y) & (T.SOLID | T.NOGO))) {
        best = next;
        bestWeight = nw;
      }
    }
    if (!best || visited.has(w.index(best.x, best.y))) break;
    visited.add(w.index(best.x, best.y));
    path.push(best);
    here = best;
  }
  return path;
}
