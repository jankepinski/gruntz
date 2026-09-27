import type { BrickColor, CombatTool, CurseId, ItemId, PowerupId, SpellId, ToyId } from '../data/items.ts';
import type { Dir, Point } from '../point.ts';

export type EntityId = number;

/** Behaviours of enemy (quest) gruntz, see the original's colour-coded AI. */
export type AiType =
  | 'Chaser'
  | 'PostGuard'
  | 'SmartChaser'
  | 'HitAndRun'
  | 'Defender'
  | 'ObjectGuard'
  | 'ToolThief'
  | 'Toyer'
  | 'Bomber'
  | 'TimeBomber'
  | 'BrickLayer'
  | 'Digger'
  | 'RockBreaker'
  | 'GooSucker';

export const AI_TYPES: readonly AiType[] = [
  'Chaser',
  'PostGuard',
  'SmartChaser',
  'HitAndRun',
  'Defender',
  'ObjectGuard',
  'ToolThief',
  'Toyer',
  'Bomber',
  'TimeBomber',
  'BrickLayer',
  'Digger',
  'RockBreaker',
  'GooSucker',
];

export type DeathKind =
  | 'EXPLODE'
  | 'SINK'
  | 'BURN'
  | 'FALL'
  | 'MELT'
  | 'SQUASH'
  | 'ELECTROCUTE'
  | 'SHATTER'
  | 'KARAOKE'
  | 'HOLE'
  | 'GOO';

export type ActionKind =
  | 'idle'
  | 'move'
  | 'attack'
  | 'attackIdle'
  | 'tool'
  | 'throw'
  | 'struck'
  | 'play'
  | 'death'
  | 'win'
  | 'pickup'
  | 'enter'
  | 'swim'
  | 'jump';

/**
 * What a grunt is doing right now. Replaced as a whole on every change (never mutated),
 * which keeps replication simple: a changed action is one field in a delta.
 */
export interface Action {
  kind: ActionKind;
  /** Tick the action started. */
  start: number;
  /** Tick the action is expected to end (for rendering/interpolation). */
  end: number;
  /** Move: tile we are coming from. */
  fromX?: number;
  fromY?: number;
  /** Target tile of a move / tool use / throw. */
  tx?: number;
  ty?: number;
  run?: boolean;
  variant?: number;
  /** Tool / toy / death kind / picked up item, depending on the action. */
  item?: string;
  /** Riding toy / knockback movement. */
  moving?: boolean;
}

export interface WalkTask {
  kind: 'walk';
  tx: number;
  ty: number;
  enemy?: EntityId;
  useTool: boolean;
  useToy: boolean;
  /** Avoid hazards while pathing (AI gruntz, bots, or the player's "safe pathfinding"). */
  safe: boolean;
  /** Ticks spent waiting for a blocked tile. */
  blocked: number;
}

export interface FollowTask {
  kind: 'follow';
  enemy: EntityId;
}

export interface FleeTask {
  kind: 'flee';
  enemy: EntityId;
}

export type GruntTask = WalkTask | FollowTask | FleeTask;

/** A queued (shift) order. */
export type Order =
  | { type: 'move'; x: number; y: number; safe?: boolean }
  | { type: 'attack'; target: EntityId }
  | { type: 'useTool'; x: number; y: number; target?: EntityId }
  | { type: 'useToy'; x: number; y: number; target?: EntityId };

export interface BaseEntity {
  id: EntityId;
  kind: string;
  x: number;
  y: number;
}

export interface Grunt extends BaseEntity {
  kind: 'grunt';
  team: number;
  facing: Dir;
  health: number;
  /** Stamina recharges linearly between these ticks; full when tick >= staminaEnd. */
  staminaStart: number;
  staminaEnd: number;
  tool: CombatTool | null;
  toy: ToyId | null;
  /** Spell carried by a scroll toy or a wand tool. */
  spell: SpellId | null;
  brickColor: BrickColor | null;
  powerup: PowerupId | null;
  powerupEnd: number;
  /** Remaining wingz flight (0..20, 500 ms per unit while airborne). */
  flight: number;
  flying: boolean;
  /** Tick when the current toy play ends (when playing). */
  toyEnd: number;
  action: Action;
  task: GruntTask | null;
  orders: Order[];
  ai: AiType | null;
  alert: number;
  guardX: number;
  guardY: number;
  /** Frozen by a freeze spell: can't act, shatters when hit. */
  frozen: boolean;
}

