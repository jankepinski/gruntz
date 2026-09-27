import { msToTicks, NEUTRAL_TEAM } from '../constants.ts';
import type { BrickColor, CombatTool, ItemId, SpellId, ToyId } from '../data/items.ts';
import { T, tileDef, tileId } from '../data/tiles.ts';
import type { Dir } from '../point.ts';
import { spawnGrunt } from '../sim/grunt.ts';
import { spawnRollingBall } from '../sim/hazards.ts';
import {
  spawnCloud,
  spawnDropper,
  spawnSlime,
  spawnSpotLight,
  spawnStaticHazard,
  spawnUfo,
} from '../sim/worldHazards.ts';
import type {
  AiType,
  Brickz,
  CheckpointFlag,
  CreationPad,
  Fort,
  GiantRock,
  HelpBook,
  Pickup,
  SecretTrigger,
  Puddle,
  SwitchEntity,
  TeamState,
  Wormhole,
} from '../sim/types.ts';
import { World, type GameMode, type ThemeId } from '../sim/world.ts';

export interface LocalizedText {
  en: string;
  pl: string;
}

export type LevelObject =
  | {
      type: 'grunt';
      x: number;
      y: number;
      /** Player slot index (0-3), or omitted for enemy AI gruntz in quests. */
      team?: number;
      tool?: CombatTool;
      toy?: ToyId;
      ai?: AiType;
      alert?: number;
      facing?: Dir;
    }
  | { type: 'pickup'; x: number; y: number; item: ItemId; hidden?: boolean; spell?: SpellId; respawn?: number }
  | {
      type: 'switch';
      x: number;
      y: number;
      targets: [number, number][];
      delay?: number;
      duration?: number;
      group?: number;
      partners?: [number, number][];
      requires?: ItemId;
    }
  | { type: 'fort'; x: number; y: number; team?: number }
  | { type: 'pad'; x: number; y: number; team?: number }
  | { type: 'wormhole'; x: number; y: number; color: Wormhole['color']; tx: number; ty: number; open?: boolean }
  | { type: 'brickz'; x: number; y: number; layers: BrickColor[] }
  | { type: 'puddle'; x: number; y: number }
  | { type: 'flag'; x: number; y: number }
  | { type: 'ball'; x: number; y: number; dir: Dir; rate?: number; every?: number }
  | { type: 'giantRock'; x: number; y: number }
  /** Lava geyser / candle / trapdoor / outlet (which one depends on the world). */
  | { type: 'hazard'; x: number; y: number; delay?: number; period?: number }
  /** Bird or plane crossing the map; `lane` is the column (north/south) or row (east/west). */
  | { type: 'dropper'; x: number; y: number; dir: Dir; rate?: number; offset?: number }
  | { type: 'cloud'; x: number; y: number; points: [number, number][]; rate?: number; pause?: number }
  | {
      type: 'ufo';
      x: number;
      y: number;
      points: [number, number][];
      rate?: number;
      pause?: number;
      spin?: number;
      clockwise?: boolean;
    }
  | { type: 'spotlight'; x: number; y: number; radius: number; rate?: number; clockwise?: boolean }
  | { type: 'slime'; x: number; y: number; x1: number; y1: number; clockwise?: boolean; rate?: number }
  | { type: 'help'; x: number; y: number; text: LocalizedText }
  | { type: 'secret'; x: number; y: number; wx: number; wy: number; duration?: number };

export interface LevelData {
  id: string;
  name: LocalizedText;
  mode: GameMode;
  theme: ThemeId;
  /** Maximum number of players (battle) — quests are single player. */
  players?: number;
  /** Character -> tile name. Defaults to DEFAULT_LEGEND. */
  legend?: Record<string, string>;
  /** One string per row, one character per tile. */
  tiles: string[];
  /**
   * Height levels, one digit per tile ('0' ground ... MAX_LEVEL). Omitted for flat maps.
   * Walkable tiles of different levels only connect through stairz (RAMP tiles).
   */
  heights?: string[];
  objects: LevelObject[];
  /** Quest: items the grunt machine hands out, in megaphone order. */
  megaphone?: ItemId[];
  /** Number of grunt ovens per team. */
  ovens?: number;
  /** Battle: resource pool. */
  resources?: ItemId[];
  /** Toggle bridges: how long they stay up / down (ms). */
  autoToggleMs?: number;
  /** Quest: order within the campaign and which world it belongs to. */
  world?: number;
  index?: number;
  /** Quest: a world's secret level, unlocked by finding all the W-A-R-P letters in it. */
  secret?: boolean;
}

