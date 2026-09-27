export interface Point {
  x: number;
  y: number;
}

/** 8 directions, clockwise from north. y grows towards south. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const Dir = {
  N: 0,
  NE: 1,
  E: 2,
  SE: 3,
  S: 4,
  SW: 5,
  W: 6,
  NW: 7,
} as const;

export const DIRS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const CARDINALS: readonly Dir[] = [Dir.N, Dir.E, Dir.S, Dir.W];

export function isDiagonal(dir: Dir): boolean {
  return (dir & 1) === 1;
}

export function dirBetween(from: Point, to: Point): Dir | undefined {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return undefined;
  for (let d = 0; d < 8; d++) {
    if (DIRS[d]!.x === dx && DIRS[d]!.y === dy) return d as Dir;
  }
  return undefined;
}

export function oppositeDir(dir: Dir): Dir {
  return ((dir + 4) % 8) as Dir;
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function step(p: Point, dir: Dir, n = 1): Point {
  const d = DIRS[dir]!;
  return { x: p.x + d.x * n, y: p.y + d.y * n };
}

export function eq(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Chebyshev distance: number of 8-directional steps. */
export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Squared euclidean distance in tiles. */
export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function isAdjacent(a: Point, b: Point): boolean {
  return chebyshev(a, b) === 1;
}
