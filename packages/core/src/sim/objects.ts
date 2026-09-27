import { MAX_FLIGHT, msToTicks } from '../constants.ts';
import {
  HEALTH_GAIN,
  itemType,
  POWERUP_DURATION_MS,
  TOOL_INFO,
  type ItemId,
  type ToolId,
  type ToyId,
} from '../data/items.ts';
import { T, tileDef, tileId } from '../data/tiles.ts';
import type { Point } from '../point.ts';
import { aiNotice } from './ai.ts';
import { checkIdle, enterTile, explodeTiles, heal, isGone, kill, setAction, updateTile } from './grunt.ts';
import { revealPickup } from './tools.ts';
import { freezeFor, playToy } from './toys.ts';
import type { Brickz, GiantRock, Grunt, Pickup, SwitchEntity, Wormhole } from './types.ts';
import { registerTask, type World } from './world.ts';

const PICKUP_MS = 1240;
const CONVERSION_DRAIN_MS = 1000;
const TELEPORT_OUT_MS = 1200;
const TELEPORT_IN_MS = 1200;
const CURSE_MS = 15000;
const STOPWATCH_MS = 8000;

// --- arriving on / leaving a tile ------------------------------------------------------

/** Called when a grunt settles on a tile. Returns true if something took over the grunt. */
export function pressTileObjects(w: World, g: Grunt): boolean {
  aiNotice(w, g);
  let handled = false;
  for (const e of w.objectsAt(g.x, g.y)) {
    if (handled) break;
    switch (e.kind) {
      case 'pickup':
        handled = pickup(w, e, g);
        break;
      case 'switch':
        pressSwitch(w, e, g);
        break;
      case 'fort':
        handled = w.rules.onFortEntered?.(w, e, g) ?? false;
        break;
      case 'wormhole':
        handled = enterWormhole(w, e, g);
        break;
      case 'help':
        if (!g.ai) w.fx('help', e, e.id, g.team);
        break;
      case 'trigger':
        if (!e.used && !g.ai) openSecretWormhole(w, e);
        break;
    }
  }
  return handled;
}

export function releaseTileObjects(w: World, g: Grunt, x: number, y: number): void {
  for (const e of w.objectsAt(x, y)) {
    if (e.kind === 'switch') releaseSwitch(w, e, g);
  }
}

// --- pickups ---------------------------------------------------------------------

export function pickup(w: World, p: Pickup, g: Grunt): boolean {
  if (p.hidden) return false;
  if (p.availableAt !== undefined && w.tick < p.availableAt) return false;
  if (g.action.kind === 'play') return false;
  const type = p.item === 'TOYBOX' ? 'toybox' : itemType(p.item);
  // Enemy gruntz leave the level's items alone (a toybox they can't resist, though).
  if (g.ai && type !== 'toybox') return false;
  const team = w.team(g.team);

  switch (type) {
    case 'toybox': {
      if (!p.toy) return false;
      if (p.team === g.team) {
        // Take our own toy back.
        if (g.toy) return false;
        w.edit(g, { toy: p.toy });
        consume(w, p);
        startPickup(w, g, p.toy);
        return true;
      }
      // An enemy toybox: can't resist playing with it.
      consume(w, p);
      playToy(w, g, p.toy, null, false);
      return true;
    }
    case 'tool': {
      if (g.tool === 'WARPSTONE' || g.tool === 'BOMB') return false;
      if (p.item === 'WARPSTONE' && g.powerup === 'CONVERSION') return false;
      const tool = p.item as ToolId;
      const patch: Partial<Grunt> = { tool };
      if (tool === 'WINGZ') patch.flight = MAX_FLIGHT;
      if (tool === 'WAND' || tool === 'WARPSTONE') patch.spell = p.spell ?? null;
      if (tool === 'WAND') patch.spell = p.spell ?? 'ROLLINGBALLZ';
      w.edit(g, patch);
      if (team) w.edit(team, { stats: { ...team.stats, toolz: team.stats.toolz + 1 } });
      if (tool === 'WARPSTONE') w.fx('warpstone', g, g.id);
      break;
    }
    case 'toy':
      w.edit(g, { toy: p.item as ToyId, spell: p.item === 'SCROLL' ? (p.spell ?? 'FREEZE') : null });
      if (team) w.edit(team, { stats: { ...team.stats, toyz: team.stats.toyz + 1 } });
      break;
    case 'powerup':
      givePowerup(w, g, p.item);
      if (team) w.edit(team, { stats: { ...team.stats, powerupz: team.stats.powerupz + 1 } });
      break;
    case 'utility':
      switch (p.item) {
        case 'HEALTH1':
        case 'HEALTH2':
        case 'HEALTH3':
          heal(w, g, HEALTH_GAIN[p.item]);
          break;
        case 'MEGAPHONE':
          if (team) megaphone(w, team.index);
          break;
        case 'STOPWATCH':
          // Time stands still for everybody else's gruntz.
          w.fx('stopwatch', g, g.id);
          for (const other of w.all('grunt')) {
            if (other.team !== g.team && !isGone(other) && w.alliance(other.team) !== w.alliance(g.team))
              freezeFor(w, other, STOPWATCH_MS);
          }
          break;
      }
      break;
    case 'curse':
      if (team) curseOpponents(w, g.team, p.item);
      break;
    case 'reward':
      if (team) {
        const stats = { ...team.stats };
        if (p.item === 'COIN') stats.coins++;
        else {
          stats.letters += p.item.slice('SECRET_'.length);
          stats.secrets++;
        }
        w.edit(team, { stats });
      }
      break;
  }
  consume(w, p);
  startPickup(w, g, p.item);
  return true;
}

