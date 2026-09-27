import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SwitchKind, PyramidKind, ThemeId, TileVisual } from '@gruntz/core';
import {
  applyClay,
  bedMaterial,
  chasmMaterial,
  clayMaterial,
  createLiquidMask,
  grassMaterial,
  groundMaterial,
  lavaMaterial,
  waterMaterial,
  type GroundPattern,
  type LiquidMask,
} from './materials.ts';
import type { TerrainOptions } from './graphics.ts';
import { models } from './models.ts';

export type PieceKey = string;

export interface PieceDef {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface PlacedPieceDef {
  key: PieceKey;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
  lift?: number;
}

/** One of the four tiles around a dual-grid cell. */
export interface CellCorner {
  /** undefined outside the map. */
  v: TileVisual | undefined;
  /** Height level of the tile's top (walls stand one level above what they border). */
  level: number;
  /** Walls (cliffs, the land around the map) as opposed to ground you can walk on. */
  wall: boolean;
}

export interface TileKit {
  /** Renderable parts of a piece (one per material). */
  parts(key: PieceKey): PieceDef[];
  /**
   * Pieces of one tile, relative to the tile's own height. bare: something stands here (a vent,
   * a fort...): no grass or clutter. level: top level of a neighbouring tile (0,0 = this one).
   */
  tilePieces(
    x: number,
    y: number,
    visual: TileVisual,
    neighbour: (dx: number, dy: number) => TileVisual | undefined,
    bare?: boolean,
    level?: (dx: number, dy: number) => number,
  ): PlacedPieceDef[];
  /**
   * Pieces for the dual-grid cell centred on tile corner (cx, cy): cliffs (one layer per
   * height level), water banks, chasm walls and the ground itself. corners = the tiles NE, NW,
   * SW, SE of the corner.
   */
  cellPieces(cx: number, cy: number, corners: CellCorner[]): PlacedPieceDef[];
  liftTransform(key: PieceKey, level: number): THREE.Matrix4;
  /** Soft map of the liquids (R water, G molten chasm) for shore foam and lava heat, and the lava's flow direction. */
  setLiquidMask(texture: THREE.Texture, width: number, height: number, flow: THREE.Vector2): void;
  /**
   * Decorations on a tile outside the map (the high ground around it). detail (0..1) thins
   * out the small stuff far from the playable area.
   */
  surroundingPieces(
    x: number,
    y: number,
    neighbour: (dx: number, dy: number) => TileVisual | undefined,
    detail: number,
  ): PlacedPieceDef[];
  backdrop(width: number, height: number): THREE.Object3D;
  update(time: number): void;
  dispose(): void;
}

interface Palette {
  ground: number[];
  groundAlt: number;
  cliff: number;
  cliffTop: number;
  water: number;
  waterDeep: number;
  sand: number;
  abyss: number;
  abyssGlow: number;
  rock: number;
  dirt: number;
  metal: number;
  wood: number;
  sky: number;
}

const PALETTES: Record<ThemeId, Palette> = {
  training: {
    ground: [0x82b64e, 0x7aae48, 0x8abe56],
    groundAlt: 0x9ec466,
    cliff: 0x9a7b5c,
    cliffTop: 0x7fae4c,
    water: 0x3fa9d8,
    waterDeep: 0x1d6a9c,
    sand: 0xd9c38e,
    abyss: 0x1a1030,
    abyssGlow: 0x3b2a70,
    rock: 0x8d8a86,
    dirt: 0x8a5a36,
    metal: 0x8e99a8,
    wood: 0x9c6b3e,
    sky: 0xbfe3f5,
  },
  rocky: {
    ground: [0xc9a171, 0xc29a69, 0xd0a878],
    groundAlt: 0xb8905f,
    cliff: 0x9c5a3c,
    cliffTop: 0xb77a4f,
    water: 0x3aa6c9,
    waterDeep: 0x1b6488,
    sand: 0xe0c894,
    abyss: 0x24130c,
    abyssGlow: 0x5a2d18,
    rock: 0x8f7a6a,
    dirt: 0x7d4c2c,
    metal: 0x8e99a8,
    wood: 0x8f5f36,
    sky: 0xf2d8b0,
  },
  ice: {
    ground: [0xe8f2f8, 0xdfeef6, 0xf1f7fb],
    groundAlt: 0xcfe3ef,
    cliff: 0x9fc4dc,
    cliffTop: 0xf4fbff,
    water: 0x5ec3e6,
    waterDeep: 0x2a7fb3,
    sand: 0xd8e8f0,
    abyss: 0x0c1830,
    abyssGlow: 0x2b5a8a,
    rock: 0xa9bccb,
    dirt: 0x8aa0b0,
    metal: 0x9aa7b8,
    wood: 0x9c6b3e,
    sky: 0xdaf0fb,
  },
  tropics: {
    ground: [0x4f9a3a, 0x489234, 0x58a342],
    groundAlt: 0x78a83e,
    cliff: 0x6a4a34,
    cliffTop: 0x3f7f30,
    water: 0x2fc0c8,
    waterDeep: 0x167f96,
    sand: 0xf0d89a,
    abyss: 0x3a0e04,
    abyssGlow: 0xff5a1a,
    rock: 0x7f776c,
    dirt: 0x7a4a2a,
    metal: 0x8e99a8,
    wood: 0x8f5f36,
    sky: 0xbfe8d6,
  },
  sweetz: {
    // pink icing ground, chocolate cliffs with whipped cream tops, grape soda water
    ground: [0xe882b0, 0xe47aa8, 0xec90b8],
    groundAlt: 0x8cc4e8,
    cliff: 0x7a4a30,
    cliffTop: 0xf6dce6,
    water: 0x9a6bd8,
    waterDeep: 0x6040a0,
    sand: 0xffe0a0,
    abyss: 0x2a1030,
    abyssGlow: 0xff8ad8,
    rock: 0xe890b8,
    dirt: 0xb86a8a,
    metal: 0xd0d8e8,
    wood: 0xb07a50,
    sky: 0xfff0f8,
  },
  rollerz: {
    ground: [0x3d8f5a, 0x378752, 0x449762],
    groundAlt: 0x4aa06a,
    cliff: 0x7a4a28,
    cliffTop: 0x9a6a3a,
    water: 0x3aa6c9,
    waterDeep: 0x1b6488,
    sand: 0xd8c08a,
    abyss: 0x0a0a14,
    abyssGlow: 0x303060,
    rock: 0x707070,
    dirt: 0x6d4424,
    metal: 0xb0b8c8,
    wood: 0x8f5f36,
    sky: 0xd8e8f8,
  },
  shrunk: {
    ground: [0xd8b88a, 0xd0b082, 0xe0c092],
    groundAlt: 0xc09a68,
    cliff: 0x8a6a4a,
    cliffTop: 0xa8845a,
    water: 0x70b8e0,
    waterDeep: 0x3a78a8,
    sand: 0xe8d8b0,
    abyss: 0x14200c,
    abyssGlow: 0x6ad83a,
    rock: 0x9a8a7a,
    dirt: 0x7d4c2c,
    metal: 0xc0c8d0,
    wood: 0x9c6b3e,
    sky: 0xf0e8d8,
  },
  minis: {
    // a model railway landscape: flock grass, plaster hills, painted water
    ground: [0x7cc35a, 0x74ba52, 0x86cc64],
    groundAlt: 0x9cd878,
    cliff: 0xc4b8a6,
    cliffTop: 0x6aa84a,
    water: 0x4ab0e8,
    waterDeep: 0x2a78b8,
    sand: 0xe8d8a8,
    abyss: 0x101820,
    abyssGlow: 0x3a5a80,
    rock: 0xa8a098,
    dirt: 0x9a7a54,
    metal: 0xa0a8b8,
    wood: 0xa8784a,
    sky: 0xe8f4ff,
  },
  space: {
    ground: [0x8a8aa8, 0x8282a0, 0x9292b0],
    groundAlt: 0x6a6a90,
    cliff: 0x4a4a68,
    cliffTop: 0x6a6a88,
    water: 0x40e0c0,
    waterDeep: 0x108070,
    sand: 0xa0a0c0,
    abyss: 0x02020a,
    abyssGlow: 0x3020a0,
    rock: 0x707090,
    dirt: 0x5a5a78,
    metal: 0xb0b8d0,
    wood: 0x8a8aa0,
    sky: 0x101028,
  },
};

const SWITCH_COLORS: Record<SwitchKind, number> = {
  green: 0x3cc45a,
  blue: 0x3a8ae8,
  red: 0xe8413a,
  yellow: 0xf2cf2a,
  white: 0xf2f2f2,
  once: 0x2a2a30,
  many: 0x9b4de0,
  orange: 0xf2902a,
  time: 0xc8ccd4,
  checkpoint: 0xf2f2f2,
  secret: 0xd8b060,
};

const FLOWER_COLORS = [0xff6a8a, 0xffd84a, 0xffffff, 0x9a7aff, 0xff9a3a];

const PYRAMID_COLORS: Record<PyramidKind, number> = {
  green: 0x3cc45a,
  red: 0xe8413a,
  time: 0xc8ccd4,
  orange: 0xf2902a,
  checkpoint: 0xf2f2f2,
  once: 0x2a2a30,
  many: 0x9b4de0,
  gem: 0x40d8e8,
};

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const tmp = new THREE.Matrix4();
const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

function at(x: number, y: number, h = 0, rot = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  q.setFromAxisAngle(up, rot);
  return new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, h, y + 0.5), q, new THREE.Vector3(sx, sy, sz));
}

