import { tileId } from '../data/tiles.ts';
import { hashValue } from '../hash.ts';
import type { Entity, EntityId, Fx } from '../sim/types.ts';
import type { Changes, World } from '../sim/world.ts';

/**
 * What one player is allowed to see. The server never sends hidden information:
 * buried items, the colours of brickz you haven't spied, invisible (ghost) enemies,
 * enemy orders and the other teams' grunt machine contents.
 */
export function viewEntity(w: World, e: Entity, viewer: number): Entity | null {
  switch (e.kind) {
    case 'pickup':
      return e.hidden ? null : e;
    case 'brickz': {
      const canSee = e.team === viewer || e.revealed.includes(viewer);
      return { ...e, layers: canSee ? e.layers : e.layers.map(() => 'brown' as const), revealed: [] };
    }
    case 'grunt': {
      const friendly = w.alliance(e.team) === w.alliance(viewer);
      if (!friendly && e.powerup === 'GHOST') return null;
      if (e.team === viewer) return e;
      return { ...e, task: null, orders: [] };
    }
    case 'team':
      if (e.index === viewer) return e;
      return { ...e, slots: [], megaphoneItems: [], megaphoneIndex: 0, goo: 0, ovens: [] };
    case 'switch':
      if (tileId('SWITCH_SECRET') === w.tileAt(e.x, e.y)) return null;
      return e;
    case 'trigger':
      return null;
    case 'giantrock':
      return { ...e, under: [] };
    case 'wormhole':
      // Secret (red) wormholes are invisible until opened.
      return e.color === 'red' && !e.open ? null : e;
    default:
      return e;
  }
}

const SECRET = () => tileId('SWITCH_SECRET');
const GROUND = () => tileId('GROUND');

export function viewTile(tile: number): number {
  return tile === SECRET() ? GROUND() : tile;
}

export interface ViewSnapshot {
  tick: number;
  width: number;
  height: number;
  theme: World['theme'];
  mode: World['mode'];
  alliances: number[];
  tiles: number[];
  /** Height levels (fixed for the game, omitted on flat maps). */
  heights?: number[];
  entities: Entity[];
}

export interface Delta {
  /** Tick that was just simulated. */
  tick: number;
  spawned?: Entity[];
  updated?: [EntityId, Record<string, unknown>][];
  removed?: EntityId[];
  tiles?: [number, number][];
  fx?: Fx[];
}

function fxVisible(fx: Fx, w: World, viewer: number): boolean {
  if (fx.type === 'spy') {
    const g = fx.id !== undefined ? w.get(fx.id, 'grunt') : undefined;
    return !g || g.team === viewer;
  }
  return true;
}

/** Tracks what a client already knows and produces its deltas. */
export class ViewTracker {
  private known = new Map<EntityId, Record<string, unknown>>();
  private tiles: number[] = [];

  constructor(readonly viewer: number) {}

  snapshot(w: World): ViewSnapshot {
    this.known.clear();
    const entities: Entity[] = [];
    for (const e of [...w.entities.values()].sort((a, b) => a.id - b.id)) {
      const v = viewEntity(w, e, this.viewer);
      if (!v) continue;
      const copy = { ...v } as Record<string, unknown>;
      this.known.set(e.id, copy);
      entities.push(structuredClone(v));
    }
    this.tiles = w.tiles.map(viewTile);
    return {
      tick: w.tick,
      width: w.width,
      height: w.height,
      theme: w.theme,
      mode: w.mode,
      alliances: w.alliances.slice(),
      tiles: this.tiles.slice(),
      ...(w.maxLevel > 0 ? { heights: w.heights.slice() } : {}),
      entities,
    };
  }

  delta(w: World, changes: Changes, tick: number): Delta {
    const ids = new Set<EntityId>([...changes.spawned, ...changes.dirty.keys(), ...changes.removed]);
    const spawned: Entity[] = [];
    const updated: [EntityId, Record<string, unknown>][] = [];
    const removed: EntityId[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const e = w.entities.get(id);
      const view = e ? viewEntity(w, e, this.viewer) : null;
      const prev = this.known.get(id);
      if (!view) {
        if (prev) {
          removed.push(id);
          this.known.delete(id);
        }
        continue;
      }
      const current = { ...view } as Record<string, unknown>;
      if (!prev) {
        spawned.push(structuredClone(view));
        this.known.set(id, current);
        continue;
      }
      let patch: Record<string, unknown> | undefined;
      for (const key in current) {
        if (prev[key] !== current[key]) {
          patch ??= {};
          patch[key] = current[key] === undefined ? null : current[key];
        }
      }
      for (const key in prev) {
        if (!(key in current) && prev[key] !== undefined) {
          patch ??= {};
          patch[key] = null;
        }
      }
      if (patch) updated.push([id, structuredClone(patch)]);
      this.known.set(id, current);
    }
    const tiles: [number, number][] = [];
    for (const [i, t] of changes.tiles) {
      const v = viewTile(t);
      if (this.tiles[i] !== v) {
        this.tiles[i] = v;
        tiles.push([i, v]);
      }
    }
    const fx = changes.fx.filter(f => fxVisible(f, w, this.viewer));
    const delta: Delta = { tick };
    if (spawned.length) delta.spawned = spawned;
    if (updated.length) delta.updated = updated;
    if (removed.length) delta.removed = removed;
    if (tiles.length) delta.tiles = tiles;
    if (fx.length) delta.fx = fx;
    return delta;
  }

  /** Hash of everything this client should currently have. */
  hash(): number {
    return hashView(
      this.tiles,
      [...this.known.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]),
    );
  }
}

export function hashView(tiles: readonly number[], entities: readonly unknown[]): number {
  return hashValue({ tiles, entities });
}