function consume(w: World, p: Pickup): void {
  if (p.respawn && p.respawn > 0) {
    w.edit(p, { availableAt: w.tick + p.respawn });
  } else {
    w.destroy(p);
  }
}

function startPickup(w: World, g: Grunt, item: string): void {
  const ticks = msToTicks(PICKUP_MS);
  setAction(w, g, 'pickup', ticks, { item });
  w.fx('pickup', g, g.id, item);
  w.schedule(ticks, 'finishPickup', g.id, 'action');
}

registerTask('finishPickup', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

export function givePowerup(w: World, g: Grunt, item: ItemId): void {
  const ticks = msToTicks(POWERUP_DURATION_MS);
  w.edit(g, { powerup: item as Grunt['powerup'], powerupEnd: w.tick + ticks });
  w.schedule(ticks, 'endPowerup', g.id, 'powerup');
  if (item === 'CONVERSION') w.schedule(msToTicks(CONVERSION_DRAIN_MS), 'conversionDrain', g.id, 'drain');
  if (item === 'ROIDZ') w.edit(g, { staminaEnd: w.tick });
}

registerTask('endPowerup', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  w.edit(g, { powerup: null, powerupEnd: 0 });
  w.cancel(g.id, 'drain');
});

registerTask('conversionDrain', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g || g.powerup !== 'CONVERSION' || isGone(g)) return;
  const health = g.health - 1;
  w.edit(g, { health: Math.max(0, health) });
  if (health <= 0) {
    kill(w, g, 'GOO');
    return;
  }
  w.schedule(msToTicks(CONVERSION_DRAIN_MS), 'conversionDrain', g.id, 'drain');
});

/** Megaphone: the grunt machine hands out the next item of the level's list. */
export function megaphone(w: World, teamIndex: number): void {
  const team = w.team(teamIndex);
  if (!team) return;
  const item = team.megaphoneItems[team.megaphoneIndex];
  if (item === undefined) return;
  const slots = team.slots.slice();
  const free = slots.indexOf(null);
  if (free >= 0) slots[free] = item;
  else slots.push(item);
  w.edit(team, { slots, megaphoneIndex: team.megaphoneIndex + 1 });
  w.fx('megaphone', { x: 0, y: 0 }, team.id, item);
}

function curseOpponents(w: World, teamIndex: number, curse: ItemId): void {
  for (const t of w.all('team')) {
    if (t.index === teamIndex || w.alliance(t.index) === w.alliance(teamIndex)) continue;
    w.edit(t, { curse: curse as NonNullable<typeof t.curse>, curseEnd: w.tick + msToTicks(CURSE_MS) });
  }
}

