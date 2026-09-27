import { msToTicks } from '../constants.ts';
import { MAX_BRICK_LAYERS } from '../data/items.ts';
import { T, tileId } from '../data/tiles.ts';
import { DIRS, eq, type Point } from '../point.ts';
import {
  breakTile,
  chargeStamina,
  checkIdle,
  explodeTiles,
  face,
  hasFullStamina,
  isGone,
  move,
  setAction,
  updateTile,
} from './grunt.ts';
import { revealBrickz } from './objects.ts';
import { castSpell } from './toys.ts';
import type { Brickz, Grunt, Pickup, TimeBomb } from './types.ts';
import { registerTask, type World } from './world.ts';

// Tool timings from the original game (ms).
const BOMB_DELAY = 400;
const BRICK_DELAY = 2400;
const FINISH_DELAY = 600;
const GAUNTLETZ_DELAY = 1200;
const GOOBER_START_DELAY = 800;
const GOOBER_FINISH_DELAY = 3300;
const GOOBER_IDLE_DELAY = 2000;
export const GOO_PER_GRUNT = 4;
export const OVEN_BAKE_MS = 5000;
const SPY_DELAY = 1920;
const TIMEBOMB_DELAY = 800;
const DIG_PHASES = [600, 1200, 1200, 800];
const WAND_DELAY = 1120;
const WAND_HEALTH_COST = 5;
export const TIMEBOMB_SLOW_MS = 3000;
export const TIMEBOMB_FAST_MS = 1000;
export const TIMEBOMB_HIDDEN_MS = 2000;
export const SPY_RADIUS = 2;

const BRICKZ = () => tileId('BRICKZ');

/** Can the grunt's tool be used on this tile at all (ignoring stamina)? */
export function toolTargetValid(w: World, g: Grunt, target: Point): boolean {
  if (!g.tool || isGone(g)) return false;
  const traits = w.traits(target.x, target.y);
  switch (g.tool) {
    case 'BOMB':
    case 'SPY':
    case 'WAND':
      return true;
    case 'BRICK': {
      if (!(traits & T.LAY) || eq(g, target) || w.gruntAt(target.x, target.y)) return false;
      const stack = w.objectAt(target.x, target.y, 'brickz');
      return !stack || stack.layers.length < MAX_BRICK_LAYERS;
    }
    case 'GAUNTLETZ':
      return (traits & T.BREAK) !== 0;
    case 'GOOBER': {
      const puddle = w.objectAt(target.x, target.y, 'puddle');
      return !!puddle && puddle.sucking < 0;
    }
    case 'SHOVEL':
      return (traits & T.DIG) !== 0 && !w.gruntAt(target.x, target.y);
    case 'TIMEBOMB':
      return (traits & (T.SOLID | T.NOGO | T.WATER | T.HOLE)) === 0 && !w.objectAt(target.x, target.y, 'timebomb');
    default:
      return false;
  }
}

/**
 * Use the grunt's tool on a tile next to it. Returns false if the tool can't be used
 * there right now (the caller then waits or walks).
 */