export interface Pickup extends BaseEntity {
  kind: 'pickup';
  item: ItemId;
  /** Toybox: which toy is inside and whose it is. */
  toy?: ToyId;
  team?: number;
  spell?: SpellId;
  /** Buried under a rock/mound: invisible until revealed. */
  hidden?: boolean;
  /** Battlez respawn delay in ticks (0 = never). */
  respawn?: number;
  /** Tick when a respawning pickup is available again. */
  availableAt?: number;
  /** Item granted by a megaphone pickup. */
  megaphoneItem?: ItemId;
}

export interface Puddle extends BaseEntity {
  kind: 'puddle';
  team: number;
  /** Being sucked up since tick (or -1). */
  sucking: number;
}

export type ProjectileType = 'ROCK' | 'GUNHAT' | 'NERFGUN' | 'WELDER' | 'BOOMERANG' | 'WINGZ';

export interface Projectile extends BaseEntity {
  kind: 'projectile';
  type: ProjectileType;
  owner: EntityId;
  team: number;
  fromX: number;
  fromY: number;
  tx: number;
  ty: number;
  start: number;
  end: number;
  damage: number;
  /** Gruntz already hit (piercing projectiles). */
  hit: EntityId[];
  state: 'fly' | 'impact';
}

export interface TimeBomb extends BaseEntity {
  kind: 'timebomb';
  start: number;
  fastAt: number;
  end: number;
}

export interface TeamState extends BaseEntity {
  kind: 'team';
  index: number;
  name: string;
  /** Goo well (quest: puddles sucked; battle: fills over time). */
  goo: number;
  /** Oven states: -1 empty, otherwise tick when the grunt is fully baked. */
  ovens: number[];
  /** Resource slots given by the grunt machine (tools/toys/bricks). */
  slots: (ItemId | BrickColor | null)[];
  megaphoneItems: ItemId[];
  megaphoneIndex: number;
  warpstones: number;
  curse: CurseId | null;
  curseEnd: number;
  won: boolean;
  lost: boolean;
  stats: TeamStats;
}

export interface TeamStats {
  coins: number;
  secrets: number;
  letters: string;
  toolz: number;
  toyz: number;
  powerupz: number;
  deaths: number;
  kills: number;
}

export interface Brickz extends BaseEntity {
  kind: 'brickz';
  /** Bottom-to-top layers. */
  layers: BrickColor[];
  /** Team that built the stack (can see its colours). -1 = level brickz. */
  team: number;
  /** Teams that have spied the colours. */
  revealed: number[];
}

export interface SwitchEntity extends BaseEntity {
  kind: 'switch';
  /** Tiles toggled by this switch. */
  targets: Point[];
  /** Ticks before targets toggle / how long timed targets stay toggled. */
  delay: number;
  duration: number;
  /** Purple (many) switches: all switches of the same group must be pressed. */
  group: number;
  /** Orange switches: partner switches that pop up when this one goes down. */
  partners: Point[];
  /** Checkpoint switches may require a grunt holding this item. */
  requires?: ItemId;
  disabled: boolean;
}

export interface Fort extends BaseEntity {
  kind: 'fort';
  team: number;
  captured: boolean;
}

export interface CreationPad extends BaseEntity {
  kind: 'pad';
  team: number;
}

export interface Wormhole extends BaseEntity {
  kind: 'wormhole';
  color: 'green' | 'blue' | 'red';
  tx: number;
  ty: number;
  open: boolean;
  closesAt: number;
}

export interface RollingBall extends BaseEntity {
  kind: 'ball';
  dir: Dir;
  /** Ticks per tile. */
  rate: number;
  fromX: number;
  fromY: number;
  /** Tick the current step started. */
  start: number;
  /** Tick the ball breaks on its own (spell balls), 0 = never. */
  expires: number;
  /** Ball launchers: a new ball starts from the origin this many ticks after one breaks. */
  every?: number;
  originX?: number;
  originY?: number;
  state: 'roll' | 'break' | 'fall';
}

