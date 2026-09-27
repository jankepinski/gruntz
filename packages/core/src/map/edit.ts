import { TILE_DEFS, tileDef } from '../data/tiles.ts';
import type { Dir, Point } from '../point.ts';
import { DEFAULT_LEGEND, heightRows, parseHeights, parseTiles, type LevelData, type LevelObject } from './level.ts';

/**
 * Editing helpers for the level editor. The editor works on a grid of tile names;
 * these convert to and from the compact row+legend format stored in level files.
 */

export type TileGrid = string[][];
/** Height level per tile, row by row (same shape as the tile grid). */
export type HeightGrid = number[][];

export function levelToGrid(level: Pick<LevelData, 'tiles' | 'legend'>): TileGrid {
  const { width, height, tiles } = parseTiles(level);
  const grid: TileGrid = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) row.push(tileDef(tiles[y * width + x]!).name);
    grid.push(row);
  }
  return grid;
}

export function levelToHeights(level: Pick<LevelData, 'tiles' | 'legend' | 'heights'>): HeightGrid {
  const { width, height } = parseTiles(level);
  const flat = parseHeights(level, width, height);
  const out: HeightGrid = [];
  for (let y = 0; y < height; y++) out.push(flat.slice(y * width, (y + 1) * width));
  return out;
}

const LEGEND_POOL = 'abcdfijklqtuvyzACDEFHIJKLNOPQSTUVWXYZ0123456789!$%&*+?;:<>/|(){}[]@"\'`\\'.split('');

/**
 * Rows + a minimal legend: tiles that have a default character keep it, the rest get
 * the first free character. Only non-default entries end up in the legend.
 */
export function gridToTiles(grid: TileGrid): { tiles: string[]; legend: Record<string, string> } {
  const defaults = new Map(Object.entries(DEFAULT_LEGEND).map(([ch, name]) => [name, ch]));
  const used = new Set(Object.keys(DEFAULT_LEGEND));
  const chars = new Map<string, string>();
  const legend: Record<string, string> = {};
  for (const row of grid) {
    for (const name of row) {
      if (chars.has(name)) continue;
      const ch = defaults.get(name) ?? LEGEND_POOL.find(c => !used.has(c));
      if (!ch) throw new Error('Too many tile types for one level');
      if (!defaults.has(name)) {
        used.add(ch);
        legend[ch] = name;
      }
      chars.set(name, ch);
    }
  }
  return { tiles: grid.map(row => row.map(n => chars.get(n)!).join('')), legend };
}

export function gridSize(grid: TileGrid): { width: number; height: number } {
  return { width: grid[0]?.length ?? 0, height: grid.length };
}

export function paintableTiles(): string[] {
  // BRICKZ tiles come from brickz objects, the rest are all paintable.
  return TILE_DEFS.map(d => d.name).filter(n => n !== 'BRICKZ' && n !== 'GIANT_ROCK');
}

/** Contiguous region of the same tile (4-neighbourhood). */
export function floodRegion(grid: TileGrid, start: Point, limit = 10000): Point[] {
  const { width, height } = gridSize(grid);
  const name = grid[start.y]?.[start.x];
  if (name === undefined) return [];
  const seen = new Uint8Array(width * height);
  const out: Point[] = [];
  const stack: Point[] = [start];
  seen[start.y * width + start.x] = 1;
  while (stack.length && out.length < limit) {
    const p = stack.pop()!;
    out.push(p);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || seen[y * width + x]) continue;
      if (grid[y]![x] !== name) continue;
      seen[y * width + x] = 1;
      stack.push({ x, y });
    }
  }
  return out;
}

/** Contiguous region of one height level (4-neighbourhood). */
export function floodHeights(heights: HeightGrid, start: Point, limit = 10000): Point[] {
  const height = heights.length;
  const width = heights[0]?.length ?? 0;
  const level = heights[start.y]?.[start.x];
  if (level === undefined) return [];
  const seen = new Uint8Array(width * height);
  const out: Point[] = [];
  const stack: Point[] = [start];
  seen[start.y * width + start.x] = 1;
  while (stack.length && out.length < limit) {
    const p = stack.pop()!;
    out.push(p);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height || seen[y * width + x]) continue;
      if (heights[y]![x] !== level) continue;
      seen[y * width + x] = 1;
      stack.push({ x, y });
    }
  }
  return out;
}

