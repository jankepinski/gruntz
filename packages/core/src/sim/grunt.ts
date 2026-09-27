import { MAX_FLIGHT, MAX_HEALTH, MAX_STAMINA, msToTicks } from '../constants.ts';
import { TOOL_INFO, type CombatTool } from '../data/items.ts';
import { T, tileDef } from '../data/tiles.ts';
import { DIRS, dirBetween, eq, type Dir, type Point } from '../point.ts';
import { aiOnDeath, aiOnIdle, aiOnWalk, canBomberCharge } from './ai.ts';
import { chase, engage, useRangedTool } from './combat.ts';
import { canMoveTo, canUseWater, chooseStep, Flood, floodOptions } from './path.ts';
import { breakAt, pressTileObjects, releaseTileObjects } from './objects.ts';
import { placeToybox, interruptToy } from './toys.ts';
import { toolTargetValid, useTool } from './tools.ts';
import type { Action, ActionKind, DeathKind, EntityId, Grunt, GruntTask, Order, Puddle, WalkTask } from './types.ts';
import { registerTask, THEME_DEATH, type World } from './world.ts';

// --- timings (ms from the original game) ----------------------------------------------
const SWIM_IN_MS = 1400;
const SWIM_OUT_MS = 1520;
const FLY_TICK_MS = 500;
const SPIKES_MS = 1000;
const SPIKES_DAMAGE = 2;
const CRUMBLE_MS = 1000;
const BLOCKED_RETRY_TICKS = 5;
const BLOCKED_GIVE_UP_TICKS = 40;
export const BOMBER_RUN_MS = 200;

// --- basic queries ------------------------------------------------------------------

/** Tool used for combat, taking powerups into account. */
export function combatTool(g: Grunt): CombatTool {
  if (g.powerup === 'DEATHTOUCH') return 'REAPER';
  if (g.powerup === 'CONVERSION') return 'CONVERT';
  return g.tool ?? 'NONE';
}

export function stamina(w: World, g: Grunt): number {
  if (w.tick >= g.staminaEnd) return MAX_STAMINA;
  const span = g.staminaEnd - g.staminaStart;
  if (span <= 0) return MAX_STAMINA;
  return Math.floor((MAX_STAMINA * (w.tick - g.staminaStart)) / span);
}

export function hasFullStamina(w: World, g: Grunt): boolean {
  return w.tick >= g.staminaEnd;
}

/** Empty the stamina bar after an attack / tool use. Roidz keeps it full. */
export function chargeStamina(w: World, g: Grunt, attack: boolean): void {
  const info = TOOL_INFO[combatTool(g)];
  if (info.recharge === 0 || g.powerup === 'ROIDZ') return;
  const ms = attack ? info.recharge : (info.itemRecharge ?? info.recharge);
  const ticks = msToTicks(ms);
  w.edit(g, { staminaStart: w.tick, staminaEnd: w.tick + ticks });
  w.schedule(ticks, 'staminaFull', g.id, 'stamina');
}

export function moveTicks(g: Grunt): number {
  const rate = TOOL_INFO[g.tool ?? 'NONE'].rate;
  return msToTicks(g.powerup === 'SUPERSPEED' ? Math.floor(rate / 2) : rate);
}

export function isIdle(g: Grunt): boolean {
  return g.action.kind === 'idle' || g.action.kind === 'attackIdle';
}

export function isDying(g: Grunt): boolean {
  return g.action.kind === 'death';
}

export function isGone(g: Grunt): boolean {
  return g.action.kind === 'death' || g.action.kind === 'win' || g.action.kind === 'enter';
}

export function isFrozen(g: Grunt): boolean {
  return g.frozen;
}

export function hasFinishedMove(w: World, g: Grunt): boolean {
  return g.action.kind === 'move' && w.tick >= g.action.end;
}

