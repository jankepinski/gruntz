import type { Entity } from '../sim/types.ts';
import { World } from '../sim/world.ts';
import { hashView, type Delta, type ViewSnapshot } from './view.ts';

/**
 * Client-side copy of the (visible part of the) world, kept up to date from deltas.
 * It is a regular World, so the client can run pathfinding on it for previews and
 * prediction, but it never runs tasks itself.
 */
export function worldFromView(s: ViewSnapshot): World {
  const w = new World(s.width, s.height, s.tiles, s.theme, s.mode, 1);
  w.tick = s.tick;
  w.alliances = s.alliances.slice();
  for (const e of s.entities) w.putEntity(structuredClone(e));
  return w;
}

export function applyDelta(w: World, d: Delta): void {
  if (d.removed) for (const id of d.removed) w.dropEntity(id);
  if (d.spawned) for (const e of d.spawned) w.putEntity(structuredClone(e) as Entity);
  if (d.updated) for (const [id, patch] of d.updated) w.patchEntity(id, patch);
  if (d.tiles) for (const [i, t] of d.tiles) w.setTileRaw(i, t);
  w.tick = d.tick + 1;
}

export function replicaHash(w: World): number {
  const entities = [...w.entities.values()].sort((a, b) => a.id - b.id);
  return hashView(w.tiles, entities);
}
