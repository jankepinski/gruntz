import { issueOrder, isGone, stopGrunt } from './grunt.ts';
import { giveSlotItem } from './objects.ts';
import { destruct, dropOvenGrunt } from './rules.ts';
import type { EntityId, Grunt, Order } from './types.ts';
import type { World } from './world.ts';

/**
 * Everything a player (human or bot) can ask the simulation to do. Commands are the
 * only input to the simulation, which is what makes it safe to run authoritatively on
 * a server: clients send intentions, never results.
 */
export type Command =
  | { type: 'move'; ids: EntityId[]; x: number; y: number; queue?: boolean; safe?: boolean }
  | { type: 'attack'; ids: EntityId[]; target: EntityId; queue?: boolean }
  | { type: 'useTool'; ids: EntityId[]; x: number; y: number; target?: EntityId; queue?: boolean }
  | { type: 'useToy'; ids: EntityId[]; x: number; y: number; target?: EntityId; queue?: boolean }
  | { type: 'stop'; ids: EntityId[] }
  | { type: 'give'; slot: number; id: EntityId }
  | { type: 'drop'; oven: number; pad: EntityId }
  | { type: 'destruct' };

export const MAX_COMMAND_IDS = 64;

/** Apply a command for a team. Returns null when accepted, else a rejection reason. */
export function applyCommand(w: World, team: number, cmd: Command): string | null {
  const own = (ids: EntityId[]): Grunt[] => {
    const out: Grunt[] = [];
    const seen = new Set<EntityId>();
    for (const id of ids.slice(0, MAX_COMMAND_IDS)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const g = w.get(id, 'grunt');
      if (g && g.team === team && !g.ai && !isGone(g)) out.push(g);
    }
    return out;
  };
  const inBounds = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && w.inBounds(x, y);

  switch (cmd.type) {
    case 'move': {
      if (!inBounds(cmd.x, cmd.y)) return 'bounds';
      const gs = own(cmd.ids);
      if (gs.length === 0) return 'no-units';
      const order: Order = { type: 'move', x: cmd.x, y: cmd.y };
      if (cmd.safe) order.safe = true;
      for (const g of gs) issueOrder(w, g, order, cmd.queue ?? false);
      return null;
    }
    case 'attack': {
      const target = w.get(cmd.target, 'grunt');
      if (!target) return 'no-target';
      const gs = own(cmd.ids);
      if (gs.length === 0) return 'no-units';
      for (const g of gs) issueOrder(w, g, { type: 'attack', target: target.id }, cmd.queue ?? false);
      return null;
    }
    case 'useTool':
    case 'useToy': {
      if (!inBounds(cmd.x, cmd.y)) return 'bounds';
      const gs = own(cmd.ids);
      if (gs.length === 0) return 'no-units';
      const order: Extract<Order, { type: 'useTool' | 'useToy' }> = { type: cmd.type, x: cmd.x, y: cmd.y };
      if (cmd.target !== undefined) {
        if (!w.get(cmd.target, 'grunt')) return 'no-target';
        order.target = cmd.target;
      }
      for (const g of gs) issueOrder(w, g, order, cmd.queue ?? false);
      return null;
    }
    case 'stop':
      for (const g of own(cmd.ids)) stopGrunt(w, g);
      return null;
    case 'give': {
      const g = own([cmd.id])[0];
      if (!g) return 'no-units';
      return giveSlotItem(w, team, cmd.slot, g) ? null : 'cannot-give';
    }
    case 'drop':
      return dropOvenGrunt(w, team, cmd.oven, cmd.pad) ? null : 'cannot-drop';
    case 'destruct':
      destruct(w, team);
      return null;
  }
}
