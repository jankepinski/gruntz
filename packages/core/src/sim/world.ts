import { T, tileDef, toggledTile } from '../data/tiles.ts';
import type { Point } from '../point.ts';
import { nextRandom } from '../rng.ts';
import type {
  DeathKind,
  Entity,
  EntityId,
  EntityKind,
  EntityOf,
  Fort,
  Fx,
  Grunt,
  RollingBall,
  TeamState,
} from './types.ts';

export type GameMode = 'quest' | 'battle';

/** World theme. Each has its own terrain kit and its own way of dying in the abyss. */
export type ThemeId = 'training' | 'rocky' | 'ice' | 'tropics' | 'sweetz' | 'rollerz' | 'shrunk' | 'minis' | 'space';

export const THEME_DEATH: Record<ThemeId, DeathKind> = {
  training: 'SINK',
  rocky: 'SINK',
  ice: 'SINK',
  tropics: 'BURN',
  sweetz: 'FALL',
  rollerz: 'FALL',
  shrunk: 'MELT',
  minis: 'SINK',
  space: 'FALL',
};

/** A scheduled piece of work. Plain data so the whole world can be serialized/hashed. */
export interface Task {
  at: number;
  seq: number;
  name: string;
  id: EntityId;
  key?: string;
  args: unknown[];
}

export type TaskHandler = (w: World, id: EntityId, ...args: any[]) => void;
const HANDLERS = new Map<string, TaskHandler>();

export function registerTask(name: string, handler: TaskHandler): void {
  if (HANDLERS.has(name)) throw new Error(`Task already registered: ${name}`);
  HANDLERS.set(name, handler);
}

export interface Changes {
  spawned: Set<EntityId>;
  removed: Set<EntityId>;
  dirty: Map<EntityId, Set<string>>;
  tiles: Map<number, number>;
  fx: Fx[];
}

function emptyChanges(): Changes {
  return { spawned: new Set(), removed: new Set(), dirty: new Map(), tiles: new Map(), fx: [] };
}

/** Game-mode rules (win/lose, economy). Runtime only, installed by the session. */
export interface Rules {
  onGruntDied?(w: World, team: number): void;
  onFortEntered?(w: World, fort: Fort, grunt: Grunt): boolean;
  onBallBroken?(w: World, ball: RollingBall): void;
  onTick?(w: World): void;
}

export interface WorldSnapshot {
  tick: number;
  rng: number;
  nextId: number;
  taskSeq: number;
  width: number;
  height: number;
  theme: ThemeId;
  mode: GameMode;
  tiles: number[];
  alliances: number[];
  entities: Entity[];
  tasks: Task[];
}

/** Entity fields whose legitimate value can be null (a null in a patch means "delete" otherwise). */
const NULLABLE_FIELDS: Record<string, true> = {
  tool: true,
  toy: true,
  spell: true,
  brickColor: true,
  powerup: true,
  task: true,
  ai: true,
  curse: true,
};

/** Kinds that live on a tile and are found through the tile index. */
const TILE_OBJECT_KINDS: ReadonlySet<EntityKind> = new Set([
  'pickup',
  'puddle',
  'switch',
  'pad',
  'wormhole',
  'brickz',
  'timebomb',
  'flag',
  'help',
  'trigger',
]);

export class World {
  tick = 0;
  rng = 1;
  nextId = 1;
  taskSeq = 0;
  width: number;
  height: number;
  theme: ThemeId;
  mode: GameMode;
  tiles: number[];
  /** Team index -> alliance. Gruntz of the same alliance never fight. */
  alliances: number[] = [0, 1, 2, 3, 4];
  rules: Rules = {};

  readonly entities = new Map<EntityId, Entity>();
  private teamIds = new Map<number, EntityId>();
  /** Tile index -> grunt that currently claims the tile. */
  readonly occupancy = new Map<number, EntityId>();
  /** Tile index -> non-grunt entities located on / reacting to that tile. */
  readonly objects = new Map<number, EntityId[]>();
  /** Increments whenever walkability may have changed (tile toggles). */
  mapVersion = 0;

  changes: Changes = emptyChanges();

