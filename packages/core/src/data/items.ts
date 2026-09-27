/**
 * Item tables. Numbers come from the original game (timings in milliseconds);
 * the simulation converts them to ticks with msToTicks().
 */

export const TOOLS = [
  'GAUNTLETZ',
  'SHOVEL',
  'CLUB',
  'SWORD',
  'GLOVEZ',
  'SPRING',
  'TOOB',
  'WINGZ',
  'GRAVITYBOOTZ',
  'BOOMERANG',
  'ROCK',
  'NERFGUN',
  'GUNHAT',
  'WELDER',
  'SHIELD',
  'BRICK',
  'TIMEBOMB',
  'BOMB',
  'GOOBER',
  'SPY',
  'WAND',
  'WARPSTONE',
] as const;
export type ToolId = (typeof TOOLS)[number];

/** Pseudo tools used by the simulation for special states. */
export type CombatTool = ToolId | 'NONE' | 'TOOBWATER' | 'REAPER' | 'CONVERT';

export interface ToolInfo {
  damage: number;
  /** Range in tiles for ranged tools. */
  range?: number;
  /** Delay from swing start to hit (ms). */
  attackDelay: number;
  /** Delay from hit to end of the attack animation (ms). */
  attackIdle: number;
  /** Duration of the "struck" reaction when hit while holding this tool (ms). */
  struck: number;
  /** Stamina recharge after an attack (ms). */
  recharge: number;
  /** Stamina recharge after using the tool on the world (ms), defaults to recharge. */
  itemRecharge?: number;
  /** Time to walk one tile (ms). */
  rate: number;
  /** Projectile flight time (ms). */
  throwDuration?: number;
  ranged?: boolean;
  /** Tools that let the grunt enter water. */
  water?: boolean;
}

const tool = (t: ToolInfo) => t;

export const TOOL_INFO: Record<CombatTool, ToolInfo> = {
  NONE: tool({ damage: 1, attackDelay: 290, attackIdle: 350, struck: 430, recharge: 2000, rate: 600 }),
  REAPER: tool({ damage: 100, attackDelay: 700, attackIdle: 700, struck: 430, recharge: 0, rate: 800 }),
  CONVERT: tool({ damage: 0, attackDelay: 600, attackIdle: 400, struck: 430, recharge: 0, rate: 600 }),
  BOMB: tool({ damage: 1, attackDelay: 1500, attackIdle: 450, struck: 430, recharge: 0, rate: 600 }),
  BOOMERANG: tool({
    damage: 6,
    range: 6,
    attackDelay: 400,
    attackIdle: 320,
    struck: 240,
    recharge: 6000,
    throwDuration: 500,
    rate: 600,
    ranged: true,
  }),
  BRICK: tool({ damage: 4, attackDelay: 430, attackIdle: 230, struck: 420, recharge: 2500, itemRecharge: 15000, rate: 600 }),
  CLUB: tool({ damage: 8, attackDelay: 370, attackIdle: 350, struck: 550, recharge: 3500, rate: 600 }),
  GAUNTLETZ: tool({ damage: 5, attackDelay: 300, attackIdle: 300, struck: 430, recharge: 2750, itemRecharge: 2750, rate: 600 }),
  GLOVEZ: tool({ damage: 1, attackDelay: 200, attackIdle: 280, struck: 430, recharge: 2000, rate: 600 }),
  GOOBER: tool({ damage: 2, attackDelay: 250, attackIdle: 270, struck: 590, recharge: 2250, itemRecharge: 2250, rate: 600 }),
  GRAVITYBOOTZ: tool({ damage: 3, attackDelay: 475, attackIdle: 475, struck: 430, recharge: 2250, rate: 600 }),
  GUNHAT: tool({
    damage: 10,
    range: 6,
    attackDelay: 360,
    attackIdle: 200,
    struck: 310,
    recharge: 10000,
    throwDuration: 1800,
    rate: 600,
    ranged: true,
  }),
  NERFGUN: tool({
    damage: 1,
    range: 5,
    attackDelay: 350,
    attackIdle: 350,
    struck: 430,
    recharge: 5000,
    throwDuration: 1800,
    rate: 600,
    ranged: true,
  }),
  ROCK: tool({
    damage: 8,
    range: 4,
    attackDelay: 300,
    attackIdle: 340,
    struck: 490,
    recharge: 8000,
    throwDuration: 1000,
    rate: 600,
    ranged: true,
  }),
  SHIELD: tool({ damage: 1, attackDelay: 300, attackIdle: 300, struck: 430, recharge: 2000, rate: 600 }),
  SHOVEL: tool({ damage: 6, attackDelay: 300, attackIdle: 330, struck: 480, recharge: 3000, itemRecharge: 3000, rate: 600 }),
  SPRING: tool({ damage: 5, attackDelay: 525, attackIdle: 525, struck: 1900, recharge: 2750, rate: 720 }),
  SPY: tool({ damage: 4, attackDelay: 325, attackIdle: 325, struck: 430, recharge: 2500, itemRecharge: 5000, rate: 500 }),
  SWORD: tool({ damage: 10, attackDelay: 300, attackIdle: 300, struck: 430, recharge: 4000, rate: 600 }),
  TIMEBOMB: tool({ damage: 0, attackDelay: 700, attackIdle: 700, struck: 430, recharge: 8000, rate: 600 }),
  TOOB: tool({ damage: 2, attackDelay: 340, attackIdle: 340, struck: 430, recharge: 2250, rate: 600, water: true }),
  TOOBWATER: tool({ damage: 2, attackDelay: 340, attackIdle: 340, struck: 430, recharge: 2250, rate: 1000, water: true }),
  WAND: tool({ damage: 0, attackDelay: 500, attackIdle: 500, struck: 430, recharge: 2000, itemRecharge: 15000, rate: 600 }),
  WARPSTONE: tool({ damage: 0, attackDelay: 0, attackIdle: 0, struck: 430, recharge: 2000, rate: 800 }),
  WELDER: tool({
    damage: 20,
    range: 4,
    attackDelay: 250,
    attackIdle: 250,
    struck: 430,
    recharge: 15000,
    throwDuration: 1500,
    rate: 600,
    ranged: true,
  }),
  WINGZ: tool({
    damage: 2,
    range: 5,
    attackDelay: 450,
    attackIdle: 450,
    struck: 430,
    recharge: 5000,
    throwDuration: 500,
    rate: 600,
    ranged: true,
    water: true,
  }),
};