export function canWalk(w: World, g: Grunt): boolean {
  if (g.frozen) return false;
  const full = hasFullStamina(w, g);
  const toob = g.tool === 'TOOB' || g.tool === 'TOOBWATER';
  return (
    isIdle(g) ||
    hasFinishedMove(w, g) ||
    (g.action.kind === 'attack' && full) ||
    (g.action.kind === 'tool' && full && !toob)
  );
}

export function setAction(w: World, g: Grunt, kind: ActionKind, ticks: number, extra?: Partial<Action>): void {
  w.edit(g, { action: { kind, start: w.tick, end: w.tick + ticks, ...extra } });
}

export function face(w: World, g: Grunt, target: Point): void {
  const dir = dirBetween(g, target);
  if (dir !== undefined && dir !== g.facing) w.edit(g, { facing: dir });
}

export function areEnemies(w: World, a: number, b: number): boolean {
  return a !== b && w.alliance(a) !== w.alliance(b);
}

// --- spawning -----------------------------------------------------------------------

export interface GruntSpawn {
  team: number;
  x: number;
  y: number;
  tool?: CombatTool | null;
  toy?: Grunt['toy'];
  ai?: Grunt['ai'];
  alert?: number;
  health?: number;
  facing?: Dir;
}

export function spawnGrunt(w: World, s: GruntSpawn): Grunt {
  const g = w.spawn<Grunt>({
    kind: 'grunt',
    team: s.team,
    x: s.x,
    y: s.y,
    facing: s.facing ?? 4,
    health: s.health ?? MAX_HEALTH,
    staminaStart: 0,
    staminaEnd: 0,
    tool: s.tool ?? null,
    toy: s.toy ?? null,
    spell: null,
    brickColor: null,
    powerup: null,
    powerupEnd: 0,
    flight: MAX_FLIGHT,
    flying: false,
    toyEnd: 0,
    action: { kind: 'idle', start: w.tick, end: w.tick },
    task: null,
    orders: [],
    ai: s.ai ?? null,
    alert: s.alert ?? 0,
    guardX: s.x,
    guardY: s.y,
    frozen: false,
  });
  if (g.tool === 'TOOB' && w.has(g.x, g.y, T.WATER)) w.edit(g, { tool: 'TOOBWATER' });
  w.schedule(0, 'checkIdle', g.id, 'idle');
  return g;
}

// --- state machine --------------------------------------------------------------------

/** Decide what to do next. Called whenever an action ends. */
export function checkIdle(w: World, g: Grunt): void {
  if (isGone(g) || g.frozen) return;
  if (checkTile(w, g)) return;
  if (g.health <= 0) {
    kill(w, g, 'GOO');
    return;
  }
  if (g.action.kind === 'move' && g.action.run) {
    runBomber(w, g);
    return;
  }
  const task = g.task;
  if (task) {
    if (task.kind === 'walk') {
      if (checkWalk(w, g, task)) return;
    } else if (task.kind === 'follow') {
      const enemy = w.get(task.enemy, 'grunt');
      if (enemy && chase(w, g, enemy)) return;
    } else if (task.kind === 'flee') {
      if (checkFlee(w, g, task.enemy)) return;
    }
    // The walk may have left a "waiting for a blocked tile" task behind.
    if (g.task && g.task.kind === 'walk' && g.task.blocked > 0) return;
  }
  if (g.orders.length > 0) {
    const [next, ...rest] = g.orders;
    w.edit(g, { orders: rest, task: null });
    // The previous action is over, so the next order starts right away.
    startOrder(w, g, next!, true);
    return;
  }
  if (g.ai) {
    if (aiOnIdle(w, g)) return;
  }
  if (!isIdle(g) || g.task) {
    w.edit(g, { task: null });
    if (!isIdle(g)) setAction(w, g, 'idle', 0);
  }
}

registerTask('checkIdle', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g && isIdle(g)) checkIdle(w, g);
});

registerTask('staminaFull', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  aiStaminaCharged(w, g);
  if (isIdle(g)) checkIdle(w, g);
});