// --- switches & triggers ------------------------------------------------------------------

function switchTile(w: World, sw: SwitchEntity) {
  return tileDef(w.tileAt(sw.x, sw.y));
}

function setPressed(w: World, sw: SwitchEntity, pressed: boolean): void {
  const def = switchTile(w, sw);
  const low = (def.traits & T.SWITCH_LOW) !== 0;
  if (low !== pressed) w.toggleTile(sw.x, sw.y);
}

export function pressSwitch(w: World, sw: SwitchEntity, g: Grunt): void {
  const def = switchTile(w, sw);
  if (!(def.traits & T.SWITCH) || def.traits & T.SWITCH_LOW || sw.disabled) return;
  const kind = def.switchKind!;
  if (kind === 'checkpoint' && sw.requires) {
    const holds = g.tool === sw.requires || g.toy === sw.requires;
    if (!holds) return;
  }
  setPressed(w, sw, true);
  w.fx('switch', sw, sw.id, kind);

  if (kind === 'time') {
    w.edit(sw, { disabled: true });
    w.schedule(sw.delay + sw.duration, 'enableSwitch', sw.id, 'enable');
  }
  if (kind === 'many' || kind === 'checkpoint') {
    const group = groupSwitches(w, sw);
    const allDown = group.every(s => (switchTile(w, s).traits & T.SWITCH_LOW) !== 0);
    if (allDown) {
      for (const s of group) triggerTargets(w, s);
      if (kind === 'checkpoint') for (const s of group) w.edit(s, { disabled: true });
    }
  } else if (kind === 'red') {
    toggleRedPyramids(w);
  } else {
    triggerTargets(w, sw);
    if (kind === 'orange') {
      for (const p of sw.partners) {
        const partner = w.objectAt(p.x, p.y, 'switch');
        if (partner && partner.disabled) {
          w.edit(partner, { disabled: false });
          setPressed(w, partner, false);
          triggerTargets(w, partner);
        }
      }
    }
  }
  if (kind === 'secret') {
    const team = w.team(g.team);
    if (team) w.edit(team, { stats: { ...team.stats, secrets: team.stats.secrets + 1 } });
  }
  if (kind === 'once' || kind === 'orange' || kind === 'time' || kind === 'secret') {
    w.edit(sw, { disabled: true });
  }
}

export function releaseSwitch(w: World, sw: SwitchEntity, _g: Grunt): void {
  if (sw.disabled) return;
  const def = switchTile(w, sw);
  if (!(def.traits & T.SWITCH_LOW)) return;
  const kind = def.switchKind!;
  if (kind === 'checkpoint' && !def.hold) return;
  // Was the purple group complete before this grunt stepped off?
  const group = kind === 'many' || kind === 'checkpoint' ? groupSwitches(w, sw) : [];
  const groupWasActive = group.length > 0 && group.every(s => (switchTile(w, s).traits & T.SWITCH_LOW) !== 0);
  setPressed(w, sw, false);
  if (kind === 'many' || kind === 'checkpoint') {
    if (groupWasActive) for (const s of group) triggerTargets(w, s);
  } else if (def.hold) {
    if (kind === 'red') toggleRedPyramids(w);
    else triggerTargets(w, sw);
  }
}

registerTask('enableSwitch', (w, id) => {
  const sw = w.get(id, 'switch');
  if (!sw) return;
  w.edit(sw, { disabled: false });
  const standing = w.gruntAt(sw.x, sw.y);
  if (!standing) setPressed(w, sw, false);
});

function groupSwitches(w: World, sw: SwitchEntity): SwitchEntity[] {
  const out: SwitchEntity[] = [];
  for (const s of w.all('switch')) if (s.group === sw.group && s.group !== 0) out.push(s);
  return out.length > 0 ? out : [sw];
}

/** Toggle every target of a switch (with its delay and, for timed switches, back again). */
export function triggerTargets(w: World, sw: SwitchEntity): void {
  if (sw.delay > 0) {
    w.schedule(sw.delay, 'toggleTargets', sw.id, undefined, sw.duration);
  } else {
    toggleTargets(w, sw, sw.duration);
  }
}