  private heap: Task[] = [];
  /** `${id}:${key}` -> seq of the live keyed task. */
  private keyed = new Map<string, number>();
  private cancelled = new Set<number>();

  constructor(width: number, height: number, tiles: number[], theme: ThemeId, mode: GameMode, seed = 1) {
    if (tiles.length !== width * height) throw new Error('Tile array size mismatch');
    this.width = width;
    this.height = height;
    this.tiles = tiles.slice();
    this.theme = theme;
    this.mode = mode;
    this.rng = seed >>> 0 || 1;
  }

  // --- tiles --------------------------------------------------------------------

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  tileAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.tiles[y * this.width + x]!;
  }

  /** Traits of a tile; out of bounds counts as a solid wall. */
  traits(x: number, y: number): number {
    const tile = this.tileAt(x, y);
    if (tile < 0) return T.SOLID | T.NOGO;
    return tileDef(tile).traits;
  }

  has(x: number, y: number, trait: number): boolean {
    return (this.traits(x, y) & trait) !== 0;
  }

  setTile(x: number, y: number, tile: number): void {
    const i = this.index(x, y);
    if (this.tiles[i] === tile) return;
    this.tiles[i] = tile;
    this.changes.tiles.set(i, tile);
    this.mapVersion++;
  }

  toggleTile(x: number, y: number): void {
    const tile = this.tileAt(x, y);
    if (tile < 0) return;
    this.setTile(x, y, toggledTile(tile));
  }

  // --- entities -----------------------------------------------------------------

  get<K extends EntityKind>(id: EntityId | undefined | null, kind: K): EntityOf<K> | undefined {
    if (id == null) return undefined;
    const e = this.entities.get(id);
    return e && e.kind === kind ? (e as EntityOf<K>) : undefined;
  }

  spawn<E extends Entity>(data: Omit<E, 'id'>): E {
    const entity = { ...data, id: this.nextId++ } as E;
    this.entities.set(entity.id, entity);
    this.indexEntity(entity);
    this.changes.spawned.add(entity.id);
    return entity;
  }

  destroy(entity: Entity): void {
    if (!this.entities.has(entity.id)) return;
    this.unindexEntity(entity);
    this.entities.delete(entity.id);
    this.cancelAll(entity.id);
    if (this.changes.spawned.has(entity.id)) {
      this.changes.spawned.delete(entity.id);
    } else {
      this.changes.removed.add(entity.id);
    }
    this.changes.dirty.delete(entity.id);
  }

  /**
   * The only way to mutate an entity. Records which fields changed so the session
   * can replicate them.
   */
  edit<E extends Entity>(entity: E, patch: Partial<E>): void {
    let dirty = this.changes.dirty.get(entity.id);
    const record = entity as unknown as Record<string, unknown>;
    const movesTile = 'x' in patch || 'y' in patch;
    if (movesTile && entity.kind !== 'grunt') this.unindexEntity(entity);
    for (const key in patch) {
      const value = (patch as Record<string, unknown>)[key];
      if (record[key] === value && (typeof value !== 'object' || value === null)) continue;
      record[key] = value;
      if (!this.changes.spawned.has(entity.id)) {
        if (!dirty) {
          dirty = new Set();
          this.changes.dirty.set(entity.id, dirty);
        }
        dirty.add(key);
      }
    }
    if (movesTile && entity.kind !== 'grunt') this.indexEntity(entity);
  }

  *all<K extends EntityKind>(kind: K): Generator<EntityOf<K>> {
    for (const e of this.entities.values()) if (e.kind === kind) yield e as EntityOf<K>;
  }

  objectsAt(x: number, y: number): Entity[] {
    const ids = this.objects.get(this.index(x, y));
    if (!ids) return [];
    const out: Entity[] = [];
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  objectAt<K extends EntityKind>(x: number, y: number, kind: K): EntityOf<K> | undefined {
    const ids = this.objects.get(this.index(x, y));
    if (!ids) return undefined;
    for (const id of ids) {
      const e = this.entities.get(id);
      if (e && e.kind === kind) return e as EntityOf<K>;
    }
    return undefined;
  }

  /** Register an entity as reacting to an extra tile (e.g. the ring around a fort). */
  attachToTile(entity: Entity, x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    const list = this.objects.get(i);
    if (list) {
      if (!list.includes(entity.id)) list.push(entity.id);
    } else this.objects.set(i, [entity.id]);
  }

  private detachFromTile(id: EntityId, i: number): void {
    const list = this.objects.get(i);
    if (!list) return;
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) this.objects.delete(i);
  }

  private indexEntity(e: Entity): void {
    if (e.kind === 'team') {
      this.teamIds.set(e.index, e.id);
    } else if (e.kind === 'grunt') {
      if (this.inBounds(e.x, e.y)) this.occupancy.set(this.index(e.x, e.y), e.id);
    } else if (e.kind === 'fort') {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) this.attachToTile(e, e.x + dx, e.y + dy);
    } else if (e.kind === 'giantrock') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.attachToTile(e, e.x + dx, e.y + dy);
    } else if (TILE_OBJECT_KINDS.has(e.kind)) {
      this.attachToTile(e, e.x, e.y);
    }
  }

  private unindexEntity(e: Entity): void {
    if (e.kind === 'team') {
      this.teamIds.delete(e.index);
    } else if (e.kind === 'grunt') {
      const i = this.index(e.x, e.y);
      if (this.occupancy.get(i) === e.id) this.occupancy.delete(i);
    } else if (e.kind === 'fort') {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) this.detachFromTile(e.id, this.index(e.x + dx, e.y + dy));
    } else if (e.kind === 'giantrock') {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) this.detachFromTile(e.id, this.index(e.x + dx, e.y + dy));
    } else if (TILE_OBJECT_KINDS.has(e.kind)) {
      this.detachFromTile(e.id, this.index(e.x, e.y));
    }
  }

  alliance(team: number): number {
    return this.alliances[team] ?? team;
  }

  team(index: number): TeamState | undefined {
    return this.get(this.teamIds.get(index), 'team');
  }

  onGruntDied(team: number): void {
    this.rules.onGruntDied?.(this, team);
  }

  onBallBroken(ball: RollingBall): void {
    this.rules.onBallBroken?.(this, ball);
  }

  // --- grunt occupancy --------------------------------------------------------------

  gruntAt(x: number, y: number): Grunt | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.get(this.occupancy.get(this.index(x, y)), 'grunt');
  }

  /**
   * Moves the grunt's tile claim. Returns the grunt that was standing on the target
   * (it gets squashed by forced movement).
   */
  claimTile(grunt: Grunt, x: number, y: number): Grunt | undefined {
    const from = this.index(grunt.x, grunt.y);
    if (this.occupancy.get(from) === grunt.id) this.occupancy.delete(from);
    const to = this.index(x, y);
    const squashed = this.get(this.occupancy.get(to), 'grunt');
    this.occupancy.set(to, grunt.id);
    this.edit(grunt, { x, y });
    return squashed && squashed.id !== grunt.id ? squashed : undefined;
  }

  // --- randomness ---------------------------------------------------------------

  random(): number {
    const [value, next] = nextRandom(this.rng);
    this.rng = next;
    return value;
  }

  randomInt(n: number): number {
    return Math.floor(this.random() * n);
  }

  // --- fx -----------------------------------------------------------------------

  fx(type: string, at: Point, id?: EntityId, data?: string | number): void {
    const fx: Fx = { type, x: at.x, y: at.y };
    if (id !== undefined) fx.id = id;
    if (data !== undefined) fx.data = data;
    this.changes.fx.push(fx);
  }

  // --- scheduler ----------------------------------------------------------------

  /**
   * Schedule a registered task `delay` ticks from now. A task with a key replaces any
   * live task with the same (entity, key).
   */
  schedule(delay: number, name: string, id: EntityId, key?: string, ...args: unknown[]): void {
    if (!HANDLERS.has(name)) throw new Error(`Unknown task: ${name}`);
    const seq = this.taskSeq++;
    if (key !== undefined) {
      const k = `${id}:${key}`;
      const old = this.keyed.get(k);
      if (old !== undefined) this.cancelled.add(old);
      this.keyed.set(k, seq);
    }
    const task: Task = { at: this.tick + Math.max(0, Math.round(delay)), seq, name, id, args };
    if (key !== undefined) task.key = key;
    this.push(task);
  }

  cancel(id: EntityId, key: string): void {
    const k = `${id}:${key}`;
    const seq = this.keyed.get(k);
    if (seq !== undefined) {
      this.cancelled.add(seq);
      this.keyed.delete(k);
    }
  }

  isScheduled(id: EntityId, key: string): boolean {
    return this.keyed.has(`${id}:${key}`);
  }

  /** Cancel every task that belongs to an entity. */
  cancelAll(id: EntityId): void {
    for (const t of this.heap) if (t.id === id) this.cancelled.add(t.seq);
    for (const k of [...this.keyed.keys()]) if (k.startsWith(`${id}:`)) this.keyed.delete(k);
  }

  /** Run all tasks due this tick (including ones scheduled with zero delay while running). */
  runTasks(): void {
    let guard = 0;
    while (this.heap.length > 0 && this.heap[0]!.at <= this.tick) {
      const task = this.pop()!;
      if (this.cancelled.delete(task.seq)) continue;
      if (task.key !== undefined) {
        const k = `${task.id}:${task.key}`;
        if (this.keyed.get(k) === task.seq) this.keyed.delete(k);
      }
      const handler = HANDLERS.get(task.name)!;
      if (task.id !== 0 && !this.entities.has(task.id)) continue;
      handler(this, task.id, ...task.args);
      if (++guard > 100000) throw new Error('Task loop runaway');
    }
  }

  pendingTasks(): Task[] {
    return this.heap.filter(t => !this.cancelled.has(t.seq)).sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  private less(a: Task, b: Task): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private push(task: Task): void {
    const h = this.heap;
    h.push(task);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop(): Task | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }

  // --- replica support (client side: state comes from the server) -----------------------

  /** Insert or replace an entity without change tracking. */
  putEntity(e: Entity): void {
    const old = this.entities.get(e.id);
    if (old) this.unindexEntity(old);
    this.entities.set(e.id, e);
    this.indexEntity(e);
    if (e.id >= this.nextId) this.nextId = e.id + 1;
  }

  dropEntity(id: EntityId): void {
    const old = this.entities.get(id);
    if (!old) return;
    this.unindexEntity(old);
    this.entities.delete(id);
  }

  patchEntity(id: EntityId, patch: Record<string, unknown>): void {
    const e = this.entities.get(id);
    if (!e) return;
    this.unindexEntity(e);
    const record = e as unknown as Record<string, unknown>;
    for (const key in patch) {
      const value = patch[key];
      if (value === null && !(key in NULLABLE_FIELDS)) delete record[key];
      else record[key] = value;
    }
    this.indexEntity(e);
  }

  setTileRaw(index: number, tile: number): void {
    if (this.tiles[index] === tile) return;
    this.tiles[index] = tile;
    this.mapVersion++;
  }

  // --- changes / snapshots -----------------------------------------------------------

  takeChanges(): Changes {
    const c = this.changes;
    this.changes = emptyChanges();
    return c;
  }

  snapshot(): WorldSnapshot {
    return structuredClone({
      tick: this.tick,
      rng: this.rng,
      nextId: this.nextId,
      taskSeq: this.taskSeq,
      width: this.width,
      height: this.height,
      theme: this.theme,
      mode: this.mode,
      tiles: this.tiles,
      alliances: this.alliances,
      entities: [...this.entities.values()].sort((a, b) => a.id - b.id),
      tasks: this.pendingTasks(),
    });
  }

  static fromSnapshot(s: WorldSnapshot): World {
    const w = new World(s.width, s.height, s.tiles, s.theme, s.mode, s.rng);
    w.tick = s.tick;
    w.rng = s.rng;
    w.nextId = s.nextId;
    w.taskSeq = s.taskSeq;
    w.alliances = s.alliances.slice();
    for (const e of structuredClone(s.entities)) {
      w.entities.set(e.id, e);
      w.indexEntity(e);
    }
    for (const t of structuredClone(s.tasks)) {
      w.push(t);
      if (t.key !== undefined) w.keyed.set(`${t.id}:${t.key}`, t.seq);
    }
    w.changes = emptyChanges();
    return w;
  }
}