/** Every tile coordinate an object refers to, so moves and resizes can shift them together. */
function mapObjectPoints(o: LevelObject, f: (x: number, y: number) => [number, number]): LevelObject {
  const [x, y] = f(o.x, o.y);
  switch (o.type) {
    case 'switch':
      return {
        ...o,
        x,
        y,
        targets: o.targets.map(([tx, ty]) => f(tx, ty)),
        ...(o.partners ? { partners: o.partners.map(([px, py]) => f(px, py)) } : {}),
      };
    case 'wormhole': {
      const [tx, ty] = f(o.tx, o.ty);
      return { ...o, x, y, tx, ty };
    }
    case 'secret': {
      const [wx, wy] = f(o.wx, o.wy);
      return { ...o, x, y, wx, wy };
    }
    case 'cloud':
    case 'ufo':
      return { ...o, x, y, points: o.points.map(([px, py]) => f(px, py)) };
    case 'slime': {
      const [x1, y1] = f(o.x1, o.y1);
      return { ...o, x, y, x1, y1 };
    }
    default:
      return { ...o, x, y };
  }
}

/**
 * Resize the map. `ox`/`oy` is where the old map's top-left corner lands in the new one
 * (negative crops). New tiles are filled with `fill`; objects outside are dropped and
 * links pointing outside are removed.
 */
export function resizeLevel(
  grid: TileGrid,
  objects: LevelObject[],
  width: number,
  height: number,
  ox: number,
  oy: number,
  fill = 'GROUND',
  heights?: HeightGrid,
): { grid: TileGrid; objects: LevelObject[]; heights: HeightGrid } {
  const next: TileGrid = [];
  const nextHeights: HeightGrid = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    const hrow: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(grid[y - oy]?.[x - ox] ?? fill);
      hrow.push(heights?.[y - oy]?.[x - ox] ?? 0);
    }
    next.push(row);
    nextHeights.push(hrow);
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const moved: LevelObject[] = [];
  for (const o of objects) {
    const m = mapObjectPoints(o, (x, y) => [x + ox, y + oy]);
    if (!inside(m.x, m.y)) continue;
    if (m.type === 'switch') {
      m.targets = m.targets.filter(([x, y]) => inside(x, y));
      if (m.partners) m.partners = m.partners.filter(([x, y]) => inside(x, y));
    }
    if (m.type === 'wormhole' && !inside(m.tx, m.ty)) {
      m.tx = m.x;
      m.ty = m.y;
    }
    if (m.type === 'secret' && !inside(m.wx, m.wy)) continue;
    moved.push(m);
  }
  return { grid: next, objects: moved, heights: nextHeights };
}

/** Move one object; its own links stay where they are. */
export function moveObject(o: LevelObject, x: number, y: number): LevelObject {
  return { ...o, x, y };
}