function toggleTargets(w: World, sw: SwitchEntity, duration: number): void {
  for (const t of sw.targets) toggleTarget(w, t);
  if (duration > 0) w.schedule(duration, 'toggleTargets', sw.id, undefined, 0);
}

registerTask('toggleTargets', (w, id, duration: number) => {
  const sw = w.get(id, 'switch');
  if (sw) toggleTargets(w, sw, duration);
});

export function toggleTarget(w: World, t: Point): void {
  const flag = w.objectAt(t.x, t.y, 'flag');
  if (flag) {
    w.edit(flag, { raised: !flag.raised });
    return;
  }
  w.toggleTile(t.x, t.y);
  updateTile(w, t.x, t.y);
}

function toggleRedPyramids(w: World): void {
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (tileDef(w.tileAt(x, y)).pyramidKind === 'red') toggleTarget(w, { x, y });
    }
  }
}

function openSecretWormhole(w: World, t: import('./types.ts').SecretTrigger): void {
  const hole = w.objectAt(t.wx, t.wy, 'wormhole');
  if (!hole) return;
  w.edit(t, { used: true });
  w.edit(hole, { open: true, closesAt: w.tick + t.duration });
  w.fx('secret', hole, hole.id);
  w.schedule(t.duration, 'closeWormhole', hole.id, 'close');
}

// --- wormholes ---------------------------------------------------------------------

function enterWormhole(w: World, hole: Wormhole, g: Grunt): boolean {
  if (!hole.open || isGone(g)) return false;
  teleport(w, g, { x: hole.tx, y: hole.ty });
  if (hole.color === 'blue') w.edit(hole, { open: false });
  return true;
}

export function teleport(w: World, g: Grunt, to: Point): void {
  releaseTileObjects(w, g, g.x, g.y);
  const i = w.index(g.x, g.y);
  if (w.occupancy.get(i) === g.id) w.occupancy.delete(i);
  const ticks = msToTicks(TELEPORT_OUT_MS);
  w.edit(g, { task: null });
  setAction(w, g, 'enter', ticks, { variant: 0, tx: to.x, ty: to.y });
  w.fx('teleport', g, g.id);
  w.schedule(ticks, 'teleportArrive', g.id, 'action', to.x, to.y);
}

registerTask('teleportArrive', (w, id, x: number, y: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  enterTile(w, g, { x, y });
  const ticks = msToTicks(TELEPORT_IN_MS);
  setAction(w, g, 'enter', ticks, { variant: 1 });
  w.fx('teleport', g, g.id);
  w.schedule(ticks, 'teleportDone', g.id, 'action');
});

registerTask('teleportDone', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

registerTask('closeWormhole', (w, id) => {
  const hole = w.get(id, 'wormhole');
  if (hole) w.edit(hole, { open: false });
});

// --- breaking things --------------------------------------------------------------------

export function revealBrickz(w: World, stack: Brickz, team: number): void {
  if (stack.team === team || stack.revealed.includes(team)) return;
  w.edit(stack, { revealed: [...stack.revealed, team] });
}

/** Break whatever is on a tile (gauntletz / explosions). */
export function breakAt(w: World, at: Point, explosion: boolean, by?: Grunt): void {
  const stack = w.objectAt(at.x, at.y, 'brickz');
  if (stack) {
    breakBrick(w, stack, explosion, by);
    return;
  }
  const giant = w.objectAt(at.x, at.y, 'giantrock');
  if (giant) {
    breakGiantRock(w, giant);
    return;
  }
  if (!w.has(at.x, at.y, T.BREAK)) return;
  w.toggleTile(at.x, at.y);
  w.fx('break', at);
  const hidden = w.objectAt(at.x, at.y, 'pickup');
  if (hidden?.hidden) revealPickup(w, hidden);
  updateTile(w, at.x, at.y);
}

/** The whole 3x3 boulder crumbles: the ground underneath comes back, buried items show. */
export function breakGiantRock(w: World, rock: GiantRock): void {
  w.destroy(rock);
  w.fx('giantBreak', rock);
  let i = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = rock.x + dx;
      const y = rock.y + dy;
      w.setTile(x, y, rock.under[i++] ?? tileId('GROUND'));
      const hidden = w.objectAt(x, y, 'pickup');
      if (hidden?.hidden) revealPickup(w, hidden);
      updateTile(w, x, y);
    }
  }
}