export function useTool(w: World, g: Grunt, target: Point): boolean {
  if (!toolTargetValid(w, g, target)) return false;
  face(w, g, target);
  if (!hasFullStamina(w, g)) return false;
  switch (g.tool) {
    case 'BOMB':
      startBomb(w, g);
      return true;
    case 'BRICK':
      setAction(w, g, 'tool', msToTicks(BRICK_DELAY), { tx: target.x, ty: target.y, item: 'BRICK' });
      w.schedule(msToTicks(BRICK_DELAY), 'finishBrick', g.id, 'action', target.x, target.y);
      return true;
    case 'GAUNTLETZ':
      setAction(w, g, 'tool', msToTicks(GAUNTLETZ_DELAY + FINISH_DELAY), {
        tx: target.x,
        ty: target.y,
        item: 'GAUNTLETZ',
      });
      w.schedule(msToTicks(GAUNTLETZ_DELAY), 'gauntletzHit', g.id, 'action', target.x, target.y);
      return true;
    case 'GOOBER': {
      const puddle = w.objectAt(target.x, target.y, 'puddle')!;
      const total = GOOBER_START_DELAY + GOOBER_FINISH_DELAY + GOOBER_IDLE_DELAY;
      setAction(w, g, 'tool', msToTicks(total), { tx: target.x, ty: target.y, item: 'GOOBER' });
      w.schedule(msToTicks(GOOBER_START_DELAY), 'startSuck', g.id, 'action', puddle.id);
      return true;
    }
    case 'SHOVEL': {
      const total = DIG_PHASES.reduce((a, b) => a + b, 0);
      setAction(w, g, 'tool', msToTicks(total), { tx: target.x, ty: target.y, item: 'SHOVEL' });
      w.schedule(msToTicks(total), 'finishDig', g.id, 'action', target.x, target.y);
      for (let i = 0, at = 0; i < DIG_PHASES.length - 1; i++) {
        at += DIG_PHASES[i]!;
        w.schedule(msToTicks(at), 'digDirt', g.id, `dirt${i}`, target.x, target.y);
      }
      return true;
    }
    case 'SPY':
      setAction(w, g, 'tool', msToTicks(SPY_DELAY), { item: 'SPY' });
      w.schedule(msToTicks(SPY_DELAY), 'finishSpy', g.id, 'action');
      return true;
    case 'TIMEBOMB':
      setAction(w, g, 'attack', msToTicks(TIMEBOMB_DELAY), { tx: target.x, ty: target.y, item: 'TIMEBOMB' });
      w.schedule(msToTicks(TIMEBOMB_DELAY), 'placeTimeBomb', g.id, 'action', target.x, target.y);
      return true;
    case 'WAND':
      setAction(w, g, 'tool', msToTicks(WAND_DELAY), { item: 'WAND', variant: 1 });
      w.schedule(msToTicks(WAND_DELAY), 'finishWand', g.id, 'action');
      return true;
    default:
      return false;
  }
}

// --- bomb (kamikaze) ---------------------------------------------------------------

function startBomb(w: World, g: Grunt): void {
  setAction(w, g, 'tool', msToTicks(BOMB_DELAY * 2), { item: 'BOMB' });
  w.schedule(msToTicks(BOMB_DELAY), 'lightFuse', g.id, 'action');
}

registerTask('lightFuse', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  w.fx('fuse', g, g.id);
  w.schedule(msToTicks(BOMB_DELAY), 'startRun', g.id, 'action');
});

registerTask('startRun', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  w.edit(g, { task: null, orders: [] });
  const d = DIRS[g.facing]!;
  const next = { x: g.x + d.x, y: g.y + d.y };
  if (!move(w, g, next, { run: true })) explodeTiles(w, g, true);
});

// --- brickz ---------------------------------------------------------------------

registerTask('finishBrick', (w, id, x: number, y: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  chargeStamina(w, g, false);
  if (!w.gruntAt(x, y) && w.has(x, y, T.LAY)) {
    addBrick(w, x, y, g.brickColor ?? 'brown', g.team);
    if (g.brickColor) w.edit(g, { brickColor: null });
  }
  checkIdle(w, g);
});

export function addBrick(w: World, x: number, y: number, color: Brickz['layers'][number], team: number): void {
  let stack = w.objectAt(x, y, 'brickz');
  if (!stack) {
    stack = w.spawn<Brickz>({ kind: 'brickz', x, y, layers: [], team, revealed: [] });
  }
  if (stack.layers.length >= MAX_BRICK_LAYERS) return;
  w.edit(stack, { layers: [...stack.layers, color] });
  w.setTile(x, y, BRICKZ());
  w.fx('brick', { x, y }, stack.id);
}

// --- gauntletz --------------------------------------------------------------------

registerTask('gauntletzHit', (w, id, x: number, y: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  breakTileWith(w, { x, y }, g);
  if (g.tool) chargeStamina(w, g, false);
  w.schedule(msToTicks(FINISH_DELAY), 'toolDone', g.id, 'action');
});

registerTask('toolDone', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g) checkIdle(w, g);
});

function breakTileWith(w: World, at: Point, g: Grunt): void {
  breakTile(w, at, false, g);
}

// --- goober straw --------------------------------------------------------------------

registerTask('startSuck', (w, id, puddleId: number) => {
  const g = w.get(id, 'grunt');
  const puddle = w.get(puddleId, 'puddle');
  if (!g) return;
  if (!puddle || puddle.sucking >= 0) {
    checkIdle(w, g);
    return;
  }
  w.edit(puddle, { sucking: w.tick });
  w.fx('suck', puddle, g.id);
  w.schedule(msToTicks(GOOBER_FINISH_DELAY), 'finishSuck', g.id, 'action', puddleId);
});