/** Rotating or mirroring whole maps is handy when making symmetric battle maps. */
export function mirrorLevel(
  grid: TileGrid,
  objects: LevelObject[],
  axis: 'x' | 'y',
  heights?: HeightGrid,
): { grid: TileGrid; objects: LevelObject[]; heights: HeightGrid } {
  const { width, height } = gridSize(grid);
  const flipName = (n: string): string => {
    const swap: Record<string, string> = axis === 'x' ? { E: 'W', W: 'E' } : { N: 'S', S: 'N' };
    const m = /^(ARROW2?_|RAMP_)([NESW])$/.exec(n);
    return m && swap[m[2]!] ? `${m[1]}${swap[m[2]!]}` : n;
  };
  const next =
    axis === 'x'
      ? grid.map(row => row.slice().reverse().map(flipName))
      : grid
          .slice()
          .reverse()
          .map(row => row.map(flipName));
  const f = (x: number, y: number): [number, number] => (axis === 'x' ? [width - 1 - x, y] : [x, height - 1 - y]);
  const flipDir = (d: Dir): Dir => (axis === 'x' ? (8 - d) % 8 : (12 - d) % 8) as Dir;
  const h = heights ?? grid.map(row => row.map(() => 0));
  const nextHeights =
    axis === 'x'
      ? h.map(row => row.slice().reverse())
      : h
          .slice()
          .reverse()
          .map(row => row.slice());
  return {
    grid: next,
    heights: nextHeights,
    objects: objects.map(o => {
      const m = mapObjectPoints(o, f);
      if (m.type === 'ball' || m.type === 'dropper') return { ...m, dir: flipDir(m.dir) };
      if ((m.type === 'spotlight' || m.type === 'ufo' || m.type === 'slime') && m.clockwise !== undefined)
        return { ...m, clockwise: !m.clockwise };
      if (m.type === 'spotlight' || m.type === 'ufo' || m.type === 'slime') return { ...m, clockwise: false };
      if (m.type === 'grunt' && m.facing !== undefined) return { ...m, facing: flipDir(m.facing) };
      return m;
    }),
  };
}

/** Assemble a level file from the editor's working data. */
export function buildLevel(
  meta: Omit<LevelData, 'tiles' | 'legend' | 'objects'>,
  grid: TileGrid,
  objects: LevelObject[],
  heights?: HeightGrid,
): LevelData {
  const { tiles, legend } = gridToTiles(grid);
  const level: LevelData = { ...meta, tiles, objects };
  if (Object.keys(legend).length) level.legend = legend;
  const { width, height } = gridSize(grid);
  const rows = heights ? heightRows(heights.flat(), width, height) : meta.heights;
  if (rows) level.heights = rows;
  else delete level.heights;
  // Stable key order makes diffs of level files readable.
  const ordered: Record<string, unknown> = {};
  for (const k of [
    'id',
    'name',
    'mode',
    'theme',
    'world',
    'index',
    'secret',
    'players',
    'ovens',
    'autoToggleMs',
    'megaphone',
    'resources',
    'legend',
    'tiles',
    'heights',
    'objects',
  ]) {
    const v = (level as unknown as Record<string, unknown>)[k];
    if (v !== undefined) ordered[k] = v;
  }
  return ordered as unknown as LevelData;
}

/** A blank level to start from. */
export function blankLevel(mode: LevelData['mode'], width = 24, height = 18): LevelData {
  const grid: TileGrid = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++)
      row.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'CLIFF' : 'GROUND');
    grid.push(row);
  }
  const objects: LevelObject[] =
    mode === 'quest'
      ? [
          { type: 'grunt', x: 3, y: Math.floor(height / 2) },
          { type: 'pickup', x: width - 8, y: Math.floor(height / 2), item: 'WARPSTONE' },
          { type: 'fort', x: width - 4, y: Math.floor(height / 2) },
        ]
      : [
          { type: 'fort', x: 3, y: 3, team: 0 },
          { type: 'pad', x: 5, y: 5, team: 0 },
          { type: 'fort', x: width - 4, y: height - 4, team: 1 },
          { type: 'pad', x: width - 6, y: height - 6, team: 1 },
        ];
  for (const o of objects) if (o.type === 'fort') grid[o.y]![o.x] = 'NOGO';
  return buildLevel(
    {
      id: `custom-${Date.now().toString(36)}`,
      name: { en: 'New level', pl: 'Nowy poziom' },
      mode,
      theme: mode === 'quest' ? 'training' : 'rocky',
      ...(mode === 'battle' ? { players: 2 } : {}),
    },
    grid,
    objects,
  );
}

/** Level file text: one tile row and one object per line so diffs stay readable. */
export function formatLevel(level: LevelData): string {
  const entries = Object.entries(level).filter(([, v]) => v !== undefined);
  const lines = ['{'];
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (key === 'tiles' || key === 'heights' || key === 'objects') {
      const items = value as unknown[];
      lines.push(`  ${JSON.stringify(key)}: [`);
      items.forEach((item, j) => lines.push(`    ${JSON.stringify(item)}${j < items.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