export const DEFAULT_LEGEND: Record<string, string> = {
  '.': 'GROUND',
  ',': 'GROUND_ALT',
  '#': 'CLIFF',
  x: 'NOGO',
  M: 'METAL',
  '~': 'WATER',
  _: 'DEATH',
  o: 'HOLE',
  m: 'MOUND',
  '^': 'SPIKES',
  R: 'ROCK',
  r: 'ROCK_ALT',
  p: 'PAD',
  B: 'BRICKZ',
  c: 'CRUMBLE',
  '=': 'BRIDGE',
  '-': 'BRIDGE_LO',
  n: 'ARROW_N',
  e: 'ARROW_E',
  s: 'ARROW_S',
  w: 'ARROW_W',
  g: 'SWITCH_G',
  G: 'PYRAMID_GREEN',
  h: 'PYRAMID_GREEN_LO',
};

export interface TeamSetup {
  /** Team index (0-3). */
  team: number;
  name: string;
  alliance?: number;
}

export interface WorldSetup {
  seed: number;
  teams: TeamSetup[];
}

export function parseTiles(level: Pick<LevelData, 'tiles' | 'legend'>): {
  width: number;
  height: number;
  tiles: number[];
} {
  const legend = { ...DEFAULT_LEGEND, ...level.legend };
  const height = level.tiles.length;
  const width = Math.max(...level.tiles.map(r => r.length));
  const tiles: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = level.tiles[y]!;
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '#';
      const name = legend[ch];
      if (!name) throw new Error(`Unknown tile char '${ch}' at ${x},${y}`);
      tiles.push(tileId(name));
    }
  }
  return { width, height, tiles };
}

/** Highest height level a map may use. */
export const MAX_LEVEL = 3;

/** Height level per tile (all zero when the level has no height rows). */
export function parseHeights(level: Pick<LevelData, 'heights'>, width: number, height: number): number[] {
  const out = new Array<number>(width * height).fill(0);
  if (!level.heights) return out;
  for (let y = 0; y < height; y++) {
    const row = level.heights[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '0';
      const v = ch.charCodeAt(0) - 48;
      if (!(v >= 0 && v <= MAX_LEVEL)) throw new Error(`Bad height '${ch}' at ${x},${y}`);
      out[y * width + x] = v;
    }
  }
  return out;
}

/** Height rows for a level (undefined when everything is on the ground). */
export function heightRows(heights: readonly number[], width: number, height: number): string[] | undefined {
  if (!heights.some(h => h > 0)) return undefined;
  const rows: string[] = [];
  for (let y = 0; y < height; y++) rows.push(heights.slice(y * width, (y + 1) * width).join(''));
  return rows;
}

function emptyStats(): TeamState['stats'] {
  return { coins: 0, secrets: 0, letters: '', toolz: 0, toyz: 0, powerupz: 0, deaths: 0, kills: 0 };
}

/** A path starts where the object stands, then visits its points (and loops back). */
function pathPoints(o: { x: number; y: number; points: [number, number][] }): { x: number; y: number }[] {
  return [{ x: o.x, y: o.y }, ...o.points.map(([x, y]) => ({ x, y }))];
}

