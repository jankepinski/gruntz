import type { Dir } from '../point.ts';

/**
 * Tile traits (bit flags). They mirror the original game's tile traits: they decide
 * where gruntz can walk, what tools can do on a tile and what kills a grunt.
 */
export const T = {
  /** Blocks walking and diagonal corner cutting (walls, rocks, raised pyramids). */
  SOLID: 1 << 0,
  /** Blocks walking only (invisible barriers, water edges). */
  NOGO: 1 << 1,
  WATER: 1 << 2,
  /** Abyss / lava / pit: kills with the world's death type. */
  DEATH: 1 << 3,
  HOLE: 1 << 4,
  MOUND: 1 << 5,
  /** Spikez: -2 HP per second while standing. */
  PAIN: 1 << 6,
  /** Can be broken with gauntletz / explosions. */
  BREAK: 1 << 7,
  /** Shovel target (hole <-> mound). */
  DIG: 1 << 8,
  /** Brick pad: bricks can be laid here. */
  LAY: 1 << 9,
  CRUMBLE: 1 << 10,
  ARROW: 1 << 11,
  /** Wingz start flying over this tile. */
  FLY: 1 << 12,
  SWITCH: 1 << 13,
  /** Switch in pressed/low state. */
  SWITCH_LOW: 1 << 14,
  PYRAMID: 1 << 15,
  BRIDGE: 1 << 16,
  /** Raised terrain, rendered as a cliff. */
  HILL: 1 << 17,
  /** Toggle bridge that goes up and down on its own. */
  AUTO: 1 << 18,
} as const;

export type SwitchKind =
  | 'green' // toggle, green pyramids
  | 'blue' // toggle, bridges
  | 'red' // toggles ALL red pyramids
  | 'yellow' // toggles 2-way arrows
  | 'white'
  | 'once' // black, once only
  | 'many' // purple, all at once
  | 'orange' // up-down pairs
  | 'time' // silver, timed
  | 'checkpoint'
  | 'secret';

export type PyramidKind = 'green' | 'red' | 'time' | 'orange' | 'checkpoint' | 'once' | 'many' | 'gem';

export type TileVisual =
  | { kind: 'ground'; alt?: boolean }
  | { kind: 'cliff' }
  | { kind: 'nogo' }
  | { kind: 'metal' }
  | { kind: 'water' }
  | { kind: 'death' }
  | { kind: 'hole' }
  | { kind: 'mound' }
  | { kind: 'spikes' }
  | { kind: 'rock'; alt?: boolean }
  | { kind: 'pad' }
  | { kind: 'brickz' }
  | { kind: 'giantRock' }
  | { kind: 'crumble' }
  | { kind: 'bridge'; lowered: boolean; over: 'water' | 'death'; auto: boolean }
  | { kind: 'arrow'; dir: Dir; twoWay: boolean }
  | { kind: 'switch'; switchKind: SwitchKind; hold: boolean; pressed: boolean }
  | { kind: 'pyramid'; pyramidKind: PyramidKind; lowered: boolean };

export interface TileDef {
  id: number;
  name: string;
  traits: number;
  /** Tile this one becomes when toggled (broken, dug, triggered, crumbled...). */
  toggle?: string;
  arrow?: Dir;
  switchKind?: SwitchKind;
  hold?: boolean;
  pyramidKind?: PyramidKind;
  visual: TileVisual;
}

type Def = Omit<TileDef, 'id'>;
const defs: Def[] = [];
const add = (d: Def) => defs.push(d);

// --- basic terrain ---------------------------------------------------------------
add({ name: 'GROUND', traits: 0, visual: { kind: 'ground' } });
add({ name: 'GROUND_ALT', traits: 0, visual: { kind: 'ground', alt: true } });
add({ name: 'CLIFF', traits: T.SOLID | T.NOGO | T.HILL, visual: { kind: 'cliff' } });
add({ name: 'NOGO', traits: T.NOGO, visual: { kind: 'nogo' } });
add({ name: 'METAL', traits: T.SOLID, visual: { kind: 'metal' } });
add({ name: 'WATER', traits: T.WATER | T.FLY, visual: { kind: 'water' } });
add({ name: 'DEATH', traits: T.DEATH | T.FLY, visual: { kind: 'death' } });
add({ name: 'HOLE', traits: T.HOLE | T.DIG | T.FLY, toggle: 'MOUND', visual: { kind: 'hole' } });
add({ name: 'MOUND', traits: T.MOUND | T.DIG, toggle: 'HOLE', visual: { kind: 'mound' } });
add({ name: 'SPIKES', traits: T.PAIN | T.FLY, visual: { kind: 'spikes' } });
add({ name: 'ROCK', traits: T.SOLID | T.BREAK, toggle: 'GROUND', visual: { kind: 'rock' } });
add({ name: 'ROCK_ALT', traits: T.SOLID | T.BREAK, toggle: 'GROUND', visual: { kind: 'rock', alt: true } });
add({ name: 'PAD', traits: T.LAY, visual: { kind: 'pad' } });
/** A stack of brickz (1-3 layers, colours live on the Brickz entity). */
add({ name: 'BRICKZ', traits: T.SOLID | T.LAY | T.BREAK, toggle: 'PAD', visual: { kind: 'brickz' } });
add({ name: 'CRUMBLE', traits: T.CRUMBLE, toggle: 'DEATH', visual: { kind: 'crumble' } });
/** Part of a 3x3 giant rock (the GiantRock entity remembers what lies beneath). */
add({ name: 'GIANT_ROCK', traits: T.SOLID | T.BREAK, visual: { kind: 'giantRock' } });