function aiStaminaCharged(w: World, g: Grunt): void {
  if (g.ai === 'HitAndRun' && g.task?.kind === 'flee') {
    const enemy = w.get(g.task.enemy, 'grunt');
    if (enemy) chase(w, g, enemy);
  }
}

/** Continue a walk task. Returns true if the grunt did something. */
export function checkWalk(w: World, g: Grunt, original: WalkTask): boolean {
  const task = aiOnWalk(w, g, original);
  if (!task) return false;
  const enemy = task.enemy !== undefined ? w.get(task.enemy, 'grunt') : undefined;
  if (task.enemy !== undefined && (!enemy || isGone(enemy))) {
    w.edit(g, { task: null });
    return false;
  }
  const target = { x: task.tx, y: task.ty };

  if (task.useTool && useRangedTool(w, g, target, enemy)) {
    if (task.enemy === undefined) w.edit(g, { task: null });
    return true;
  }
  // Bombers light the fuse as soon as the target is in a straight line.
  if (task.useTool && g.tool === 'BOMB' && canBomberCharge(g, target) && useTool(w, g, target)) {
    w.edit(g, { task: null });
    return true;
  }
  // Something standing on the target: fight it (or give it the toy).
  const standing = w.gruntAt(target.x, target.y);
  if (standing && standing.id !== g.id && areEnemies(w, g.team, standing.team) && !isGone(standing)) {
    if (engage(w, g, standing, task.useToy)) return true;
  }
  // Spy gear and wands work around the grunt: clicking its own tile uses them on the spot.
  if (task.useTool && eq(g, target) && (g.tool === 'SPY' || g.tool === 'WAND')) {
    if (!hasFullStamina(w, g)) {
      if (!isIdle(g)) setAction(w, g, 'idle', 0);
      return true;
    }
    w.edit(g, { task: null });
    return useTool(w, g, target);
  }
  // Toy used on a friendly/own grunt (e.g. reading a scroll).
  if (task.useToy && standing && standing.id === g.id) {
    w.edit(g, { task: null });
    return engage(w, g, g, true);
  }

  const flood = new Flood(w, target, g.team, floodOptions(w, g, task.safe), g);
  const step = chooseStep(w, g, flood, task.useTool || task.useToy);

  if (step && step.atTarget) {
    if (task.useTool && g.tool && toolTargetValid(w, g, step.to)) {
      if (!hasFullStamina(w, g)) {
        // Wait next to the target until the stamina bar is full (staminaFull resumes us).
        face(w, g, step.to);
        if (!isIdle(g)) setAction(w, g, 'idle', 0);
        return true;
      }
      if (useTool(w, g, step.to)) {
        w.edit(g, { task: null });
        return true;
      }
    }
    if (task.useToy && g.toy) {
      if (placeToybox(w, g, step.to)) {
        w.edit(g, { task: null });
        return true;
      }
    }
  }
  if (g.ai && task.useTool && step && (g.ai === 'RockBreaker' || g.ai === 'Digger')) {
    if (useTool(w, g, step.to)) {
      w.edit(g, { task: null });
      return true;
    }
  }

  if (step && !step.atTarget) {
    if (move(w, g, step.to, { jump: step.jump })) {
      if (task.blocked !== 0 || task !== g.task) w.edit(g, { task: { ...task, blocked: 0 } });
      return true;
    }
  }

  // Arrived, or blocked.
  if (flood.get(g) === 0 || eq(g, target)) {
    w.edit(g, { task: null });
    return false;
  }
  face(w, g, target);
  // Blocked by another grunt: wait a little before giving up (QoL over the original,
  // where the grunt would just stop).
  if (!g.ai && flood.reaches(g) && task.blocked < BLOCKED_GIVE_UP_TICKS) {
    w.edit(g, { task: { ...task, blocked: task.blocked + BLOCKED_RETRY_TICKS } });
    if (!isIdle(g)) setAction(w, g, 'idle', 0);
    w.schedule(BLOCKED_RETRY_TICKS, 'retryWalk', g.id, 'retry');
    return true;
  }
  w.edit(g, { task: null });
  return false;
}