registerTask('finishSuck', (w, id, puddleId: number) => {
  const g = w.get(id, 'grunt');
  const puddle = w.get(puddleId, 'puddle');
  if (!g) return;
  if (puddle) {
    w.destroy(puddle);
    chargeStamina(w, g, false);
    addGoo(w, g.team, 1);
  }
  w.schedule(msToTicks(GOOBER_IDLE_DELAY), 'toolDone', g.id, 'action');
});

/** Add goo to a team's well; every GOO_PER_GRUNT goo bakes a grunt in a free oven. */
export function addGoo(w: World, teamIndex: number, amount: number): void {
  const team = w.team(teamIndex);
  if (!team) return;
  let goo = team.goo + amount;
  const ovens = team.ovens.slice();
  let changed = false;
  while (goo >= GOO_PER_GRUNT) {
    const free = ovens.indexOf(-1);
    if (free < 0) {
      goo = GOO_PER_GRUNT;
      break;
    }
    goo -= GOO_PER_GRUNT;
    ovens[free] = w.tick + msToTicks(OVEN_BAKE_MS);
    changed = true;
  }
  w.edit(team, changed ? { goo, ovens } : { goo });
}

// --- shovel ---------------------------------------------------------------------

registerTask('digDirt', (w, _id, x: number, y: number) => {
  w.fx('dirt', { x, y });
});

registerTask('finishDig', (w, id, x: number, y: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  if (!w.gruntAt(x, y) || w.gruntAt(x, y) === g) {
    w.toggleTile(x, y);
    const hidden = w.objectAt(x, y, 'pickup');
    if (hidden?.hidden) revealPickup(w, hidden);
    updateTile(w, x, y);
  }
  chargeStamina(w, g, false);
  checkIdle(w, g);
});

// --- spy gear ---------------------------------------------------------------------

registerTask('finishSpy', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  chargeStamina(w, g, false);
  for (let dy = -SPY_RADIUS; dy <= SPY_RADIUS; dy++) {
    for (let dx = -SPY_RADIUS; dx <= SPY_RADIUS; dx++) {
      const x = g.x + dx;
      const y = g.y + dy;
      const stack = w.objectAt(x, y, 'brickz');
      if (stack) {
        revealBrickz(w, stack, g.team);
        w.fx('spy', { x, y }, g.id, 'brickz');
      }
      const hidden = w.objectAt(x, y, 'pickup');
      if (hidden?.hidden) w.fx('spy', { x, y }, g.id, hidden.item === 'TIMEBOMB' ? 'bomb' : 'item');
    }
  }
  checkIdle(w, g);
});

// --- timebombs -------------------------------------------------------------------

registerTask('placeTimeBomb', (w, id, x: number, y: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  chargeStamina(w, g, false);
  spawnTimeBomb(w, x, y, false);
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

export function spawnTimeBomb(w: World, x: number, y: number, hidden: boolean): TimeBomb {
  const slow = msToTicks(hidden ? TIMEBOMB_HIDDEN_MS : TIMEBOMB_SLOW_MS);
  const fast = msToTicks(TIMEBOMB_FAST_MS);
  const bomb = w.spawn<TimeBomb>({
    kind: 'timebomb',
    x,
    y,
    start: w.tick,
    fastAt: w.tick + slow,
    end: w.tick + slow + fast,
  });
  w.schedule(slow + fast, 'timeBombExplode', bomb.id, 'boom');
  return bomb;
}

registerTask('timeBombExplode', (w, id) => {
  const bomb = w.get(id, 'timebomb');
  if (!bomb) return;
  w.destroy(bomb);
  explodeTiles(w, bomb, true);
});

// --- wand ------------------------------------------------------------------------

registerTask('finishWand', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  if (g.spell) castSpell(w, g, g.spell);
  chargeStamina(w, g, false);
  w.edit(g, { health: Math.max(0, g.health - WAND_HEALTH_COST) });
  checkIdle(w, g);
});

// --- hidden items ---------------------------------------------------------------------

export function revealPickup(w: World, pickup: Pickup): void {
  if (!pickup.hidden) return;
  if (pickup.item === 'TIMEBOMB') {
    w.destroy(pickup);
    spawnTimeBomb(w, pickup.x, pickup.y, true);
    return;
  }
  w.edit(pickup, { hidden: false });
  w.fx('reveal', pickup, pickup.id);
}