// --- bridges (up = walkable, down = water/death underneath) ---------------------------
for (const over of ['water', 'death'] as const) {
  const base = over === 'water' ? 'BRIDGE' : 'DBRIDGE';
  const below = over === 'water' ? T.WATER | T.FLY : T.DEATH | T.FLY;
  for (const auto of [false, true]) {
    const suffix = auto ? '_AUTO' : '';
    const autoTrait = auto ? T.AUTO : 0;
    add({
      name: `${base}${suffix}`,
      traits: T.BRIDGE | autoTrait,
      toggle: `${base}${suffix}_LO`,
      visual: { kind: 'bridge', lowered: false, over, auto },
    });
    add({
      name: `${base}${suffix}_LO`,
      traits: T.BRIDGE | below | autoTrait,
      toggle: `${base}${suffix}`,
      visual: { kind: 'bridge', lowered: true, over, auto },
    });
  }
}

// --- arrows --------------------------------------------------------------------
const ARROW_DIRS: [string, Dir][] = [
  ['N', 0],
  ['E', 2],
  ['S', 4],
  ['W', 6],
];
const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
for (const [name, dir] of ARROW_DIRS) {
  add({ name: `ARROW_${name}`, traits: T.ARROW, arrow: dir, visual: { kind: 'arrow', dir, twoWay: false } });
  add({
    name: `ARROW2_${name}`,
    traits: T.ARROW,
    arrow: dir,
    toggle: `ARROW2_${OPPOSITE[name]}`,
    visual: { kind: 'arrow', dir, twoWay: true },
  });
}

// --- switches --------------------------------------------------------------------
const SWITCHES: [string, SwitchKind, boolean][] = [
  ['SWITCH_G', 'green', false],
  ['SWITCH_G_HOLD', 'green', true],
  ['SWITCH_B', 'blue', false],
  ['SWITCH_B_HOLD', 'blue', true],
  ['SWITCH_R', 'red', false],
  ['SWITCH_R_HOLD', 'red', true],
  ['SWITCH_Y', 'yellow', false],
  ['SWITCH_Y_HOLD', 'yellow', true],
  ['SWITCH_W', 'white', false],
  ['SWITCH_W_HOLD', 'white', true],
  ['SWITCH_ONCE', 'once', false],
  ['SWITCH_MANY', 'many', true],
  ['SWITCH_ORANGE', 'orange', false],
  ['SWITCH_TIME', 'time', false],
  ['SWITCH_CHECK', 'checkpoint', true],
  ['SWITCH_SECRET', 'secret', false],
];
for (const [name, switchKind, hold] of SWITCHES) {
  add({
    name,
    traits: T.SWITCH,
    toggle: `${name}_LO`,
    switchKind,
    hold,
    visual: { kind: 'switch', switchKind, hold, pressed: false },
  });
  add({
    name: `${name}_LO`,
    traits: T.SWITCH | T.SWITCH_LOW,
    toggle: name,
    switchKind,
    hold,
    visual: { kind: 'switch', switchKind, hold, pressed: true },
  });
}

// --- pyramids (raised = solid wall, lowered = walkable) ---------------------------------
const PYRAMIDS: [string, PyramidKind][] = [
  ['PYRAMID_GREEN', 'green'],
  ['PYRAMID_RED', 'red'],
  ['PYRAMID_TIME', 'time'],
  ['PYRAMID_ORANGE', 'orange'],
  ['PYRAMID_CHECK', 'checkpoint'],
  ['PYRAMID_ONCE', 'once'],
  ['PYRAMID_MANY', 'many'],
  ['PYRAMID_GEM', 'gem'],
];
for (const [name, pyramidKind] of PYRAMIDS) {
  add({
    name,
    traits: T.PYRAMID | T.SOLID,
    toggle: `${name}_LO`,
    pyramidKind,
    visual: { kind: 'pyramid', pyramidKind, lowered: false },
  });
  add({
    name: `${name}_LO`,
    traits: T.PYRAMID,
    toggle: name,
    pyramidKind,
    visual: { kind: 'pyramid', pyramidKind, lowered: true },
  });
}

export const TILE_DEFS: readonly TileDef[] = defs.map((d, id) => ({ ...d, id }));
const byName = new Map(TILE_DEFS.map(d => [d.name, d]));

export function tileByName(name: string): TileDef {
  const def = byName.get(name);
  if (!def) throw new Error(`Unknown tile: ${name}`);
  return def;
}

export function tileId(name: string): number {
  return tileByName(name).id;
}

export function tileDef(id: number): TileDef {
  const def = TILE_DEFS[id];
  if (!def) throw new Error(`Unknown tile id: ${id}`);
  return def;
}

export function toggledTile(id: number): number {
  const toggle = tileDef(id).toggle;
  return toggle ? tileId(toggle) : id;
}

export const GROUND = tileId('GROUND');