registerTask('retryWalk', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g && isIdle(g) && g.task?.kind === 'walk') checkIdle(w, g);
});

function checkFlee(w: World, g: Grunt, enemyId: EntityId): boolean {
  const enemy = w.get(enemyId, 'grunt');
  if (!enemy) return false;
  const water = canUseWater(g);
  const options = DIRS.map(d => ({ x: g.x + d.x, y: g.y + d.y }));
  options.sort((a, b) => distSq(b, enemy) - distSq(a, enemy));
  const r = w.randomInt(11);
  const ordered = r > 5 ? [...options.slice(r - 5), ...options.slice(0, r - 5)] : options;
  for (const p of ordered) {
    if (w.has(p.x, p.y, T.HOLE | T.PAIN | T.DEATH)) continue;
    if (canMoveTo(w, g, p, water) && move(w, g, p)) return true;
  }
  return false;
}

function distSq(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

// --- orders (player / bot commands) -----------------------------------------------------

export function startOrder(w: World, g: Grunt, order: Order, immediate = false): void {
  let task: WalkTask | undefined;
  switch (order.type) {
    case 'move':
      task = walkTask(order.x, order.y, { safe: order.safe ?? false });
      break;
    case 'attack': {
      const enemy = w.get(order.target, 'grunt');
      if (enemy) task = walkTask(enemy.x, enemy.y, { enemy: enemy.id, useTool: true, safe: false });
      break;
    }
    case 'useTool': {
      const enemy = order.target !== undefined ? w.get(order.target, 'grunt') : undefined;
      const x = enemy ? enemy.x : order.x;
      const y = enemy ? enemy.y : order.y;
      task = walkTask(x, y, { enemy: enemy?.id, useTool: true, safe: false });
      break;
    }
    case 'useToy': {
      const other = order.target !== undefined ? w.get(order.target, 'grunt') : undefined;
      const x = other ? other.x : order.x;
      const y = other ? other.y : order.y;
      task = walkTask(x, y, { useToy: true, safe: false });
      break;
    }
  }
  if (task) setTask(w, g, task, immediate);
  else if (immediate) checkIdle(w, g);
}

export function walkTask(
  tx: number,
  ty: number,
  opts: { enemy?: EntityId | undefined; useTool?: boolean; useToy?: boolean; safe: boolean },
): WalkTask {
  const task: WalkTask = {
    kind: 'walk',
    tx,
    ty,
    useTool: opts.useTool ?? false,
    useToy: opts.useToy ?? false,
    safe: opts.safe,
    blocked: 0,
  };
  if (opts.enemy !== undefined) task.enemy = opts.enemy;
  return task;
}

/** Give the grunt a task; starts right away if it can walk, else when the current action ends. */
export function setTask(w: World, g: Grunt, task: GruntTask, immediate = false): void {
  w.cancel(g.id, 'retry');
  w.edit(g, { task });
  if (immediate || canWalk(w, g)) checkIdle(w, g);
}

export function issueOrder(w: World, g: Grunt, order: Order, queue: boolean): void {
  if (isGone(g) || g.ai) return;
  if (g.action.kind === 'play' || g.frozen) {
    if (queue) w.edit(g, { orders: [...g.orders, order] });
    return;
  }
  if (queue && (g.task || g.orders.length > 0 || !isIdle(g))) {
    w.edit(g, { orders: [...g.orders, order] });
    return;
  }
  w.edit(g, { orders: [] });
  startOrder(w, g, order);
}

export function stopGrunt(w: World, g: Grunt): void {
  if (isGone(g) || g.ai) return;
  w.cancel(g.id, 'retry');
  w.edit(g, { task: null, orders: [] });
}

// --- movement ---------------------------------------------------------------------------

export function move(w: World, g: Grunt, to: Point, opts: { run?: boolean; jump?: boolean; forced?: boolean } = {}): boolean {
  if (g.action.kind === 'win') return false;
  const dx = Math.abs(to.x - g.x);
  const dy = Math.abs(to.y - g.y);
  const span = Math.max(dx, dy);
  if (span < 1 || (span > 1 && !opts.jump)) return false;
  face(w, g, to);
  const from = { x: g.x, y: g.y };
  exitTile(w, g);
  enterTile(w, g, to);
  const ticks = opts.run ? msToTicks(BOMBER_RUN_MS) : moveTicks(g) * (opts.jump ? 2 : 1);
  const extra: Partial<Action> = { fromX: from.x, fromY: from.y, tx: to.x, ty: to.y };
  if (opts.run) extra.run = true;
  if (opts.jump) extra.variant = 1;
  setAction(w, g, opts.jump ? 'jump' : 'move', ticks, extra);
  w.schedule(ticks, 'finishMove', g.id, 'action');
  return true;
}

registerTask('finishMove', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g) checkIdle(w, g);
});