function breakBrick(w: World, stack: Brickz, explosion: boolean, by?: Grunt): void {
  if (stack.layers.length === 0) return;
  const top = stack.layers[stack.layers.length - 1]!;
  if (top === 'gold' && !explosion && by?.tool === 'GAUNTLETZ') {
    w.fx('clang', stack, stack.id);
    return;
  }
  const layers = explosion ? [] : stack.layers.slice(0, -1);
  const broken = explosion ? stack.layers : [top];
  const at = { x: stack.x, y: stack.y };
  if (layers.length === 0) {
    w.destroy(stack);
    w.setTile(at.x, at.y, tileId('PAD'));
  } else {
    w.edit(stack, { layers });
  }
  w.fx('brickBreak', at, undefined, top);
  for (const color of broken) {
    if (color === 'red' && by && by.tool === 'GAUNTLETZ') {
      w.edit(by, { tool: null });
      w.fx('loseItem', by, by.id, 'GAUNTLETZ');
    } else if (color === 'blue') {
      scatterGruntz(w, at);
    } else if (color === 'black') {
      w.schedule(1, 'brickBomb', 0, undefined, at.x, at.y);
    }
  }
  updateTile(w, at.x, at.y);
}

registerTask('brickBomb', (w, _id, x: number, y: number) => {
  explodeTiles(w, { x, y }, true);
});

/** Blue brickz: every grunt nearby gets teleported to a random free spot. */
function scatterGruntz(w: World, at: Point): void {
  const free: Point[] = [];
  for (let y = 0; y < w.height; y++)
    for (let x = 0; x < w.width; x++)
      if (
        (w.traits(x, y) & (T.SOLID | T.NOGO | T.WATER | T.DEATH | T.HOLE | T.PAIN | T.ARROW)) === 0 &&
        !w.gruntAt(x, y)
      )
        free.push({ x, y });
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const g = w.gruntAt(at.x + dx, at.y + dy);
      if (!g || isGone(g) || free.length === 0) continue;
      const pick = free.splice(w.randomInt(free.length), 1)[0]!;
      teleport(w, g, pick);
    }
  }
}

// --- misc helpers used by commands -----------------------------------------------------------

/** Put a resource-slot item (from the grunt machine) on a grunt. */
export function giveSlotItem(w: World, teamIndex: number, slot: number, g: Grunt): boolean {
  const team = w.team(teamIndex);
  if (!team || g.team !== teamIndex || isGone(g)) return false;
  const item = team.slots[slot];
  if (item == null) return false;
  if (item === 'brown' || item === 'gold' || item === 'red' || item === 'blue' || item === 'black') {
    if (g.tool !== 'BRICK') return false;
    w.edit(g, { brickColor: item });
  } else {
    const type = itemType(item as ItemId);
    if (type === 'tool') {
      if (g.tool === 'WARPSTONE') return false;
      const patch: Partial<Grunt> = { tool: item as ToolId };
      if (item === 'WINGZ') patch.flight = MAX_FLIGHT;
      w.edit(g, patch);
      if (TOOL_INFO[item as ToolId].water && w.has(g.x, g.y, T.WATER) && item === 'TOOB')
        w.edit(g, { tool: 'TOOBWATER' });
    } else if (type === 'toy') {
      w.edit(g, { toy: item as ToyId, spell: item === 'SCROLL' ? 'FREEZE' : null });
    } else if (type === 'powerup') {
      givePowerup(w, g, item as ItemId);
    } else {
      return false;
    }
  }
  const slots = team.slots.slice();
  slots[slot] = null;
  w.edit(team, { slots });
  w.fx('give', g, g.id, item);
  return true;
}