/** Build the initial world for a level. */
export function createWorld(level: LevelData, setup: WorldSetup): World {
  const { width, height, tiles } = parseTiles(level);
  const heights = parseHeights(level, width, height);
  const w = new World(width, height, tiles, level.theme, level.mode, setup.seed, heights);
  const alliances = [0, 1, 2, 3, 4];
  const ovenCount = level.ovens ?? (level.mode === 'battle' ? 3 : 3);

  const teams = level.mode === 'quest' ? [{ team: 0, name: setup.teams[0]?.name ?? 'Player' }] : setup.teams;
  for (const t of teams) {
    alliances[t.team] = t.alliance ?? t.team;
    w.spawn<TeamState>({
      kind: 'team',
      x: -1,
      y: -1,
      index: t.team,
      name: t.name,
      goo: 0,
      ovens: new Array(ovenCount).fill(-1),
      slots: [],
      megaphoneItems: level.mode === 'quest' ? (level.megaphone ?? []) : [],
      megaphoneIndex: 0,
      warpstones: 0,
      curse: null,
      curseEnd: 0,
      won: false,
      lost: false,
      stats: emptyStats(),
    });
  }
  if (level.mode === 'quest') alliances[NEUTRAL_TEAM] = 1;
  w.alliances = alliances;
  const activeTeams = new Set(teams.map(t => t.team));

  for (const o of level.objects) {
    switch (o.type) {
      case 'grunt': {
        const team = level.mode === 'quest' ? (o.ai ? NEUTRAL_TEAM : 0) : (o.team ?? 0);
        if (level.mode === 'battle' && !activeTeams.has(team)) break;
        const spawn: Parameters<typeof spawnGrunt>[1] = { team, x: o.x, y: o.y };
        if (o.tool) spawn.tool = o.tool;
        if (o.toy) spawn.toy = o.toy;
        if (o.ai) spawn.ai = o.ai;
        if (o.alert !== undefined) spawn.alert = o.alert;
        if (o.facing !== undefined) spawn.facing = o.facing;
        spawnGrunt(w, spawn);
        break;
      }
      case 'pickup': {
        const p: Omit<Pickup, 'id'> = { kind: 'pickup', x: o.x, y: o.y, item: o.item };
        if (o.hidden) p.hidden = true;
        if (o.spell) p.spell = o.spell;
        if (o.respawn) p.respawn = o.respawn;
        w.spawn<Pickup>(p);
        break;
      }
      case 'switch': {
        const s: Omit<SwitchEntity, 'id'> = {
          kind: 'switch',
          x: o.x,
          y: o.y,
          targets: o.targets.map(([x, y]) => ({ x, y })),
          delay: o.delay ?? 0,
          duration: o.duration ?? 0,
          group: o.group ?? 0,
          partners: (o.partners ?? []).map(([x, y]) => ({ x, y })),
          disabled: false,
        };
        if (o.requires) s.requires = o.requires;
        const sw = w.spawn<SwitchEntity>(s);
        // Orange switches that start pressed are disabled until a partner re-enables them.
        const name = w.tileAt(o.x, o.y);
        if (name === tileId('SWITCH_ORANGE_LO')) w.edit(sw, { disabled: true });
        break;
      }
      case 'fort': {
        const team = level.mode === 'quest' ? 0 : (o.team ?? 0);
        if (level.mode === 'battle' && !activeTeams.has(team)) break;
        w.spawn<Fort>({ kind: 'fort', x: o.x, y: o.y, team, captured: false });
        break;
      }
      case 'pad': {
        const team = level.mode === 'quest' ? 0 : (o.team ?? 0);
        if (level.mode === 'battle' && !activeTeams.has(team)) break;
        w.spawn<CreationPad>({ kind: 'pad', x: o.x, y: o.y, team });
        break;
      }
      case 'wormhole':
        w.spawn<Wormhole>({
          kind: 'wormhole',
          x: o.x,
          y: o.y,
          color: o.color,
          tx: o.tx,
          ty: o.ty,
          open: o.open ?? o.color !== 'red',
          closesAt: 0,
        });
        break;
      case 'brickz':
        w.spawn<Brickz>({ kind: 'brickz', x: o.x, y: o.y, layers: o.layers.slice(), team: -1, revealed: [] });
        w.setTile(o.x, o.y, tileId('BRICKZ'));
        break;
      case 'puddle':
        w.spawn<Puddle>({ kind: 'puddle', x: o.x, y: o.y, team: NEUTRAL_TEAM, sucking: -1 });
        break;
      case 'flag':
        w.spawn<CheckpointFlag>({ kind: 'flag', x: o.x, y: o.y, raised: false });
        break;
      case 'ball':
        spawnRollingBall(w, o.x, o.y, o.dir, o.rate ?? 12, 0, o.every ?? 0);
        break;
      case 'hazard':
        spawnStaticHazard(w, o.x, o.y, o.delay ?? 0, o.period ?? 2000);
        break;
      case 'dropper':
        // The lane is the column for north/south flights and the row for east/west ones.
        spawnDropper(w, o.dir, o.dir === 0 || o.dir === 4 ? o.x : o.y, o.rate ?? 600, o.offset ?? 0);
        break;
      case 'cloud':
        spawnCloud(w, pathPoints(o), o.rate ?? 800, o.pause ?? 0);
        break;
      case 'ufo':
        spawnUfo(w, pathPoints(o), o.rate ?? 800, o.pause ?? 0, o.spin ?? 1200, o.clockwise ?? true);
        break;
      case 'spotlight':
        spawnSpotLight(w, o.x, o.y, o.radius, o.rate ?? 3000, o.clockwise ?? true);
        break;
      case 'slime':
        spawnSlime(w, o.x, o.y, o.x1, o.y1, o.clockwise ?? true, o.rate ?? 1000);
        break;
      case 'giantRock': {
        const under: number[] = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            under.push(w.inBounds(o.x + dx, o.y + dy) ? w.tileAt(o.x + dx, o.y + dy) : tileId('GROUND'));
            if (w.inBounds(o.x + dx, o.y + dy)) w.setTile(o.x + dx, o.y + dy, tileId('GIANT_ROCK'));
          }
        }
        w.spawn<GiantRock>({ kind: 'giantrock', x: o.x, y: o.y, under });
        break;
      }
      case 'help':
        w.spawn<HelpBook>({ kind: 'help', x: o.x, y: o.y, en: o.text.en, pl: o.text.pl });
        break;
      case 'secret':
        w.spawn<SecretTrigger>({
          kind: 'trigger',
          x: o.x,
          y: o.y,
          wx: o.wx,
          wy: o.wy,
          duration: msToTicks(o.duration ?? 8000),
          used: false,
        });
        break;
    }
  }
  // Toggle bridges go up and down on their own.
  if (w.tiles.some(t => tileDef(t).traits & T.AUTO)) {
    w.schedule(
      msToTicks(level.autoToggleMs ?? 3000),
      'autoToggle',
      0,
      'autoToggle',
      msToTicks(level.autoToggleMs ?? 3000),
    );
  }
  w.takeChanges();
  return w;
}