export function exitTile(w: World, g: Grunt): void {
  releaseTileObjects(w, g, g.x, g.y);
}

/** Claim the target tile. Whoever stands there gets squashed. */
export function enterTile(w: World, g: Grunt, to: Point): void {
  if (g.tool === 'WINGZ' && w.has(to.x, to.y, T.FLY)) startFlying(w, g);
  const squashed = w.claimTile(g, to.x, to.y);
  if (squashed) kill(w, squashed, 'SQUASH');
}

function runBomber(w: World, g: Grunt): void {
  const d = DIRS[g.facing]!;
  const next = { x: g.x + d.x, y: g.y + d.y };
  if (canMoveTo(w, g, next, canUseWater(g))) {
    move(w, g, next, { run: true });
  } else {
    explodeBomber(w, g);
  }
}

export function explodeBomber(w: World, g: Grunt): void {
  explodeTiles(w, g, true);
}

/** Knock a grunt one tile back (glovez, nerf/sponge gun, tornadoes). */
export function knockback(w: World, g: Grunt, dir: Dir): Point | undefined {
  if (g.tool === 'GRAVITYBOOTZ') return undefined;
  const d = DIRS[dir]!;
  const to = { x: g.x + d.x, y: g.y + d.y };
  if (!canMoveTo(w, g, to, canUseWater(g))) return undefined;
  exitTile(w, g);
  enterTile(w, g, to);
  return to;
}

// --- swimming & flying ----------------------------------------------------------------

function startSwimming(w: World, g: Grunt): void {
  setAction(w, g, 'swim', msToTicks(SWIM_IN_MS), { variant: 0 });
  w.schedule(msToTicks(SWIM_IN_MS), 'enterWater', g.id, 'action');
}

