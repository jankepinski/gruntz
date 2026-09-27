/**
 * Level authoring kit. A level is written as an ASCII map (one character per tile) plus a
 * height map, and a key that says what each character means: a tile, objects standing on
 * it, or both. Objects that point at other tiles (switch targets, wormhole exits, paths)
 * name them by their characters, so nothing in a level source is a raw coordinate.
 *
 *   map:     '#....a..G#'      tiles and markers
 *   heights: '0000011110'      one digit per tile (0 = the ground)
 *   key:     { a: sw('SWITCH_G', { targets: 'G' }), G: 'PYRAMID_GREEN' }
 *
 * build() turns a source into the LevelData the game loads (content/levels/<id>.json).
 */
import {
  buildLevel,
  MAX_LEVEL,
  tileByName,
  validateLevel,
  type HeightGrid,
  type ItemId,
  type LevelData,
  type LevelIssue,
  type LevelObject,
  type LocalizedText,
  type ThemeId,
  type TileGrid,
} from '../../packages/core/src/index.ts';

type Char = string;
type Distribute<T> = T extends unknown ? Omit<T, 'x' | 'y'> : never;
type Plain = Distribute<LevelObject>;

/** An object spec whose links to other tiles are given as map characters. */
export type ObjectSpec =
  | Exclude<Plain, { type: 'switch' | 'wormhole' | 'secret' | 'cloud' | 'ufo' | 'slime' }>
  | (Omit<Extract<Plain, { type: 'switch' }>, 'targets' | 'partners'> & { targets?: string; partners?: string })
  | (Omit<Extract<Plain, { type: 'wormhole' }>, 'tx' | 'ty'> & { to: Char })
  | (Omit<Extract<Plain, { type: 'secret' }>, 'wx' | 'wy'> & { wormhole: Char })
  | (Omit<Extract<Plain, { type: 'cloud' }>, 'points'> & { path: string })
  | (Omit<Extract<Plain, { type: 'ufo' }>, 'points'> & { path: string })
  | (Omit<Extract<Plain, { type: 'slime' }>, 'x1' | 'y1'> & { corner: Char });

export interface Spot {
  /** Tile under the character (GROUND when left out). */
  tile?: string;
  /** Object(s) placed on every tile with this character. */
  put?: ObjectSpec | ObjectSpec[];
}

export interface LevelSource {
  id: string;
  name: LocalizedText;
  theme: ThemeId;
  mode?: LevelData['mode'];
  world?: number;
  index?: number;
  secret?: boolean;
  players?: number;
  megaphone?: ItemId[];
  ovens?: number;
  resources?: ItemId[];
  autoToggleMs?: number;
  /** Rows of the map, one character per tile (a template string; blank first/last lines are ignored). */
  map: string;
  /** Same shape as the map: one digit per tile. Left out = everything on the ground. */
  heights?: string;
  /** What the level's own characters mean (a string is a tile name). Overrides the base legend. */
  key?: Record<Char, Spot | string>;
}

/** Characters every level understands. */
export const BASE: Record<Char, Spot> = {
  '.': { tile: 'GROUND' },
  ',': { tile: 'GROUND_ALT' },
  '#': { tile: 'CLIFF' },
  x: { tile: 'NOGO' },
  M: { tile: 'METAL' },
  '~': { tile: 'WATER' },
  _: { tile: 'DEATH' },
  o: { tile: 'HOLE' },
  m: { tile: 'MOUND' },
  '^': { tile: 'SPIKES' },
  R: { tile: 'ROCK' },
  r: { tile: 'ROCK_ALT' },
  P: { tile: 'PAD' },
  c: { tile: 'CRUMBLE' },
  '=': { tile: 'BRIDGE' },
  '-': { tile: 'BRIDGE_LO' },
  '%': { tile: 'DBRIDGE' },
  ':': { tile: 'DBRIDGE_LO' },
  '↑': { tile: 'ARROW_N' },
  '→': { tile: 'ARROW_E' },
  '↓': { tile: 'ARROW_S' },
  '←': { tile: 'ARROW_W' },
  '⇑': { tile: 'ARROW2_N' },
  '⇒': { tile: 'ARROW2_E' },
  '⇓': { tile: 'ARROW2_S' },
  '⇐': { tile: 'ARROW2_W' },
  '▲': { tile: 'RAMP_N' },
  '▶': { tile: 'RAMP_E' },
  '▼': { tile: 'RAMP_S' },
  '◀': { tile: 'RAMP_W' },
};

// --- helpers for keys ----------------------------------------------------------------------

/** Seconds in simulation ticks (switch delays and durations are counted in ticks). */
export const secs = (s: number): number => Math.round(s * 20);

type Opt<T, K extends keyof T> = Partial<Omit<T, K | 'type'>>;
type SwitchSpec = Extract<ObjectSpec, { type: 'switch' }>;
type GruntSpec = Extract<ObjectSpec, { type: 'grunt' }>;
type PickupSpec = Extract<ObjectSpec, { type: 'pickup' }>;