function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  // Box with softly rounded vertical edges (cheap stand-in until the Blender kit lands).
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hd = d / 2 - r;
  shape.moveTo(-hw, -d / 2);
  shape.lineTo(hw, -d / 2);
  shape.absarc(hw, -hd, r, -Math.PI / 2, 0, false);
  shape.lineTo(w / 2, hd);
  shape.absarc(hw, hd, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw, d / 2);
  shape.absarc(-hw, hd, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w / 2, -hd);
  shape.absarc(-hw, -hd, r, Math.PI, Math.PI * 1.5, false);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelSize: r * 0.6,
    bevelThickness: r * 0.6,
    bevelSegments: seg,
    curveSegments: 4,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -h, 0);
  geo.computeVertexNormals();
  return geo;
}

function spikesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [
    [-0.25, -0.25],
    [0.25, -0.25],
    [0, 0],
    [-0.25, 0.25],
    [0.25, 0.25],
  ];
  for (const [sx, sz] of spots) {
    const c = new THREE.ConeGeometry(0.1, 0.35, 6);
    c.translate(sx!, 0.175, sz!);
    parts.push(c);
  }
  const base = new THREE.BoxGeometry(0.9, 0.04, 0.9);
  base.translate(0, 0.02, 0);
  parts.push(base);
  return mergeGeometries(parts.map(p => p.toNonIndexed()))!;
}

/**
 * A flight of four chunky stone steps climbing one height level towards -z (north). Every step
 * reaches back into the cliff it leans on, and the top one runs a little onto the high ground
 * so the cliff's rim never shows above it.
 */
function stairsGeometry(): THREE.BufferGeometry {
  const n = 4;
  const back = -0.82;
  const parts: THREE.BufferGeometry[] = [];
  // Hand-cut look: every step a little different in width, depth and tilt.
  const wobble = [0.02, -0.015, 0.01, -0.02];
  for (let i = 0; i < n; i++) {
    const front = 0.5 - i / n + wobble[i]!;
    const top = ((i + 1) / n) * CLIFF_TOP + (i === n - 1 ? 0.012 : 0);
    const box = new RoundedBoxGeometry(0.92 + wobble[(i + 1) % n]!, top + 0.1, front - back, 2, 0.06);
    box.rotateY(wobble[(i + 2) % n]! * 0.6);
    box.translate(wobble[(i + 3) % n]!, top / 2 - 0.05, (front + back) / 2);
    parts.push(box);
  }
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

function arrowGeometry(twoWay: boolean): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.38);
  s.lineTo(0.28, -0.05);
  s.lineTo(0.12, -0.05);
  s.lineTo(0.12, 0.34);
  s.lineTo(-0.12, 0.34);
  s.lineTo(-0.12, -0.05);
  s.lineTo(-0.28, -0.05);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.045, 0);
  if (twoWay) {
    const dot = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12);
    dot.translate(0, 0.03, 0.25);
    return mergeGeometries([geo.toNonIndexed(), dot.toNonIndexed()])!;
  }
  return geo;
}

function rockGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.42, 1);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const n = hash2(Math.round(v.x * 100) + seed, Math.round(v.z * 100) + Math.round(v.y * 100));
    v.multiplyScalar(0.85 + n * 0.3);
    v.y = Math.max(v.y, -0.1) * 0.9;
    pos.setXYZ(i, v.x, v.y + 0.3, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A chunky clay tuft of grass: a handful of thick, rounded, curved leaves (little closed cones
 * with an oval section). Thick shapes stay solid on screen instead of shimmering like thin
 * blades. The colour attribute carries data for the grass shader: r = height along the leaf
 * (0 root, 1 tip), g = a random number per leaf (tint variation).
 */
function grassTuft(seed: number, leaves: number, height: number): THREE.BufferGeometry {
  let s = seed * 7919 + 13;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const RAD = 5;
  const RINGS = 3;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.8;
    const spread = 0.02 + rand() * 0.05;
    const x0 = Math.cos(a) * spread;
    const z0 = Math.sin(a) * spread;
    const h = height * (0.6 + rand() * 0.6) * (i === 0 ? 1.15 : 1);
    const lean = (0.25 + rand() * 0.55) * h;
    const r0 = 0.032 + rand() * 0.014;
    const tint = rand();
    const base = pos.length / 3;
    // oval cross-section, flattened across the lean direction
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    for (let k = 0; k <= RINGS; k++) {
      const t = k / RINGS;
      const cx = x0 + ux * lean * t * t;
      const cz = z0 + uz * lean * t * t;
      const cy = h * t * (1 - 0.2 * t * t);
      const r = k === RINGS ? 0 : r0 * (1 - t * 0.85);
      for (let j = 0; j < RAD; j++) {
        const q = (j / RAD) * Math.PI * 2;
        const along = Math.cos(q) * r * 0.45; // thin along the lean
        const across = Math.sin(q) * r;
        pos.push(cx + ux * along - uz * across, cy, cz + uz * along + ux * across);
        col.push(t, tint, 1);
      }
    }
    for (let k = 0; k < RINGS; k++)
      for (let j = 0; j < RAD; j++) {
        const a0 = base + k * RAD + j;
        const a1 = base + k * RAD + ((j + 1) % RAD);
        const b0 = a0 + RAD;
        const b1 = a1 + RAD;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat or tiny pieces: casting shadows would only add noise. */
const NO_SHADOW = new Set([
  'tuft',
  'flower',
  'pebbles',
  'pad',
  'arrow',
  'arrow2',
  'crumble',
  'pyramidBase',
  'dryTuft',
  'skull',
  'snowTuft',
  'iceCrystal',
  'hibiscus',
  'lavaRocks',
  'candyCane',
  'sprinkles',
  'card',
  'bladez',
  'crumbs',
  'golfFlag',
  'alienSprout',
  'craterPebbles',
  'scree',
  'mushrooms',
  'button',
  'wrappedCandy',
  'moonCrater',
  'vines',
  'vinesB',
  'icicles',
  'fern',
  'bigLeaves',
]);

/** Decorations per world: trees on cliff tops, bushes, grass tufts, flowers, pebbles. */
interface Decor {
  tree: string;
  bush: string;
  tuft: string;
  flower: string;
  pebbles: string;
  /** Flowers keep their modelled colours instead of the random tints. */
  fixedFlowers?: boolean;
  /** How much of the ground gets decorated (1 = the default sprinkling). */
  density?: number;
  /** Surface pattern painted into the ground. */
  pattern: GroundPattern;
  /** Grass clumps per ground tile (0 = bare ground) and their height. */
  grass?: number;
  grassHeight?: number;
  /** Set dressing on the high ground: medium props, and 2x2 landmarks for roomy spots. */
  mid: string[];
  big: string[];
  /** Several kinds of trees to mix (defaults to just `tree`). */
  trees?: string[];
  /** Things hanging over cliff edges (vines, icicles). */
  wallHang?: string[];
  /** Tree size on the high ground (a jungle's crowns grow into one canopy). */
  canopy?: number;
  /** Share of the gaps between big props filled with undergrowth, and what grows there. */
  undergrowth?: number;
  underPlants?: string[];
  /** Share of the well-spaced spots that get a tree (the rest get props or rocks). */
  treeShare?: number;
}

const DECOR: Record<ThemeId, Decor> = {
  training: {
    mid: ['stump', 'logPile', 'signpost', 'rockPile', 'mushrooms'],
    big: ['cottage'],
    tree: 'tree',
    bush: 'bush',
    tuft: 'tuft',
    flower: 'flower',
    pebbles: 'pebbles',
    pattern: 'grass',
    grass: 3,
    grassHeight: 0.17,
  },
  rocky: {
    mid: ['barrel', 'wagonWheel', 'deadTree', 'rockPile'],
    big: ['waterTower', 'mesa'],
    tree: 'cactus',
    bush: 'dryBush',
    tuft: 'dryTuft',
    flower: 'skull',
    pebbles: 'pebbles',
    fixedFlowers: true,
    pattern: 'sand',
  },
  ice: {
    mid: ['snowman', 'iceShards', 'snowRocks'],
    big: ['igloo'],
    wallHang: ['icicles'],
    tree: 'pine',
    bush: 'iceBush',
    tuft: 'snowTuft',
    flower: 'iceCrystal',
    pebbles: 'pebbles',
    fixedFlowers: true,
    pattern: 'snow',
  },
  tropics: {
    mid: ['banana', 'mossRock', 'tiki', 'banana'],
    big: ['stiltHut'],
    trees: ['jungleTree', 'jungleTree', 'palm'],
    wallHang: ['vines', 'vinesB'],
    canopy: 1.45,
    undergrowth: 0.7,
    underPlants: ['fern', 'bush', 'banana', 'bigLeaves', 'bush', 'mossRock'],
    treeShare: 0.8,
    tree: 'jungleTree',
    bush: 'fern',
    tuft: 'tuft',
    flower: 'hibiscus',
    pebbles: 'lavaRocks',
    fixedFlowers: true,
    pattern: 'grass',
    grass: 3,
    grassHeight: 0.21,
  },
  sweetz: {
    mid: ['donut', 'wrappedCandy', 'iceCream'],
    big: ['cupcake'],
    tree: 'lollipop',
    bush: 'gumdrops',
    tuft: 'sprinkles',
    flower: 'candyCane',
    pebbles: 'sprinkles',
    fixedFlowers: true,
    pattern: 'icing',
  },
  rollerz: {
    mid: ['chipTower', 'cardHouse'],
    big: ['slotMachine'],
    tree: 'diceStack',
    bush: 'chips',
    tuft: 'card',
    flower: 'chips',
    pebbles: 'card',
    fixedFlowers: true,
    density: 0.35,
    pattern: 'felt',
  },
  shrunk: {
    mid: ['spoon', 'pencil', 'button'],
    big: ['teacup'],
    tree: 'daisy',
    bush: 'sugarCubes',
    tuft: 'bladez',
    flower: 'flower',
    pebbles: 'crumbs',
    pattern: 'wood',
  },
  minis: {
    mid: ['fence', 'lamppost'],
    big: ['modelHouse'],
    tree: 'modelTree',
    bush: 'hedge',
    tuft: 'tuft',
    flower: 'golfFlag',
    pebbles: 'pebbles',
    fixedFlowers: true,
    pattern: 'grass',
    grass: 3,
    grassHeight: 0.12,
  },
  space: {
    mid: ['moonCrater', 'satellite'],
    big: ['rocket'],
    tree: 'crystalSpire',
    bush: 'moonRock',
    tuft: 'alienSprout',
    flower: 'alienSprout',
    pebbles: 'craterPebbles',
    fixedFlowers: true,
    pattern: 'moon',
  },
};

const WATER_LEVEL = -0.22;
const LIQUID_LEVEL = -0.55;

/** Molten floors of the chasms: lava in the tropicz, acid in the kitchen. Hazards share these. */
export const LIQUID: Partial<Record<ThemeId, { hot: number; crust: number }>> = {
  tropics: { hot: 0xff6a1a, crust: 0x2a0e06 },
  shrunk: { hot: 0x7aff3a, crust: 0x1a3a10 },
};

const TAU = Math.PI * 2;

/** Priority field for scattering: a tile only gets a large prop if it beats its neighbours. */
const prio = (x: number, y: number) => hash2(x * 101 + 7, y * 131 + 3);

/** Smooth large-scale field (value noise over 6-tile cells): groves where high, clearings where low. */
function groves(x: number, y: number): number {
  const fx = x / 6;
  const fy = y / 6;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v = (i: number, j: number) => hash2(i * 71 + 13, j * 97 + 41);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** 2x2 landmarks (houses and the like) sit on a sparse grid of candidate spots. */
const HOUSE_GRID = 7;

/**
 * The 2x2 block of high ground a landmark occupies, if tile (x, y) is part of one. Every
 * candidate needs a margin of high ground around it so it never hangs over a cliff edge.
 */
function houseBlock(
  x: number,
  y: number,
  high: (tx: number, ty: number) => boolean,
  chance: number,
): { ax: number; ay: number; yard: boolean } | null {
  const cx = Math.floor(x / HOUSE_GRID);
  const cy = Math.floor(y / HOUSE_GRID);
  if (hash2(cx * 17 + 5, cy * 23 + 11) > chance) return null;
  const ax = cx * HOUSE_GRID + 1 + Math.floor(hash2(cx * 7 + 3, cy * 13 + 1) * (HOUSE_GRID - 3));
  const ay = cy * HOUSE_GRID + 1 + Math.floor(hash2(cx * 11 + 9, cy * 5 + 7) * (HOUSE_GRID - 3));
  // the 2x2 block itself plus a one-tile yard around it (kept clear of trees)
  if (x < ax - 1 || y < ay - 1 || x > ax + 2 || y > ay + 2) return null;
  for (let ty = ay - 1; ty <= ay + 2; ty++) for (let tx = ax - 1; tx <= ax + 2; tx++) if (!high(tx, ty)) return null;
  return { ax, ay, yard: x < ax || y < ay || x > ax + 1 || y > ay + 1 };
}

/** Height of the cliff tops (matches the Blender kit). */
export const CLIFF_TOP = 1.06;
const H = CLIFF_TOP;

/** Dual-grid terrain classes: High ground, Ground, Water, Chasm. */
type TerrainClass = 'H' | 'G' | 'W' | 'C';

function terrainClass(v: TileVisual | undefined): TerrainClass {
  if (!v || v.kind === 'cliff') return 'H';
  if (v.kind === 'water' || (v.kind === 'bridge' && v.over === 'water')) return 'W';
  if (v.kind === 'death' || (v.kind === 'bridge' && v.over === 'death')) return 'C';
  return 'G';
}

/**
 * Shape of a 4-bit corner mask (bits: 0 NE, 1 NW, 2 SW, 3 SE). k is the lowest set bit of a
 * single corner or of an adjacent pair (wrapping), or the missing bit of three corners.
 */
function maskShape(mask: number): { kind: 'single' | 'pair' | 'diagonal' | 'triple' | 'full'; k: number } {
  const count = ((mask >> 0) & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (count === 4) return { kind: 'full', k: 0 };
  if (count === 1) return { kind: 'single', k: Math.log2(mask) };
  if (count === 3) return { kind: 'triple', k: Math.log2(~mask & 15) };
  if (mask === 5 || mask === 10) return { kind: 'diagonal', k: 0 };
  for (let k = 0; k < 4; k++) if (mask === ((1 << k) | (1 << ((k + 1) % 4)))) return { kind: 'pair', k };
  return { kind: 'full', k: 0 };
}

export function createTileKit(theme: ThemeId, options: TerrainOptions = { grass: 'tufts', scenery: 'full' }): TileKit {
  const pal = PALETTES[theme];
  const decor = DECOR[theme];
  /** How grass grows here (only grassy worlds have any). */
  const grassMode = decor.grass ? options.grass : 'off';
  const reduced = options.scenery === 'reduced';
  const pieces = new Map<PieceKey, PieceDef>();
  const disposables: { dispose(): void }[] = [];
  const mask: LiquidMask = createLiquidMask();
  const water = waterMaterial(pal.water, pal.waterDeep, mask);
  disposables.push(water);

  const def = (
    key: PieceKey,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cast = true,
    receive = true,
  ) => {
    pieces.set(key, { geometry, material, castShadow: cast, receiveShadow: receive });
    disposables.push(geometry);
  };
  const clay = (color: number, opts: { rough?: number; metal?: number } = {}) => {
    const m = clayMaterial(color, opts);
    disposables.push(m);
    return m;
  };

  // Ground slab (top at y=0). Plain box so neighbouring slabs join seamlessly.
  const ground = new THREE.BoxGeometry(1, 0.4, 1);
  ground.translate(0, -0.2, 0);
  // Velvet grass is drawn by the ground shader itself (one pass, see groundMaterial).
  const velvetOn = grassMode === 'velvet';
  const groundMat = groundMaterial(pal.ground[0]!, pal.groundAlt, pal.dirt, decor.pattern, velvetOn);
  disposables.push(groundMat);
  def('ground', ground, groundMat, false, true);
  const grass = grassMaterial(pal.ground[0]!, pal.groundAlt, pal.dirt);
  disposables.push(grass);
  const tuftShadows = grassMode === 'tuftsShadow';
  for (let i = 0; i < 4; i++)
    def(`grass${i}`, grassTuft(i + 1, 6, decor.grassHeight ?? 0.16), grass, tuftShadows, true);
  // The tops of cliffs are ground too: same patterned surface and grass, in the top colour.
  const topB = new THREE.Color(pal.cliffTop).offsetHSL(0.02, 0.04, 0.05).getHex();
  const topMat = groundMaterial(pal.cliffTop, topB, pal.dirt, decor.pattern, velvetOn);
  const grassTop = grassMaterial(pal.cliffTop, topB, pal.dirt);
  disposables.push(topMat, grassTop);
  for (let i = 0; i < 4; i++)
    def(`grassTop${i}`, grassTuft(i + 11, 6, decor.grassHeight ?? 0.16), grassTop, tuftShadows, true);

  const surface = new THREE.PlaneGeometry(1, 1, 6, 6);
  surface.rotateX(-Math.PI / 2);
  surface.translate(0, WATER_LEVEL, 0);
  def('waterSurface', surface, water, false, true);
  // Worlds where the abyss is full of something nasty: lava in the tropicz, acid in the kitchen.
  const liquidColors = LIQUID[theme];
  const liquid = liquidColors ? lavaMaterial(liquidColors.hot, liquidColors.crust, mask) : null;
  if (liquid) {
    disposables.push(liquid);
    const pool = new THREE.PlaneGeometry(1, 1, 4, 4);
    pool.rotateX(-Math.PI / 2);
    pool.translate(0, LIQUID_LEVEL, 0);
    def('liquidDeath', pool, liquid, false, false);
  }
  const holeDisc = new THREE.CylinderGeometry(0.38, 0.3, 0.04, 20);
  holeDisc.translate(0, 0.005, 0);
  def('holeDark', holeDisc, clay(0x140c08, { rough: 1 }), false, false);
  const holeRim = new THREE.TorusGeometry(0.4, 0.06, 6, 20);
  holeRim.rotateX(Math.PI / 2);
  holeRim.translate(0, 0.02, 0);
  def('holeRim', holeRim, clay(pal.dirt), false, true);
  const mound = new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1, 0.55, 1);
  def('mound', mound, clay(pal.dirt), true, true);
  def('spikes', spikesGeometry(), clay(0xb8bcc4, { rough: 0.35, metal: 0.6 }), true, true);
  def('rock', rockGeometry(1), clay(pal.rock), true, true);
  def('rockAlt', rockGeometry(7), clay(pal.rock), true, true);
  const pad = roundedBox(0.92, 0.06, 0.92, 0.04);
  pad.translate(0, 0.06, 0);
  def('pad', pad, clay(pal.metal, { rough: 0.4, metal: 0.5 }), false, true);
  const metal = roundedBox(1, 0.7, 1, 0.05);
  metal.translate(0, 0.7, 0);
  def('metal', metal, clay(pal.metal, { rough: 0.4, metal: 0.5 }), true, true);
  const crack = new THREE.PlaneGeometry(0.8, 0.8);
  crack.rotateX(-Math.PI / 2);
  crack.translate(0, 0.004, 0);
  def('crumbleCrack', crack, clay(0x5a4030), false, true);
  const planks = new THREE.BoxGeometry(1, 0.1, 0.9);
  planks.translate(0, -0.05, 0);
  def('bridge', planks, clay(pal.wood), true, true);
  def('arrow', arrowGeometry(false), clay(0xffffff, { rough: 0.5 }), false, true);
  def('arrow2', arrowGeometry(true), clay(0xffffff, { rough: 0.5 }), false, true);
  const switchBase = new THREE.CylinderGeometry(0.38, 0.42, 0.06, 24);
  switchBase.translate(0, 0.03, 0);
  def('switchBase', switchBase, clay(0x7a7a80, { rough: 0.5, metal: 0.3 }), false, true);
  const switchButton = new THREE.CylinderGeometry(0.28, 0.3, 0.1, 24);
  switchButton.translate(0, 0.05, 0);
  def('switchButton', switchButton, clay(0xffffff, { rough: 0.45 }), true, true);
  const pyramid = new THREE.ConeGeometry(0.62, 0.95, 4, 1);
  pyramid.rotateY(Math.PI / 4);
  pyramid.translate(0, 0.475, 0);
  def('pyramid', pyramid, clay(0xffffff, { rough: 0.5 }), true, true);
  const pyramidBase = new THREE.BoxGeometry(0.9, 0.04, 0.9);
  pyramidBase.translate(0, 0.02, 0);
  def('pyramidBase', pyramidBase, clay(0x6a6a72), false, true);
  // Steps cut from the world's own cliff rock, a shade lighter so they stand out.
  const stepColor = new THREE.Color(pal.cliff).lerp(new THREE.Color(pal.rock), 0.35).offsetHSL(0, -0.05, 0.1);
  def('stairs', stairsGeometry(), clay(stepColor.getHex()), true, true);

  // --- pieces modelled in Blender (terrain.glb), recoloured for the theme ---------------
  const gltf = models.get('terrain');
  const roleColor = (role: string, key: string): number => {
    // Fixed colour decorations are named after their colour (Fix_ff4a8a).
    if (role.startsWith('Fix_')) return parseInt(role.slice(4, 10), 16);
    switch (role) {
      case 'Grass':
        return key === 'tuft' || key === 'flower'
          ? new THREE.Color(pal.ground[0]!).multiplyScalar(1.12).getHex()
          : pal.cliffTop;
      case 'Rock':
        return key.startsWith('cliff') || key.startsWith('ledge') || key === 'mesa' ? pal.cliff : pal.rock;
      case 'Dirt':
        return pal.dirt;
      case 'Sand':
        return pal.sand;
      case 'Crust':
        // Dried-out top soil: the world's ground colour, a touch darker.
        return new THREE.Color(pal.ground[0]!).multiplyScalar(0.82).getHex();
      case 'Wood':
        return pal.wood;
      case 'Metal':
        return pal.metal;
      case 'Stone':
        return new THREE.Color(pal.rock).lerp(new THREE.Color(0xffffff), 0.45).getHex();
      case 'Leaf':
        return new THREE.Color(pal.cliffTop).multiplyScalar(0.8).getHex();
      case 'Bark':
        return 0x6a4428;
      case 'Dark':
        return 0x1a120c;
      default:
        return 0xffffff;
    }
  };
  const glbMaterials = new Map<string, THREE.MeshStandardMaterial>();
  // Terrain surfaces with their own shaders.
  const bed = bedMaterial(pal.sand, pal.waterDeep, WATER_LEVEL);
  const chasm = chasmMaterial(
    pal.cliff,
    pal.abyss,
    liquid ? { color: LIQUID[theme]!.hot, level: LIQUID_LEVEL } : undefined,
  );
  disposables.push(bed, chasm);
  const glbMaterial = (role: string, key: string, vertexColors: boolean): THREE.Material => {
    if (role === 'Ground') return groundMat;
    if (role === 'Grass' && key.startsWith('cliff_')) return topMat;
    // Walkable high ground: the same surface as the ground below.
    if (role === 'Grass' && key.startsWith('ledge_')) return groundMat;
    if (role === 'Bed') return bed;
    if (role === 'Chasm') return chasm;
    const color = roleColor(role, key);
    const id = `${role}|${color}|${vertexColors}`;
    let m = glbMaterials.get(id);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: role === 'Metal' ? 0.4 : 0.88,
        metalness: role === 'Metal' ? 0.55 : 0,
        vertexColors,
      });
      applyClay(m, 1, 0.15);
      glbMaterials.set(id, m);
      disposables.push(m);
    }
    return m;
  };
  const glbParts = new Map<PieceKey, PieceDef[]>();
  const fromGlb = (key: PieceKey): PieceDef[] | undefined => {
    if (!gltf) return undefined;
    const cached = glbParts.get(key);
    if (cached) return cached;
    // Ledges are cliff pieces with a walkable top.
    const node = gltf.scene.getObjectByName(key.startsWith('ledge_') ? `cliff_${key.slice(6)}` : key);
    if (!node) return undefined;
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const out: PieceDef[] = [];
    node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      const role = (mesh.material as THREE.Material).name || 'Accent';
      const hasColors = !!geometry.attributes.color;
      const shadow = !NO_SHADOW.has(key);
      out.push({ geometry, material: glbMaterial(role, key, hasColors), castShadow: shadow, receiveShadow: true });
      disposables.push(geometry);
    });
    glbParts.set(key, out);
    return out;
  };

  /** Big props and their size (landmarks cover 2x2 tiles). */
  const LANDMARK_SCALE: Record<string, number> = {
    cottage: 1,
    waterTower: 1,
    stiltHut: 1,
    igloo: 2.1,
    modelHouse: 2.3,
    hut: 2.2,
    cupcake: 2.2,
    teacup: 2.2,
    slotMachine: 2,
    rocket: 2,
    mesa: 2,
  };

  /**
   * Set dressing on high ground (cliff tops inside the map, the land around it). Large props
   * go only where the tile beats its four neighbours in a random priority field, so they never
   * bunch up; every piece gets its own random turn, offset and size.
   * density: share of those spots that get something; houses: chance of a 2x2 landmark per
   * grid cell.
   */
  const scatterHigh = (
    x: number,
    y: number,
    at_: (tx: number, ty: number) => TileVisual | undefined,
    density: number,
    houses: number,
    detail = 1,
  ): PlacedPieceDef[] => {
    const out: PlacedPieceDef[] = [];
    if (reduced) {
      // Lighter scenery: fewer props, nothing small far from the map.
      density *= 0.6;
      if (detail < 1) detail = 0;
    }
    // Grass on top (grassy worlds), thinning out far away.
    // (not under a jungle's undergrowth, which covers the ground anyway)
    const lawn =
      grassMode === 'off' || grassMode === 'velvet'
        ? 0
        : detail >= 1 && !decor.undergrowth
          ? Math.round((decor.grass ?? 0) * 0.6)
          : detail >= 1 && decor.grass
            ? 1
            : 0;
    for (let i = 0; i < lawn; i++) {
      const gx = hash2(x * 31 + i * 7, y * 17 + i * 3) - 0.5;
      const gz = hash2(x * 13 + i * 5, y * 29 + i * 11) - 0.5;
      const sc = 0.8 + hash2(x + i * 19, y * 3 + i) * 0.6;
      out.push({
        key: `grassTop${i % 4}`,
        matrix: at(x + gx * 0.96, y + gz * 0.96, H, hash2(x * 7 + i, y * 13 + i * 5) * TAU, sc, sc, sc),
      });
    }
    const high = (tx: number, ty: number) => {
      const v = at_(tx, ty);
      return !v || v.kind === 'cliff';
    };
    const spin = hash2(x * 7 + 13, y * 11 + 29) * TAU;
    const size = 0.85 + hash2(x * 29 + 1, y * 31 + 5) * 0.35;
    const jx = (hash2(x * 3 + 1, y * 5 + 2) - 0.5) * 0.36;
    const jz = (hash2(x * 5 + 3, y * 3 + 7) - 0.5) * 0.36;
    const put = (key: string, scale = 1, dx = jx, dz = jz) =>
      out.push({ key, matrix: at(x + dx, y + dz, H, spin, size * scale, size * scale, size * scale) });
    const pick = (list: string[], salt: number) =>
      list[Math.floor(hash2(x * 13 + salt, y * 17 + salt * 3) * list.length)]!;
    // Vines or icicles over the exposed edges.
    if (decor.wallHang) {
      const sides: [number, number, number][] = [
        [0, 1, 0],
        [1, 0, Math.PI / 2],
        [0, -1, Math.PI],
        [-1, 0, -Math.PI / 2],
      ];
      for (const [dx, dy, r] of sides) {
        if (high(x + dx, y + dy) || hash2(x * 53 + dx * 7, y * 59 + dy * 11) > 0.55) continue;
        const shift = (hash2(x * 61 + dy, y * 67 + dx) - 0.5) * 0.3;
        out.push({
          key: pick(decor.wallHang, 13 + dx + dy * 3),
          matrix: at(x + (dy ? shift : 0), y + (dx ? shift : 0), 0, r, 0.9 + hash2(x, y * 71) * 0.2, 1, 1),
        });
      }
    }

    if (decor.big.length && houses > 0) {
      const block = houseBlock(x, y, high, houses);
      if (block?.yard) {
        // Around a house only low things grow, so nothing pokes through its roof.
        const q = hash2(x * 37 + 3, y * 41 + 9);
        if (q < 0.3) put(decor.bush, 0.9);
        return out;
      }
      if (block) {
        if (block.ax === x && block.ay === y) {
          const key = pick(decor.big, 5);
          const sc = LANDMARK_SCALE[key] ?? 1;
          // Centred on the corner the four tiles share; any heading.
          out.push({ key, matrix: at(x + 0.5, y + 0.5, H, hash2(x * 3 + 7, y * 7 + 3) * TAU, sc, sc, sc) });
        }
        return out;
      }
    }
    const p = prio(x, y);
    const peak = p > prio(x + 1, y) && p > prio(x - 1, y) && p > prio(x, y + 1) && p > prio(x, y - 1);
    // Groves and clearings: the local density follows a smooth field.
    const local = density * (0.25 + 1.1 * THREE.MathUtils.smoothstep(groves(x, y), 0.2, 0.8));
    if (peak && hash2(x * 43 + 1, y * 47 + 9) < local) {
      const kind = hash2(x * 19 + 5, y * 23 + 7);
      const trees = decor.treeShare ?? 0.6;
      if (kind < trees) put(pick(decor.trees ?? [decor.tree], 9), decor.canopy ?? 1);
      else if (kind < trees + (1 - trees) * 0.65 && decor.mid.length) put(pick(decor.mid, 1), 1.05);
      else put('rockPile', 0.8);
      return out;
    }
    // Small things fill the gaps.
    const q = hash2(x * 37 + 3, y * 41 + 9);
    if (reduced && detail === 0) return out;
    if (
      decor.undergrowth &&
      decor.underPlants &&
      q < decor.undergrowth * (reduced ? 0.4 : 1) * (0.5 + 0.6 * groves(x, y)) &&
      (detail > 0 || !reduced)
    ) {
      put(pick(decor.underPlants, 4), 1.1 + hash2(x * 83, y * 89) * 0.5);
      return out;
    }
    if (q < 0.18 * density + 0.05) put(decor.bush, 1.15);
    else if (q < 0.4 * density + 0.1 && !decor.grass) put(decor.tuft, 1.9);
    return out;
  };

  const kit: TileKit = {
    parts(key) {
      const glb = fromGlb(key);
      if (glb && glb.length) return glb;
      const p = pieces.get(key);
      if (!p) throw new Error(`Unknown piece ${key}`);
      return [p];
    },

    tilePieces(x, y, v, nb, bare = false, lv = () => 0) {
      const out: PlacedPieceDef[] = [];
      const own = lv(0, 0);
      const h = hash2(x * 3, y * 7);
      // Grid-aligned pieces turn in quarter steps, round ones any way (own hash, so the turn
      // is not tied to what gets placed).
      const rot = Math.floor(hash2(x * 23 + 11, y * 19 + 5) * 4) * (Math.PI / 2);
      const free = hash2(x * 31 + 17, y * 37 + 23) * TAU;
      const glb = !!gltf;
      const decorate = () => {
        // Scatter small decorations on plain ground (deterministic per tile).
        const r = hash2(x * 17 + 3, y * 31 + 7) / (decor.density ?? 1);
        const jx = (hash2(x, y * 5) - 0.5) * 0.6;
        const jz = (hash2(x * 5, y) - 0.5) * 0.6;
        const spin = hash2(y, x) * Math.PI * 2;
        const place = (key: string, color?: number, scale = 1) => {
          const m = at(x + jx, y + jz, 0, spin, scale, scale, scale);
          const def: PlacedPieceDef = { key, matrix: m };
          if (color !== undefined) def.color = new THREE.Color(color);
          out.push(def);
        };
        // Grassy worlds already grow their own tufts all over.
        if (r < 0.18) {
          if (!decor.grass) place(decor.tuft, undefined, 1.6 + hash2(x * 7, y * 3) * 0.9);
        } else if (r < 0.225)
          place(
            decor.flower,
            decor.fixedFlowers ? undefined : FLOWER_COLORS[Math.floor(hash2(x * 9, y * 13) * FLOWER_COLORS.length)]!,
            1.6,
          );
        else if (r < 0.27) place(decor.pebbles, undefined, 1.5);
      };
      const lawn = () => {
        // (velvet grass grows in the ground shader, no pieces needed)
        if (bare || grassMode === 'off' || grassMode === 'velvet') return;
        // Chunky clay tufts dotted over the tile.
        const count = decor.grass ?? 0;
        for (let i = 0; i < count; i++) {
          const gx = hash2(x * 31 + i * 7, y * 17 + i * 3) - 0.5;
          const gz = hash2(x * 13 + i * 5, y * 29 + i * 11) - 0.5;
          const sc = 0.75 + hash2(x + i * 19, y * 3 + i) * 0.6;
          out.push({
            key: `grass${i % 4}`,
            matrix: at(x + gx * 0.96, y + gz * 0.96, 0, hash2(x * 7 + i, y * 13 + i * 5) * TAU, sc, sc, sc),
          });
        }
      };
      switch (v.kind) {
        case 'ground':
          lawn();
          if (glb && !bare) decorate();
          break;
        case 'nogo':
          lawn();
          if (glb && h > 0.55) out.push({ key: decor.bush, matrix: at(x, y, 0, free) });
          break;
        case 'cliff':
          // The rock itself comes from the dual grid; trees, bushes and props sit on top.
          out.push(...scatterHigh(x, y, (tx, ty) => nb(tx - x, ty - y), 0.55, 0.3));
          break;
        case 'metal':
          out.push({ key: 'metal', matrix: at(x, y) });
          break;
        case 'water':
          out.push({ key: 'waterSurface', matrix: at(x, y) });
          break;
        case 'death':
          if (liquid) out.push({ key: 'liquidDeath', matrix: at(x, y) });
          break;
        case 'hole':
          if (glb) out.push({ key: 'hole', matrix: at(x, y, 0, free) });
          else {
            out.push({ key: 'holeDark', matrix: at(x, y) });
            out.push({ key: 'holeRim', matrix: at(x, y) });
          }
          break;
        case 'mound':
          out.push({ key: 'mound', matrix: at(x, y, 0, free) });
          break;
        case 'spikes':
          out.push({ key: 'spikes', matrix: at(x, y, 0, rot) });
          break;
        case 'rock':
          out.push({ key: v.alt ? 'rockAlt' : 'rock', matrix: at(x, y, 0, free) });
          break;
        case 'pad':
        case 'brickz':
          out.push({ key: 'pad', matrix: at(x, y) });
          break;
        case 'giantRock':
          // The boulder itself is an entity model; the ground stays underneath.
          break;
        case 'crumble':
          out.push({ key: glb ? 'crumble' : 'crumbleCrack', matrix: at(x, y, 0, rot) });
          break;
        case 'ramp':
          out.push({ key: 'stairs', matrix: at(x, y, 0, -(v.dir / 8) * Math.PI * 2) });
          break;
        case 'bridge':
          if (v.over === 'water') out.push({ key: 'waterSurface', matrix: at(x, y) });
          else if (liquid) out.push({ key: 'liquidDeath', matrix: at(x, y) });
          out.push({ key: 'bridge', matrix: at(x, y), lift: v.lowered ? 0 : 1 });
          break;
        case 'arrow':
          out.push({
            key: v.twoWay ? 'arrow2' : 'arrow',
            matrix: at(x, y, 0, -(v.dir / 8) * Math.PI * 2),
            color: new THREE.Color(v.twoWay ? 0x3a8ae8 : 0xf2cf2a),
          });
          break;
        case 'switch': {
          if (v.switchKind === 'secret') break;
          out.push({ key: 'switchBase', matrix: at(x, y) });
          const color = new THREE.Color(SWITCH_COLORS[v.switchKind]);
          out.push({ key: 'switchButton', matrix: at(x, y, v.pressed ? -0.07 : 0), color });
          break;
        }
        case 'pyramid':
          out.push({ key: 'pyramidBase', matrix: at(x, y) });
          out.push({
            key: 'pyramid',
            matrix: at(x, y),
            color: new THREE.Color(PYRAMID_COLORS[v.pyramidKind]),
            lift: v.lowered ? 0 : 1,
          });
          break;
      }
      const sides: [number, number, number][] = [
        [0, -1, 0],
        [1, 0, Math.PI / 2],
        [0, 1, Math.PI],
        [-1, 0, -Math.PI / 2],
      ];
      // Rubble at the foot of cliff walls (not in front of stairz leading up).
      if (glb && (v.kind === 'ground' || v.kind === 'nogo')) {
        for (const [dx, dy, r] of sides) {
          const n = nb(dx, dy);
          if (n && n.kind !== 'cliff' && lv(dx, dy) <= own) continue;
          if (n?.kind === 'ramp') continue;
          if (hash2(x * 11 + dx * 3, y * 7 + dy * 5) > 0.45) continue;
          const along = (hash2(x * 3 + dy, y * 5 + dx) - 0.5) * 0.4;
          out.push({ key: 'scree', matrix: at(x + dx * 0.36 + dy * along, y + dy * 0.36 + dx * along, 0, r) });
        }
      }
      // Vines or icicles down the edges of walkable high ground.
      if (glb && decor.wallHang && own > 0 && v.kind !== 'cliff') {
        for (const [dx, dy, r] of sides) {
          const n = nb(dx, dy);
          if (!n || lv(dx, dy) >= own || n.kind === 'ramp') continue;
          if (hash2(x * 53 + dx * 7, y * 59 + dy * 11) > 0.5) continue;
          const shift = (hash2(x * 61 + dy, y * 67 + dx) - 0.5) * 0.3;
          out.push({
            key: decor.wallHang[Math.floor(hash2(x * 13 + dx, y * 17 + dy) * decor.wallHang.length)]!,
            // (same turn as on cliff tops: the piece hangs off the side it faces)
            matrix: at(
              x + (dy ? shift : 0),
              y + (dx ? shift : 0),
              -H,
              dy ? r + Math.PI : r,
              0.9 + hash2(x, y * 71) * 0.2,
              1,
              1,
            ),
          });
        }
      }
      return out;
    },

    cellPieces(cx, cy, corners) {
      const out: PlacedPieceDef[] = [];
      const cls = corners.map(c => (c.level > 0 ? 'H' : terrainClass(c.v)));
      const bits = (c: TerrainClass | 'L') =>
        cls.reduce((m, k, i) => (k === c || (c === 'L' && (k === 'W' || k === 'C')) ? m | (1 << i) : m), 0);
      const place = (key: string, quarters: number, y = 0) =>
        out.push({ key, matrix: at(cx - 0.5, cy - 0.5, y, quarters * (Math.PI / 2)) });
      const variant = (base: string, n: number) => `${base}_${Math.floor(hash2(cx * 7 + 1, cy * 13 + 5) * n)}`;
      /** Corners at or above a level (bits: 0 NE, 1 NW, 2 SW, 3 SE). */
      const above = (level: number) => corners.reduce((m, c, i) => (c.level >= level ? m | (1 << i) : m), 0);
      if (!gltf) {
        if (above(1) !== 15 && bits('L') === 0) place('ground', 0);
        return out;
      }

      // Ground level: flat where nothing is low, otherwise a bank or chasm edge piece.
      const low = bits('L');
      const family = bits('C') ? 'chasm' : 'bank';
      if (low === 0) {
        if (above(1) !== 15) place('ground', 0);
      } else {
        const shape = maskShape(low);
        if (shape.kind === 'full') {
          if (family === 'bank') place('bank_full_0', 0);
        } else if (shape.kind === 'single') place(`${family}_concave_0`, shape.k - 2);
        else if (shape.kind === 'pair') place(variant(`${family}_half`, family === 'chasm' ? 3 : 2), shape.k - 2);
        else if (shape.kind === 'diagonal') place(`${family}_saddle_0`, low & 2 ? 0 : 1);
        else place(`${family}_convex_0`, shape.k);
      }

      // Cliffs on top, one layer per height level. A layer whose top you can walk on (high
      // ground) gets the ground's own surface, walls keep their cliff-top look.
      const top = corners.reduce((m, c) => Math.max(m, c.level), 0);
      for (let level = 1; level <= top; level++) {
        const high = above(level);
        if (high === 0) break;
        // Buried under the next layer.
        if (high === 15 && above(level + 1) === 15) continue;
        const walkable = corners.some(c => c.level === level && !c.wall);
        const kind = walkable ? 'ledge' : 'cliff';
        const y = (level - 1) * H;
        const shape = maskShape(high);
        if (shape.kind === 'full') place(`${kind}_full_0`, 0, y);
        else if (shape.kind === 'single') place(variant(`${kind}_convex`, 2), shape.k, y);
        else if (shape.kind === 'pair') place(variant(`${kind}_half`, 3), shape.k, y);
        else if (shape.kind === 'diagonal') {
          for (let k = 0; k < 4; k++) if (high & (1 << k)) place(variant(`${kind}_convex`, 2), k, y);
        } else place(variant(`${kind}_concave`, 2), shape.k - 2, y);
      }
      return out;
    },

    surroundingPieces(x, y, nb, detail) {
      return scatterHigh(x, y, (tx, ty) => nb(tx - x, ty - y), 1, 0.55, detail);
    },

    setLiquidMask(texture, width, height, flow) {
      mask.texture.value = texture;
      mask.size.value.set(width, height);
      mask.flow.value.copy(flow);
    },

    liftTransform(key, level) {
      if (key === 'pyramid') return tmp.makeScale(1, Math.max(0.03, level), 1).clone();
      if (key === 'bridge') return tmp.makeTranslation(0, (level - 1) * 0.5, 0).clone();
      return new THREE.Matrix4();
    },

    backdrop(width, height) {
      const group = new THREE.Group();
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 200, height + 200),
        new THREE.MeshBasicMaterial({ color: pal.abyss }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2, -4, height / 2);
      group.add(floor);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 4, height + 4),
        new THREE.MeshBasicMaterial({ color: pal.abyssGlow, transparent: true, opacity: 0.35 }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(width / 2, -3.9, height / 2);
      group.add(glow);
      disposables.push(
        floor.geometry,
        floor.material as THREE.Material,
        glow.geometry,
        glow.material as THREE.Material,
      );
      return group;
    },

    update(time) {
      water.userData.time.value = time;
      bed.userData.time.value = time;
      grass.userData.time.value = time;
      grassTop.userData.time.value = time;
      groundMat.userData.time.value = time;
      topMat.userData.time.value = time;
      if (liquid) liquid.userData.time.value = time;
    },

    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
  return kit;
}

