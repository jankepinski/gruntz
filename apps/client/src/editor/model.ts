import {
  blankLevel,
  buildLevel,
  floodRegion,
  gridSize,
  levelToGrid,
  mirrorLevel,
  resizeLevel,
  tileByName,
  T,
  validateLevel,
  type LevelData,
  type LevelIssue,
  type LevelObject,
  type Point,
  type TileGrid,
} from '@gruntz/core';
import { Store } from '../game/store.ts';

export type LevelMeta = Omit<LevelData, 'tiles' | 'legend' | 'objects'>;

export interface EditorDoc {
  meta: LevelMeta;
  grid: TileGrid;
  objects: LevelObject[];
}

export type EditorTool = 'select' | 'paint' | 'rect' | 'fill' | 'object' | 'link';

/** An object as it will be placed (position filled in on click). */
export type ObjectTemplate = DistributiveOmit<LevelObject, 'x' | 'y'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface EditorState {
  tool: EditorTool;
  tile: string;
  brush: number;
  template: ObjectTemplate;
  selected: number | null;
  hover: Point | null;
  /** Rectangle being dragged with the rect tool. */
  rect: { a: Point; b: Point } | null;
  issues: LevelIssue[];
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every document change (UI re-renders from it). */
  revision: number;
  /** Unsaved changes since the last save / export. */
  dirty: boolean;
  showGrid: boolean;
}

const AUTOSAVE_KEY = 'gruntz.editor.autosave';
const UNDO_LIMIT = 200;

type Listener<A extends unknown[]> = (...args: A) => void;

/**
 * The level editor's document and tool state. The 3D view listens for tile / object
 * changes; the Preact UI reads `state` through the store.
 */
export class EditorModel {
  doc: EditorDoc;
  readonly state: Store<EditorState>;
  private undoStack: EditorDoc[] = [];
  private redoStack: EditorDoc[] = [];
  private strokeOpen = false;
  private saveTimer = 0;
  /** Camera position to restore after a test play. */
  camera: { x: number; y: number; zoom: number; rotation: number } | null = null;

  onTiles: Listener<[Point[]]> | null = null;
  onObjects: Listener<[]> | null = null;
  onReload: Listener<[]> | null = null;

  constructor(level?: LevelData) {
    this.doc = docFromLevel(level ?? restoreAutosave() ?? blankLevel('quest'));
    this.state = new Store<EditorState>({
      tool: 'paint',
      tile: 'CLIFF',
      brush: 1,
      template: { type: 'grunt' },
      selected: null,
      hover: null,
      rect: null,
      issues: [],
      canUndo: false,
      canRedo: false,
      revision: 0,
      dirty: false,
      showGrid: true,
    });
    this.revalidate();
  }

  get width(): number {
    return gridSize(this.doc.grid).width;
  }

  get height(): number {
    return gridSize(this.doc.grid).height;
  }

  level(): LevelData {
    return buildLevel(this.doc.meta, this.doc.grid, this.doc.objects);
  }

  load(level: LevelData): void {
    this.doc = docFromLevel(level);
    this.undoStack = [];
    this.redoStack = [];
    this.state.set({ selected: null, rect: null, dirty: false });
    this.changed('reload');
  }

  // --- undo ------------------------------------------------------------------------

  /** Start an undoable change. Strokes (drag painting) call it once at mouse down. */
  begin(): void {
    if (this.strokeOpen) return;
    this.undoStack.push(cloneDoc(this.doc));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.strokeOpen = true;
  }