/** A player grunt (optionally with a tool / toy). */
export const grunt = (o: Opt<GruntSpec, 'ai'> = {}, tile?: string): Spot => ({
  ...(tile ? { tile } : {}),
  put: { type: 'grunt', ...o },
});
/** An enemy grunt with an AI. */
export const enemy = (ai: NonNullable<GruntSpec['ai']>, o: Opt<GruntSpec, 'ai'> = {}, tile?: string): Spot => ({
  ...(tile ? { tile } : {}),
  put: { type: 'grunt', ai, ...o },
});
export const item = (id: ItemId, o: Opt<PickupSpec, 'item'> = {}, tile?: string): Spot => ({
  ...(tile ? { tile } : {}),
  put: { type: 'pickup', item: id, ...o },
});
/** Something buried under a rock / mound (the tile). */
export const hidden = (id: ItemId, tile = 'ROCK'): Spot => ({ tile, put: { type: 'pickup', item: id, hidden: true } });
export const sw = (tile: string, o: Omit<SwitchSpec, 'type'> = {}): Spot => ({ tile, put: { type: 'switch', ...o } });
export const help = (en: string, pl: string, tile?: string): Spot => ({
  ...(tile ? { tile } : {}),
  put: { type: 'help', text: { en, pl } },
});
export const on = (tile: string, ...put: ObjectSpec[]): Spot => ({ tile, put });
export const at = (...put: ObjectSpec[]): Spot => ({ put });

// --- building ------------------------------------------------------------------------------

function rows(text: string): string[][] {
  const lines = text.split('\n');
  while (lines.length && lines[0]!.trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  // Common indentation (template strings inside code) is not part of the map.
  const indent = Math.min(...lines.map(l => l.length - l.trimStart().length));
  return lines.map(l => Array.from(l.slice(indent).trimEnd()));
}

export interface Built {
  level: LevelData;
  issues: LevelIssue[];
  /** Tile of a character that appears exactly once. */
  pos(c: Char): [number, number];
  /** Every tile of one or more characters, in reading order. */
  all(chars: string): [number, number][];
}

export function build(src: LevelSource): Built {
  const grid = rows(src.map);
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  grid.forEach((r, y) => {
    if (r.length !== width) throw new Error(`${src.id}: row ${y} is ${r.length} wide, expected ${width}`);
  });
  const spots = new Map<Char, Spot>();
  const spot = (c: Char): Spot => {
    let s = spots.get(c);
    if (s) return s;
    const k = src.key?.[c];
    s = typeof k === 'string' ? { tile: k } : (k ?? BASE[c]);
    if (!s) throw new Error(`${src.id}: unknown character '${c}'`);
    if (s.tile) tileByName(s.tile);
    spots.set(c, s);
    return s;
  };

  const where = new Map<Char, [number, number][]>();
  const tiles: TileGrid = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const c = grid[y]![x]!;
      row.push(spot(c).tile ?? 'GROUND');
      if (!where.has(c)) where.set(c, []);
      where.get(c)!.push([x, y]);
    }
    tiles.push(row);
  }
  const all = (chars: string): [number, number][] => Array.from(chars).flatMap(c => where.get(c) ?? []);
  const pos = (c: Char): [number, number] => {
    const list = where.get(c) ?? [];
    if (list.length !== 1) throw new Error(`${src.id}: '${c}' appears ${list.length} times, expected once`);
    return list[0]!;
  };

  const objects: LevelObject[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = spot(grid[y]![x]!);
      const put = s.put === undefined ? [] : Array.isArray(s.put) ? s.put : [s.put];
      for (const spec of put) objects.push(resolve(spec, x, y, pos, all));
    }
  }

  let heights: HeightGrid | undefined;
  if (src.heights) {
    const h = rows(src.heights);
    if (h.length !== height) throw new Error(`${src.id}: heights have ${h.length} rows, map has ${height}`);
    heights = h.map((r, y) => {
      if (r.length !== width) throw new Error(`${src.id}: heights row ${y} is ${r.length} wide, expected ${width}`);
      return r.map((ch, x) => {
        const v = ch.charCodeAt(0) - 48;
        if (!(v >= 0 && v <= MAX_LEVEL)) throw new Error(`${src.id}: bad height '${ch}' at ${x},${y}`);
        return v;
      });
    });
  }

  const meta: Parameters<typeof buildLevel>[0] = {
    id: src.id,
    name: src.name,
    mode: src.mode ?? 'quest',
    theme: src.theme,
  };
  for (const k of ['world', 'index', 'secret', 'players', 'ovens', 'autoToggleMs', 'megaphone', 'resources'] as const) {
    if (src[k] !== undefined) (meta as Record<string, unknown>)[k] = src[k];
  }
  const level = buildLevel(meta, tiles, objects, heights);
  return { level, issues: validateLevel(level), pos, all };
}

function resolve(
  spec: ObjectSpec,
  x: number,
  y: number,
  pos: (c: Char) => [number, number],
  all: (chars: string) => [number, number][],
): LevelObject {
  switch (spec.type) {
    case 'switch': {
      const { targets, partners, ...rest } = spec;
      const o: Extract<LevelObject, { type: 'switch' }> = { ...rest, x, y, targets: targets ? all(targets) : [] };
      if (partners) o.partners = all(partners);
      return o;
    }
    case 'wormhole': {
      const { to, ...rest } = spec;
      const [tx, ty] = pos(to);
      return { ...rest, x, y, tx, ty };
    }
    case 'secret': {
      const { wormhole, ...rest } = spec;
      const [wx, wy] = pos(wormhole);
      return { ...rest, x, y, wx, wy };
    }
    case 'cloud':
    case 'ufo': {
      const { path, ...rest } = spec;
      return { ...rest, x, y, points: Array.from(path).map(pos) } as LevelObject;
    }
    case 'slime': {
      const { corner, ...rest } = spec;
      const [x1, y1] = pos(corner);
      return { ...rest, x, y, x1, y1 };
    }
    default:
      return { ...spec, x, y } as LevelObject;
  }
}