registerTask('enterWater', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  if (g.tool === 'TOOB') w.edit(g, { tool: 'TOOBWATER' });
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

function endSwimming(w: World, g: Grunt): void {
  setAction(w, g, 'swim', msToTicks(SWIM_OUT_MS), { variant: 1 });
  w.schedule(msToTicks(SWIM_OUT_MS), 'exitWater', g.id, 'action');
}

registerTask('exitWater', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  if (g.tool === 'TOOBWATER') w.edit(g, { tool: 'TOOB' });
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

function startFlying(w: World, g: Grunt): void {
  if (g.flying) return;
  w.edit(g, { flying: true });
  w.schedule(msToTicks(FLY_TICK_MS), 'fly', g.id, 'fly');
}

function stopFlying(w: World, g: Grunt): void {
  if (!g.flying) return;
  w.edit(g, { flying: false });
  w.cancel(g.id, 'fly');
}

registerTask('fly', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  const flight = g.flight - 1;
  if (flight <= 0) {
    // Wingz fall off.
    w.edit(g, { flying: false, flight: 0, tool: null });
    w.fx('loseItem', g, g.id, 'WINGZ');
    if (!isGone(g) && (g.action.kind !== 'move' || w.tick >= g.action.end)) checkTileDeath(w, g);
    return;
  }
  w.edit(g, { flight });
  w.schedule(msToTicks(FLY_TICK_MS), 'fly', g.id, 'fly');
});

// --- tile effects ------------------------------------------------------------------------

/**
 * Effects of the tile the grunt just arrived at. Returns true when the tile took over
 * (death, forced arrow move, pickup animation...).
 */
export function checkTile(w: World, g: Grunt): boolean {
  if (checkTileDeath(w, g)) return true;
  if (pressTileObjects(w, g)) return true;
  const def = tileDef(w.tileAt(g.x, g.y));
  if (def.arrow !== undefined) {
    if (g.action.kind === 'move' && g.action.run) {
      explodeBomber(w, g);
      return true;
    }
    w.edit(g, { task: null });
    const d = DIRS[def.arrow]!;
    // Arrows push you on no matter what is there: they squash other gruntz.
    moveForced(w, g, { x: g.x + d.x, y: g.y + d.y });
    return true;
  }
  return false;
}

function moveForced(w: World, g: Grunt, to: Point): void {
  if (!w.inBounds(to.x, to.y)) {
    kill(w, g, 'EXPLODE');
    return;
  }
  move(w, g, to, { forced: true });
}

/** Deadly / special tile checks. Returns true if the grunt is dying or busy. */
export function checkTileDeath(w: World, g: Grunt): boolean {
  const traits = w.traits(g.x, g.y);
  if (traits & T.CRUMBLE && !w.isScheduled(0, `crumble:${g.x},${g.y}`)) {
    w.schedule(msToTicks(CRUMBLE_MS), 'crumble', 0, `crumble:${g.x},${g.y}`, g.x, g.y);
  }
  if (traits & T.PAIN) {
    if (!w.isScheduled(g.id, 'hurt')) hurt(w, g);
    if (g.tool === 'TOOB' || g.tool === 'TOOBWATER') loseTool(w, g);
    else if (g.tool === 'SPRING') loseTool(w, g);
  } else {
    w.cancel(g.id, 'hurt');
  }
  if (traits & (T.SOLID | T.NOGO)) {
    kill(w, g, 'EXPLODE');
    return true;
  }
  if (g.tool === 'WINGZ') {
    if (traits & T.FLY) startFlying(w, g);
    else stopFlying(w, g);
    return false;
  }
  if (traits & T.HOLE) {
    kill(w, g, 'HOLE');
    return true;
  }
  if (traits & T.WATER) {
    if (g.tool === 'TOOB') {
      startSwimming(w, g);
      return true;
    }
    if (!canUseWater(g)) {
      kill(w, g, 'SINK');
      return true;
    }
  } else if (g.tool === 'TOOBWATER') {
    endSwimming(w, g);
    return true;
  }
  if (traits & T.DEATH) {
    kill(w, g, THEME_DEATH[w.theme]);
    return true;
  }
  return false;
}

function loseTool(w: World, g: Grunt): void {
  w.fx('loseItem', g, g.id, g.tool ?? undefined);
  w.edit(g, { tool: null });
}

function hurt(w: World, g: Grunt): void {
  if (isGone(g)) return;
  const immune = g.tool === 'GRAVITYBOOTZ' || g.tool === 'WINGZ';
  if (!immune && g.powerup !== 'INVULNERABILITY') {
    const health = Math.max(0, g.health - SPIKES_DAMAGE);
    w.edit(g, { health });
    w.fx('hurt', g, g.id, SPIKES_DAMAGE);
  }
  if (g.health <= 0) {
    kill(w, g, 'GOO');
    return;
  }
  w.schedule(msToTicks(SPIKES_MS), 'hurt', g.id, 'hurt');
}

registerTask('hurt', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g && w.has(g.x, g.y, T.PAIN)) hurt(w, g);
});