/** Tools that can't be used for a melee attack. */
export const NO_MELEE_TOOLS: ReadonlySet<CombatTool> = new Set(['WARPSTONE', 'BOMB', 'TIMEBOMB', 'WAND']);

/** Rough strength ranking used by AI (SmartChaser, bots) to pick fights and tools. */
export function toolValue(tool: CombatTool): number {
  const info = TOOL_INFO[tool];
  const dps = info.recharge > 0 ? (info.damage * 1000) / info.recharge : info.damage;
  return dps + (info.ranged ? 1.5 : 0);
}

// --- toys -------------------------------------------------------------------------

export const TOYS = [
  'BABYWALKER',
  'BEACHBALL',
  'BIGWHEEL',
  'GOKART',
  'JACKINTHEBOX',
  'JUMPROPE',
  'POGOSTICK',
  'SCROLL',
  'SQUEAKTOY',
  'YOYO',
] as const;
export type ToyId = (typeof TOYS)[number];

export interface ToyInfo {
  /** Play duration (ms). */
  duration: number;
  /** Duration of the "toy breaks" animation (ms). */
  breakDuration: number;
  /** Riding toys move the grunt around randomly: ms per tile and tiles per straight run. */
  rate?: number;
  tiles?: number;
}

export const TOY_INFO: Record<ToyId, ToyInfo> = {
  BABYWALKER: { duration: 5000, breakDuration: 2080, rate: 1200, tiles: 1 },
  BEACHBALL: { duration: 25000, breakDuration: 2080 },
  BIGWHEEL: { duration: 15000, breakDuration: 2080, rate: 600, tiles: 3 },
  GOKART: { duration: 20000, breakDuration: 2080, rate: 600, tiles: 4 },
  JACKINTHEBOX: { duration: 20000, breakDuration: 2080 },
  JUMPROPE: { duration: 15000, breakDuration: 2080 },
  POGOSTICK: { duration: 10000, breakDuration: 2080, rate: 600, tiles: 2 },
  SCROLL: { duration: 4200, breakDuration: 1700 },
  SQUEAKTOY: { duration: 10000, breakDuration: 2080 },
  YOYO: { duration: 5000, breakDuration: 2080 },
};

/** Spells cast by scrolls (toys) and wands (tools). */
export const SPELLS = ['FREEZE', 'HEALTH', 'RESURRECT', 'TOYZ', 'TELEPORT', 'ROLLINGBALLZ'] as const;
export type SpellId = (typeof SPELLS)[number];
export const SPELL_RADIUS = 4; // 9x9 area

// --- powerups, utilities, curses, rewards ----------------------------------------------

export const POWERUPS = [
  'GHOST',
  'SUPERSPEED',
  'INVULNERABILITY',
  'CONVERSION',
  'DEATHTOUCH',
  'ROIDZ',
  'REACTIVEARMOR',
] as const;
export type PowerupId = (typeof POWERUPS)[number];
export const POWERUP_DURATION_MS = 30000;

export const UTILITIES = ['MEGAPHONE', 'HEALTH1', 'HEALTH2', 'HEALTH3', 'STOPWATCH', 'TOYBOX'] as const;
export type UtilityId = (typeof UTILITIES)[number];

export const HEALTH_GAIN: Record<'HEALTH1' | 'HEALTH2' | 'HEALTH3', number> = {
  HEALTH1: 5, // can of Zap Cola
  HEALTH2: 10, // 2 liter bottle
  HEALTH3: 20, // keg
};

export const CURSES = ['BLACKSCREEN', 'MINICAM', 'RANDOMCOLORZ', 'SCREENSHAKE'] as const;
export type CurseId = (typeof CURSES)[number];

export const REWARDS = ['COIN', 'SECRET_W', 'SECRET_A', 'SECRET_R', 'SECRET_P'] as const;
export type RewardId = (typeof REWARDS)[number];

export type ItemId = ToolId | ToyId | PowerupId | UtilityId | CurseId | RewardId;
export type ItemType = 'tool' | 'toy' | 'powerup' | 'utility' | 'curse' | 'reward';

const typeOf = new Map<string, ItemType>();
for (const t of TOOLS) typeOf.set(t, 'tool');
for (const t of TOYS) typeOf.set(t, 'toy');
for (const t of POWERUPS) typeOf.set(t, 'powerup');
for (const t of UTILITIES) typeOf.set(t, 'utility');
for (const t of CURSES) typeOf.set(t, 'curse');
for (const t of REWARDS) typeOf.set(t, 'reward');

export function itemType(item: ItemId): ItemType {
  const type = typeOf.get(item);
  if (!type) throw new Error(`Unknown item: ${item}`);
  return type;
}

export function isItem(value: string): value is ItemId {
  return typeOf.has(value);
}

export const BRICK_COLORS = ['brown', 'gold', 'red', 'blue', 'black'] as const;
export type BrickColor = (typeof BRICK_COLORS)[number];
export const MAX_BRICK_LAYERS = 3;