  end(): void {
    this.strokeOpen = false;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(cloneDoc(this.doc));
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDoc(this.doc));
    this.restore(next);
  }

  private restore(doc: EditorDoc): void {
    const sizeChanged = gridSize(doc.grid).width !== this.width || gridSize(doc.grid).height !== this.height;
    const themeChanged = doc.meta.theme !== this.doc.meta.theme;
    const changedTiles: Point[] = [];
    if (!sizeChanged) {
      for (let y = 0; y < this.height; y++)
        for (let x = 0; x < this.width; x++) if (doc.grid[y]![x] !== this.doc.grid[y]![x]) changedTiles.push({ x, y });
    }
    this.doc = doc;
    const selected = this.state.get().selected;
    if (selected !== null && selected >= doc.objects.length) this.state.set({ selected: null });
    if (sizeChanged || themeChanged) {
      this.changed('reload');
    } else {
      if (changedTiles.length) this.onTiles?.(changedTiles);
      this.changed('objects');
    }
  }

  // --- tiles -------------------------------------------------------------------------

  tileAt(x: number, y: number): string | undefined {
    return this.doc.grid[y]?.[x];
  }

  /** Paint tiles; keeps switch objects in sync with switch tiles. */
  setTiles(points: Point[], name: string): void {
    const changed: Point[] = [];
    let objectsChanged = false;
    for (const p of points) {
      if (p.x < 0 || p.y < 0 || p.x >= this.width || p.y >= this.height) continue;
      const before = this.doc.grid[p.y]![p.x]!;
      if (before === name) continue;
      this.doc.grid[p.y]![p.x] = name;
      changed.push(p);
      objectsChanged = this.syncSwitchObject(p, before, name) || objectsChanged;
    }
    if (changed.length === 0) return;
    this.onTiles?.(changed);
    this.changed(objectsChanged ? 'objects' : 'tiles');
  }

  brushPoints(center: Point, size = this.state.get().brush): Point[] {
    const out: Point[] = [];
    const r0 = -Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) out.push({ x: center.x + r0 + dx, y: center.y + r0 + dy });
    return out;
  }

  rectPoints(a: Point, b: Point): Point[] {
    const out: Point[] = [];
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
    return out;
  }

  fill(start: Point, name: string): void {
    this.setTiles(floodRegion(this.doc.grid, start), name);
  }

  /** Switch tiles carry a switch object with their links; create / drop it with the tile. */
  private syncSwitchObject(p: Point, before: string, after: string): boolean {
    const wasSwitch = (tileByName(before).traits & T.SWITCH) !== 0;
    const isSwitch = (tileByName(after).traits & T.SWITCH) !== 0;
    const index = this.doc.objects.findIndex(o => o.type === 'switch' && o.x === p.x && o.y === p.y);
    if (isSwitch && index < 0) {
      this.doc.objects.push({ type: 'switch', x: p.x, y: p.y, targets: [] });
      return true;
    }
    if (!isSwitch && wasSwitch && index >= 0) {
      this.removeObjectAt(index);
      return true;
    }
    return false;
  }

  // --- objects -----------------------------------------------------------------------

  /** Objects on a tile, most important first (what a click should select). */
  objectsAt(x: number, y: number): number[] {
    const order: Record<LevelObject['type'], number> = {
      grunt: 0,
      fort: 1,
      switch: 2,
      wormhole: 3,
      ball: 4,
      pad: 5,
      brickz: 6,
      flag: 7,
      help: 8,
      secret: 9,
      puddle: 10,
      pickup: 11,
      giantRock: 12,
      hazard: 13,
      dropper: 14,
      cloud: 15,
      ufo: 16,
      spotlight: 17,
      slime: 18,
    };
    const hits: number[] = [];
    this.doc.objects.forEach((o, i) => {
      if (o.x === x && o.y === y) hits.push(i);
      else if ((o.type === 'fort' || o.type === 'giantRock') && Math.abs(o.x - x) <= 1 && Math.abs(o.y - y) <= 1)
        hits.push(i);
    });
    return hits.sort((a, b) => order[this.doc.objects[a]!.type] - order[this.doc.objects[b]!.type]);
  }

  place(p: Point): number | null {
    const t = this.state.get().template;
    if (t.type === 'switch') return null;
    // One standing object per tile: replace what's there (pickups can sit under a grunt,
    // flying hazards pass over everything).
    const stacks = (type: LevelObject['type']) =>
      ['pickup', 'puddle', 'secret', 'dropper', 'cloud', 'ufo', 'spotlight', 'slime'].includes(type);
    const stacking = stacks(t.type);
    for (const i of this.objectsAt(p.x, p.y).sort((a, b) => b - a)) {
      const o = this.doc.objects[i]!;
      const oStacks = stacks(o.type);
      if (o.type === 'switch') continue;
      if (o.type === t.type || (!stacking && !oStacks && o.x === p.x && o.y === p.y)) this.removeObjectAt(i);
    }
    const o = { ...structuredClone(t), x: p.x, y: p.y } as LevelObject;
    if (o.type === 'wormhole') {
      o.tx = p.x;
      o.ty = p.y;
    }
    if (o.type === 'secret') {
      o.wx = p.x;
      o.wy = p.y;
    }
    if (o.type === 'slime') {
      o.x1 = Math.min(this.width - 2, p.x + 3);
      o.y1 = Math.min(this.height - 2, p.y + 3);
    }
    this.doc.objects.push(o);
    const index = this.doc.objects.length - 1;
    this.afterPlace(o);
    this.changed('objects');
    return index;
  }

  /** Tiles that objects expect underneath them. */
  private afterPlace(o: LevelObject): void {
    const set = (x: number, y: number, name: string) => {
      if (this.tileAt(x, y) === undefined || this.tileAt(x, y) === name) return;
      this.doc.grid[y]![x] = name;
      this.onTiles?.([{ x, y }]);
    };
    if (o.type === 'fort') {
      set(o.x, o.y, 'NOGO');
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = this.tileAt(o.x + dx, o.y + dy);
          if ((dx || dy) && n && tileByName(n).traits & (T.SOLID | T.NOGO)) set(o.x + dx, o.y + dy, 'GROUND');
        }
    }
    if (o.type === 'brickz') set(o.x, o.y, 'PAD');
    if (o.type === 'giantRock') {
      // The ground comes back when the rock breaks: it must not be a wall.
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = this.tileAt(o.x + dx, o.y + dy);
          if (n && tileByName(n).traits & (T.SOLID | T.NOGO)) set(o.x + dx, o.y + dy, 'GROUND');
        }
    }
    if (o.type === 'grunt' || o.type === 'pad') {
      const n = this.tileAt(o.x, o.y);
      if (n && tileByName(n).traits & (T.SOLID | T.NOGO)) set(o.x, o.y, 'GROUND');
    }
  }

  private removeObjectAt(index: number): void {
    const o = this.doc.objects[index];
    if (!o) return;
    this.doc.objects.splice(index, 1);
    if (o.type === 'fort' && this.tileAt(o.x, o.y) === 'NOGO') {
      this.doc.grid[o.y]![o.x] = 'GROUND';
      this.onTiles?.([{ x: o.x, y: o.y }]);
    }
    const selected = this.state.get().selected;
    if (selected === index) this.state.set({ selected: null });
    else if (selected !== null && selected > index) this.state.set({ selected: selected - 1 });
  }

  remove(index: number): void {
    const o = this.doc.objects[index];
    if (!o) return;
    // Switch objects belong to their tile: deleting one turns the tile back into ground.
    if (o.type === 'switch') {
      this.setTiles([{ x: o.x, y: o.y }], 'GROUND');
      return;
    }
    this.removeObjectAt(index);
    this.changed('objects');
  }

  move(index: number, p: Point): void {
    const o = this.doc.objects[index];
    if (!o || (o.x === p.x && o.y === p.y)) return;
    if (p.x < 0 || p.y < 0 || p.x >= this.width || p.y >= this.height) return;
    if (o.type === 'switch') {
      // Moving a switch moves its tile too.
      const tile = this.tileAt(o.x, o.y)!;
      this.doc.grid[o.y]![o.x] = 'GROUND';
      this.doc.grid[p.y]![p.x] = tile;
      this.onTiles?.([
        { x: o.x, y: o.y },
        { x: p.x, y: p.y },
      ]);
      const other = this.doc.objects.findIndex(s => s.type === 'switch' && s.x === p.x && s.y === p.y);
      if (other >= 0) this.removeObjectAt(other);
    }
    if (o.type === 'fort' && this.tileAt(o.x, o.y) === 'NOGO') {
      this.doc.grid[o.y]![o.x] = 'GROUND';
      this.onTiles?.([{ x: o.x, y: o.y }]);
    }
    const current = this.doc.objects.indexOf(o);
    this.doc.objects[current] = { ...o, x: p.x, y: p.y };
    this.afterPlace(this.doc.objects[current]!);
    if (this.state.get().selected !== current) this.state.set({ selected: current });
    this.changed('objects');
  }

  update(index: number, patch: Partial<LevelObject>): void {
    const o = this.doc.objects[index];
    if (!o) return;
    const next = { ...o, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete next[k];
    this.doc.objects[index] = next as unknown as LevelObject;
    this.changed('objects');
  }

  /**
   * Link tool: point the selected object at a tile. Switches toggle targets (shift:
   * partners for orange switches), wormholes and secret triggers get their destination.
   */
  link(index: number, p: Point, partner = false): void {
    const o = this.doc.objects[index];
    if (!o) return;
    if (o.type === 'switch') {
      const key = partner ? 'partners' : 'targets';
      const list = (o[key] ?? []).slice();
      const at = list.findIndex(([x, y]) => x === p.x && y === p.y);
      if (at >= 0) list.splice(at, 1);
      else if (!(p.x === o.x && p.y === o.y)) list.push([p.x, p.y]);
      this.update(index, { [key]: list } as Partial<LevelObject>);
    } else if (o.type === 'wormhole') {
      this.update(index, { tx: p.x, ty: p.y } as Partial<LevelObject>);
    } else if (o.type === 'secret') {
      this.update(index, { wx: p.x, wy: p.y } as Partial<LevelObject>);
    } else if (o.type === 'cloud' || o.type === 'ufo') {
      const points = o.points.slice();
      const at = points.findIndex(([x, y]) => x === p.x && y === p.y);
      if (at >= 0) points.splice(at, 1);
      else points.push([p.x, p.y]);
      this.update(index, { points } as Partial<LevelObject>);
    } else if (o.type === 'slime') {
      this.update(index, { x1: p.x, y1: p.y } as Partial<LevelObject>);
    }
  }

  /** Tiles the selected object is linked to (drawn as dashed lines). */
  linksOf(index: number | null): { from: Point; targets: Point[]; partners: Point[] } | null {
    const o = index === null ? undefined : this.doc.objects[index];
    if (!o) return null;
    const from = { x: o.x, y: o.y };
    if (o.type === 'switch')
      return {
        from,
        targets: o.targets.map(([x, y]) => ({ x, y })),
        partners: (o.partners ?? []).map(([x, y]) => ({ x, y })),
      };
    if (o.type === 'wormhole') return { from, targets: [{ x: o.tx, y: o.ty }], partners: [] };
    if (o.type === 'secret') return { from, targets: [{ x: o.wx, y: o.wy }], partners: [] };
    if (o.type === 'cloud' || o.type === 'ufo')
      return { from, targets: o.points.map(([x, y]) => ({ x, y })), partners: [] };
    if (o.type === 'slime')
      return {
        from,
        targets: [
          { x: o.x1, y: o.y },
          { x: o.x1, y: o.y1 },
          { x: o.x, y: o.y1 },
        ],
        partners: [],
      };
    return null;
  }

  // --- whole level ----------------------------------------------------------------------

  setMeta(patch: Partial<LevelMeta>): void {
    const themeChanged = patch.theme !== undefined && patch.theme !== this.doc.meta.theme;
    const next = { ...this.doc.meta, ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    this.doc.meta = next as unknown as LevelMeta;
    this.changed(themeChanged || patch.mode !== undefined ? 'reload' : 'meta');
  }

  resize(width: number, height: number, ox: number, oy: number): void {
    const { grid, objects } = resizeLevel(this.doc.grid, this.doc.objects, width, height, ox, oy, 'GROUND');
    this.doc.grid = grid;
    this.doc.objects = objects;
    this.state.set({ selected: null });
    this.changed('reload');
  }

  mirror(axis: 'x' | 'y'): void {
    const { grid, objects } = mirrorLevel(this.doc.grid, this.doc.objects, axis);
    this.doc.grid = grid;
    this.doc.objects = objects;
    this.changed('reload');
  }

  // --- change plumbing ---------------------------------------------------------------------

  private changed(kind: 'tiles' | 'objects' | 'meta' | 'reload'): void {
    if (kind === 'objects') this.onObjects?.();
    if (kind === 'reload') this.onReload?.();
    this.revalidate();
    this.state.set({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, dirty: true });
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.autosave(), 600);
  }

  markSaved(): void {
    this.state.set({ dirty: false });
  }

  private revalidate(): void {
    const s = this.state.get();
    this.state.set({ issues: validateLevel(this.level()), revision: s.revision + 1 });
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.level()));
    } catch {
      /* storage full or unavailable */
    }
  }
}

function docFromLevel(level: LevelData): EditorDoc {
  const { tiles: _tiles, legend: _legend, objects, ...meta } = structuredClone(level);
  return { meta, grid: levelToGrid(level), objects };
}

function cloneDoc(doc: EditorDoc): EditorDoc {
  return structuredClone(doc);
}

function restoreAutosave(): LevelData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const level = JSON.parse(raw) as LevelData;
    levelToGrid(level);
    return level;
  } catch {
    return null;
  }
}