registerTask('crumble', (w, _id, x: number, y: number) => {
  w.toggleTile(x, y);
  w.fx('crumble', { x, y });
  updateTile(w, x, y);
});

/** Re-evaluate whatever stands on a tile after the tile changed. */
export function updateTile(w: World, x: number, y: number): void {
  const g = w.gruntAt(x, y);
  if (g && !isGone(g) && !(g.action.kind === 'move' && w.tick < g.action.end)) checkTileDeath(w, g);
  const puddle = w.objectAt(x, y, 'puddle');
  if (puddle && !canPlacePuddle(w, x, y, true)) w.destroy(puddle);
}

// --- explosions ----------------------------------------------------------------------

/** 3x3 explosion around a point: breaks rocks/brickz and blows up gruntz. */
export function explodeTiles(w: World, at: Point, includeCenter: boolean): void {
  w.fx('explosion', at);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!w.inBounds(x, y)) continue;
      if (!includeCenter && dx === 0 && dy === 0) continue;
      if (w.has(x, y, T.BREAK)) breakTile(w, { x, y }, true);
      const g = w.gruntAt(x, y);
      if (g && !isGone(g) && g.powerup !== 'INVULNERABILITY') kill(w, g, 'EXPLODE');
    }
  }
}

export function breakTile(w: World, at: Point, explosion: boolean, by?: Grunt): void {
  breakAt(w, at, explosion, by);
}

// --- death -----------------------------------------------------------------------------

/** Death animation lengths from the original game (ms). */
const DEATH_MS: Record<DeathKind, number> = {
  BURN: 2260,
  EXPLODE: 480,
  ELECTROCUTE: 3250,
  MELT: 600,
  FALL: 7680,
  GOO: 3500,
  HOLE: 1300,
  KARAOKE: 13650,
  SINK: 1850,
  SQUASH: 600,
  SHATTER: 2000,
};

export function kill(w: World, g: Grunt, kind: DeathKind): void {
  if (isGone(g)) return;
  if (kind === 'GOO' && g.tool === 'BOMB') {
    // A bomber that runs out of health goes off.
    explodeTiles(w, g, true);
    if (isGone(g)) return;
  }
  // Only "gooey" deaths leave a puddle behind (welder and gravity bootz gruntz don't).
  const puddle = (kind === 'GOO' && g.tool !== 'WELDER' && g.tool !== 'GRAVITYBOOTZ') || kind === 'MELT';
  interruptToy(w, g);
  w.cancelAll(g.id);
  aiOnDeath(w, g);
  const ticks = msToTicks(DEATH_MS[kind]);
  // The dead grunt stops blocking its tile right away.
  releaseTileObjects(w, g, g.x, g.y);
  const i = w.index(g.x, g.y);
  if (w.occupancy.get(i) === g.id) w.occupancy.delete(i);
  w.edit(g, { task: null, orders: [], health: 0, flying: false, frozen: false });
  setAction(w, g, 'death', ticks, { item: kind });
  w.fx('death', g, g.id, kind);
  const team = w.team(g.team);
  if (team) w.edit(team, { stats: { ...team.stats, deaths: team.stats.deaths + 1 } });
  if (puddle && canPlacePuddle(w, g.x, g.y, false)) {
    w.spawn<Puddle>({ kind: 'puddle', x: g.x, y: g.y, team: g.team, sucking: -1 });
  }
  w.schedule(ticks, 'finishDeath', g.id, 'action');
}

registerTask('finishDeath', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  const team = g.team;
  w.destroy(g);
  w.onGruntDied(team);
});

export function canPlacePuddle(w: World, x: number, y: number, existing: boolean): boolean {
  if (!existing && w.objectAt(x, y, 'puddle')) return false;
  return (w.traits(x, y) & (T.SOLID | T.WATER | T.DEATH | T.HOLE)) === 0;
}

export function heal(w: World, g: Grunt, amount: number): void {
  w.edit(g, { health: Math.min(MAX_HEALTH, g.health + amount) });
}