/** 3x3 boulder: gauntletz or explosions break the whole thing at once. */
export interface GiantRock extends BaseEntity {
  kind: 'giantrock';
  /** Tiles underneath, row by row from the top-left corner (hidden from clients). */
  under: number[];
}

/** Lava geyser / candle / trapdoor / electric outlet: kills whoever is on it while it goes off. */
export interface StaticHazard extends BaseEntity {
  kind: 'hazard';
  /** Idle ticks between two emissions. */
  period: number;
  active: boolean;
  /** Tick the current state started. */
  since: number;
}

/** A bird or plane crossing the map along a lane, dropping things on gruntz below. */
export interface Dropper extends BaseEntity {
  kind: 'dropper';
  /** Flying direction (0 north, 2 east, 4 south, 6 west). */
  dir: Dir;
  /** Column (north/south) or row (east/west) it flies over. */
  lane: number;
  /** Ticks per tile. */
  rate: number;
  start: number;
  cooldownUntil: number;
}

/** Something dropped by a bird: it lands 2 s later and squashes whoever is still there. */
export interface Poop extends BaseEntity {
  kind: 'poop';
  /** Exact landing spot (tile units, may be between tiles). */
  px: number;
  py: number;
  dropped: number;
  hit: boolean;
}

interface PathFields {
  points: Point[];
  /** Index of the point the current leg starts from. */
  index: number;
  /** Ticks per tile. */
  rate: number;
  /** Ticks spent at each point. */
  pause: number;
  /** Tick the current leg started. */
  start: number;
}

/** Storm cloud: floats along a path and zaps gruntz under it. */
export interface Cloud extends BaseEntity, PathFields {
  kind: 'cloud';
}

/** UFO: floats along a path; its two rotating beams melt gruntz. */
export interface Ufo extends BaseEntity, PathFields {
  kind: 'ufo';
  /** Ticks per half turn of the beams. */
  spin: number;
  spinStart: number;
  clockwise: boolean;
}

/** "Star search" spotlight circling around a point: whoever it finds has to sing. */
export interface SpotLight extends BaseEntity {
  kind: 'spotlight';
  radius: number;
  /** Ticks per half turn. */
  rate: number;
  clockwise: boolean;
  start: number;
  /** Tick it stopped on a singer (0 = moving). */
  pausedAt: number;
}

/** Kitchen slime creeping around a rectangle. */
export interface Slime extends BaseEntity {
  kind: 'slime';
  fromX: number;
  fromY: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  clockwise: boolean;
  /** Ticks per tile. */
  rate: number;
  start: number;
}

/** Help book: stepping on it shows its text to the player (tutorials). */
export interface HelpBook extends BaseEntity {
  kind: 'help';
  en: string;
  pl: string;
}

/** Invisible trigger that opens a (red, secret) wormhole for a while. */
export interface SecretTrigger extends BaseEntity {
  kind: 'trigger';
  wx: number;
  wy: number;
  duration: number;
  used: boolean;
}

export interface CheckpointFlag extends BaseEntity {
  kind: 'flag';
  raised: boolean;
}

export type Entity =
  | Grunt
  | Pickup
  | Puddle
  | Projectile
  | TimeBomb
  | TeamState
  | Brickz
  | SwitchEntity
  | Fort
  | CreationPad
  | Wormhole
  | RollingBall
  | GiantRock
  | StaticHazard
  | Dropper
  | Poop
  | Cloud
  | Ufo
  | SpotLight
  | Slime
  | HelpBook
  | SecretTrigger
  | CheckpointFlag;

export type EntityKind = Entity['kind'];
export type EntityOf<K extends EntityKind> = Extract<Entity, { kind: K }>;

/** Transient visual/audio events (not state). */
export interface Fx {
  type: string;
  x: number;
  y: number;
  id?: EntityId;
  data?: string | number;
}