/** Light rig of a world: warm key light, cool sky fill and a bounce from the ground. */
export interface Lighting {
  sun: number;
  sunIntensity: number;
  /** Sky colour of the fill light and the environment's zenith. */
  sky: number;
  /** Light bounced off the ground (hemisphere ground colour, environment below the horizon). */
  bounce: number;
  hemi: number;
  env: number;
  rim: number;
}

const LIGHTING: Record<ThemeId, Lighting> = {
  training: { sun: 0xfff0d6, sunIntensity: 2.7, sky: 0x9fc6ff, bounce: 0x7a8a48, hemi: 0.4, env: 0.28, rim: 0xe8f2ff },
  rocky: { sun: 0xffe0b4, sunIntensity: 2.79, sky: 0x94b8ec, bounce: 0xb07a50, hemi: 0.38, env: 0.25, rim: 0xffe8d0 },
  ice: { sun: 0xfff2e6, sunIntensity: 2.15, sky: 0xa4ccff, bounce: 0xa8c4dc, hemi: 0.42, env: 0.3, rim: 0xe0f0ff },
  tropics: { sun: 0xffe2b0, sunIntensity: 2.9, sky: 0x86d0d8, bounce: 0x4a7a2a, hemi: 0.38, env: 0.25, rim: 0xfff0d8 },
  sweetz: { sun: 0xfff0ec, sunIntensity: 2.1, sky: 0xc8b4ff, bounce: 0xe898c0, hemi: 0.42, env: 0.3, rim: 0xffe8f4 },
  rollerz: { sun: 0xfff0d0, sunIntensity: 2.6, sky: 0xa0b0e8, bounce: 0x3a6a4a, hemi: 0.38, env: 0.28, rim: 0xfff4e0 },
  shrunk: { sun: 0xfff0d8, sunIntensity: 2.7, sky: 0xaccef0, bounce: 0xb89a70, hemi: 0.4, env: 0.28, rim: 0xfff4e4 },
  minis: { sun: 0xfff4e0, sunIntensity: 2.7, sky: 0xa4ccff, bounce: 0x6a9a4a, hemi: 0.4, env: 0.28, rim: 0xeef6ff },
  space: { sun: 0xe6e4ff, sunIntensity: 2.42, sky: 0x6a6ec8, bounce: 0x44445e, hemi: 0.35, env: 0.25, rim: 0xc8c0ff },
};

export function themeLighting(theme: ThemeId): Lighting {
  return LIGHTING[theme];
}

export function themeSky(theme: ThemeId): number {
  return PALETTES[theme].sky;
}

/** Main colours of a world for 2D views (minimap). */
export function themeColors(theme: ThemeId): {
  ground: number;
  cliff: number;
  water: number;
  abyss: number;
  rock: number;
} {
  const p = PALETTES[theme];
  return { ground: p.ground[0]!, cliff: p.cliff, water: p.water, abyss: p.abyss, rock: p.rock };
}

/** Colour of loose rocks in a world (tints rock props like giant rocks and boulders). */
export function themeRock(theme: ThemeId): number {
  return PALETTES[theme].rock;
}
