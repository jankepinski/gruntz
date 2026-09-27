import { MAX_HEALTH, msToTicks } from '../constants.ts';
import { NO_MELEE_TOOLS, TOOL_INFO } from '../data/items.ts';
import { chebyshev, dirBetween, type Dir, type Point } from '../point.ts';
import { aiOnAttack, aiOnChase, aiOnEngage, aiOnRangedAttack, aiOnStruck } from './ai.ts';
import {
  areEnemies,
  canWalk,
  chargeStamina,
  checkIdle,
  combatTool,
  explodeTiles,
  face,
  hasFullStamina,
  isGone,
  kill,
  knockback,
  setAction,
  walkTask,
} from './grunt.ts';
import { Flood, floodOptions } from './path.ts';
import { interruptToy, useToyOn } from './toys.ts';
import type { Grunt, Projectile, ProjectileType } from './types.ts';
import { registerTask, type World } from './world.ts';

const IMPACT_MS = 500;

export function alertDistance(g: Grunt): number {
  const info = TOOL_INFO[combatTool(g)];
  return g.alert + (info.range ? info.range - 2 : 0);
}

/** Should `g` consider `enemy` a target right now? */
export function posesThreat(w: World, g: Grunt, enemy: Grunt): boolean {
  if (!areEnemies(w, g.team, enemy.team)) return false;
  if (isGone(enemy) || enemy.health <= 0) return false;
  if (enemy.powerup === 'GHOST') return false;
  return chebyshev(g, enemy) <= alertDistance(g) + 2;
}

/** A player grunt keeps after an enemy it was told to attack while there is one to hit. */
function canPursue(w: World, g: Grunt, enemy: Grunt): boolean {
  if (!areEnemies(w, g.team, enemy.team)) return false;
  if (isGone(enemy) || enemy.health <= 0) return false;
  return enemy.powerup !== 'GHOST';
}

/** Walk towards an enemy and fight it. */
export function chase(w: World, g: Grunt, enemy: Grunt): boolean {
  if (!canWalk(w, g) && g.action.kind !== 'move') return false;
  // AI gruntz only chase what is close; a player's order to attack is followed anywhere.
  const pursue = g.ai === null ? canPursue(w, g, enemy) : posesThreat(w, g, enemy);
  if (!pursue) {
    w.edit(g, { task: null });
    return false;
  }
  const flood = new Flood(w, enemy, g.team, floodOptions(w, g, g.ai !== null), g);
  const hasPath = flood.reaches(g);
  if (!aiOnChase(w, g, enemy, hasPath)) return false;
  if (chebyshev(g, enemy) <= 1 && engage(w, g, enemy, false)) return true;
  if (hasPath || canUseRanged(g, enemy)) {
    const task = walkTask(enemy.x, enemy.y, { enemy: enemy.id, useTool: true, safe: g.ai !== null });
    w.edit(g, { task });
    if (canWalk(w, g)) {
      checkIdle(w, g);
      return g.task !== null || !canWalk(w, g);
    }
    return true;
  }
  return false;
}

/** Attack (or toy) an enemy in reach. */
export function engage(w: World, g: Grunt, enemy: Grunt, useToy: boolean): boolean {
  if (!useToy && useRangedTool(w, g, enemy, enemy)) return true;
  if (enemy.id !== g.id && chebyshev(g, enemy) > 1) return false;
  if (useToy) {
    useToyOn(w, g, enemy);
    return true;
  }
  return attack(w, g, enemy);
}

export function attack(w: World, g: Grunt, enemy: Grunt): boolean {
  const tool = combatTool(g);
  const info = TOOL_INFO[tool];
  if (info.ranged || NO_MELEE_TOOLS.has(tool)) return false;
  if (isGone(enemy)) return false;
  if (!hasFullStamina(w, g)) {
    if (g.action.kind !== 'attackIdle') setAction(w, g, 'attackIdle', 0);
    return true;
  }
  if (aiOnEngage(w, g, enemy)) return true;
  face(w, g, enemy);
  w.edit(g, { task: { kind: 'follow', enemy: enemy.id } });
  const delay = msToTicks(info.attackDelay);
  const variant = w.randomInt(2);
  setAction(w, g, 'attack', delay + msToTicks(info.attackIdle), { variant, tx: enemy.x, ty: enemy.y, item: tool });
  w.schedule(delay, 'performAttack', g.id, 'action', enemy.id);
  return true;
}

registerTask('performAttack', (w, id, enemyId: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  const enemy = w.get(enemyId, 'grunt');
  const info = TOOL_INFO[combatTool(g)];
  chargeStamina(w, g, true);
  if (enemy && !isGone(enemy) && chebyshev(g, enemy) <= 1) {
    struckByGrunt(w, enemy, g, info.damage);
  }
  w.schedule(msToTicks(info.attackIdle), 'finishAttack', g.id, 'action', enemyId);
});

registerTask('finishAttack', (w, id, enemyId: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'attackIdle', 0);
  const enemy = w.get(enemyId, 'grunt');
  if (enemy) aiOnAttack(w, g, enemy);
  checkIdle(w, g);
});

// --- being hit -------------------------------------------------------------------

const NO_DAMAGE_VS_SHIELD = new Set(['NONE', 'GLOVEZ', 'SHIELD']);

export function struckByGrunt(w: World, g: Grunt, attacker: Grunt, damage: number): void {
  if (isGone(g)) return;
  const attackerTool = combatTool(attacker);
  const slide = attackerTool === 'GLOVEZ' ? dirBetween(attacker, g) : undefined;
  if (g.tool === 'SHIELD') {
    damage = NO_DAMAGE_VS_SHIELD.has(attackerTool) ? 0 : Math.floor(damage / 2);
  }
  if (g.powerup === 'REACTIVEARMOR') {
    const reflected = Math.round(damage * 0.75);
    damage -= reflected;
    w.edit(attacker, { health: Math.max(0, attacker.health - reflected) });
  }
  if (attacker.powerup === 'CONVERSION') {
    // The victim joins the attacker's team for the rest of the game.
    interruptToy(w, g);
    w.edit(g, { team: attacker.team, task: null, orders: [], ai: null });
    w.edit(attacker, { health: Math.min(MAX_HEALTH, attacker.health + 5) });
    w.fx('convert', g, g.id, attacker.team);
    return;
  }
  const before = g.health;
  struckForDamage(w, g, damage, slide);
  if (before > 0 && g.health <= 0) creditKill(w, attacker.team);
  if (!isGone(g) && !g.ai && areEnemies(w, g.team, attacker.team) && g.task === null && g.orders.length === 0) {
    // Gruntz fight back on their own.
    w.edit(g, { task: { kind: 'follow', enemy: attacker.id } });
  } else if (!isGone(g) && g.ai) {
    w.edit(g, { task: { kind: 'follow', enemy: attacker.id } });
  }
  face(w, g, attacker);
}

function creditKill(w: World, team: number): void {
  const t = w.team(team);
  if (t) w.edit(t, { stats: { ...t.stats, kills: t.stats.kills + 1 } });
}

/**
 * Stop whatever the grunt is doing. A grunt interrupted in the middle of a step snaps
 * back to the tile it came from (if still free), like the original.
 */
export function interrupt(w: World, g: Grunt): void {
  interruptToy(w, g);
  w.cancel(g.id, 'action');
  w.cancel(g.id, 'retry');
  const a = g.action;
  if ((a.kind === 'move' || a.kind === 'jump') && w.tick < a.end && a.fromX !== undefined && a.fromY !== undefined) {
    if (!w.gruntAt(a.fromX, a.fromY)) w.claimTile(g, a.fromX, a.fromY);
  }
}

export function struckForDamage(w: World, g: Grunt, damage: number, slide?: Dir): void {
  if (isGone(g)) return;
  if (g.powerup !== 'INVULNERABILITY') interrupt(w, g);
  if (g.tool === 'BOMB') {
    explodeTiles(w, g, true);
    return;
  }
  if (g.frozen) {
    kill(w, g, 'SHATTER');
    return;
  }
  let slidTo: Point | undefined;
  if (slide !== undefined) slidTo = knockback(w, g, slide);
  if (g.powerup === 'INVULNERABILITY') return;
  const health = Math.max(0, g.health - damage);
  const info = TOOL_INFO[combatTool(g)];
  const ticks = msToTicks(info.struck);
  w.edit(g, { health });
  w.fx('hit', g, g.id, damage);
  const extra: Record<string, number> = { variant: w.randomInt(2) };
  if (slidTo) {
    extra.tx = slidTo.x;
    extra.ty = slidTo.y;
  }
  setAction(w, g, 'struck', ticks, extra);
  w.schedule(ticks, 'finishStruck', g.id, 'action');
}

registerTask('finishStruck', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'attackIdle', 0);
  const enemy = g.task?.kind === 'follow' ? w.get(g.task.enemy, 'grunt') : undefined;
  aiOnStruck(w, g, enemy);
  checkIdle(w, g);
});

// --- ranged ------------------------------------------------------------------------

export function canUseRanged(g: Grunt, target: Point): boolean {
  const info = TOOL_INFO[combatTool(g)];
  if (!info.ranged || !info.range) return false;
  const d = chebyshev(g, target);
  return d >= 1 && d <= info.range;
}

/** Fire the grunt's ranged tool at a tile (or enemy) if in range. */
export function useRangedTool(w: World, g: Grunt, target: Point, enemy?: Grunt): boolean {
  if (!canUseRanged(g, target)) return false;
  if (!hasFullStamina(w, g)) {
    if (enemy) {
      if (g.action.kind !== 'attackIdle') setAction(w, g, 'attackIdle', 0);
      return true;
    }
    return false;
  }
  const tool = combatTool(g);
  const info = TOOL_INFO[tool];
  face(w, g, target);
  const delay = msToTicks(info.attackDelay);
  setAction(w, g, 'throw', delay + msToTicks(info.attackIdle), { tx: target.x, ty: target.y, item: tool });
  if (enemy) w.edit(g, { task: { kind: 'follow', enemy: enemy.id } });
  w.schedule(delay, 'throwProjectile', g.id, 'action', target.x, target.y, enemy?.id ?? -1);
  return true;
}

registerTask('throwProjectile', (w, id, tx: number, ty: number, enemyId: number) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  const tool = combatTool(g);
  const info = TOOL_INFO[tool];
  chargeStamina(w, g, true);
  const type = tool as ProjectileType;
  const duration = msToTicks(info.throwDuration ?? 1000);
  const p = w.spawn<Projectile>({
    kind: 'projectile',
    type,
    owner: g.id,
    team: g.team,
    x: tx,
    y: ty,
    fromX: g.x,
    fromY: g.y,
    tx,
    ty,
    start: w.tick,
    end: w.tick + duration,
    damage: info.damage,
    hit: [],
    state: 'fly',
  });
  if (type === 'BOOMERANG') w.edit(g, { tool: null });
  w.fx('throw', g, g.id, type);
  w.schedule(duration, 'projectileImpact', p.id, 'impact');
  if (type === 'BOOMERANG' || type === 'WINGZ') w.schedule(1, 'projectileFly', p.id, 'fly');
  w.schedule(msToTicks(info.attackIdle), 'finishAttack', g.id, 'action', enemyId);
  const enemy = w.get(enemyId, 'grunt');
  if (enemy) aiOnRangedAttack(w, enemy, g);
});

/** Position of a projectile at a tick (tile units, fractional). */
export function projectilePosition(p: Projectile, tick: number): Point {
  const t = Math.max(0, Math.min(1, (tick - p.start) / Math.max(1, p.end - p.start)));
  if (p.type === 'BOOMERANG') {
    // Circle through the thrower and the target and back.
    const cx = (p.fromX + p.tx) / 2;
    const cy = (p.fromY + p.ty) / 2;
    const rx = p.fromX - cx;
    const ry = p.fromY - cy;
    const a = t * Math.PI * 2;
    return { x: cx + rx * Math.cos(a) - ry * Math.sin(a), y: cy + rx * Math.sin(a) + ry * Math.cos(a) };
  }
  return { x: p.fromX + (p.tx - p.fromX) * t, y: p.fromY + (p.ty - p.fromY) * t };
}

registerTask('projectileFly', (w, id) => {
  const p = w.get(id, 'projectile');
  if (!p || p.state !== 'fly') return;
  const pos = projectilePosition(p, w.tick);
  hitAt(w, p, { x: Math.round(pos.x), y: Math.round(pos.y) });
  w.schedule(1, 'projectileFly', p.id, 'fly');
});

registerTask('projectileImpact', (w, id) => {
  const p = w.get(id, 'projectile');
  if (!p) return;
  w.cancel(p.id, 'fly');
  if (p.type === 'BOOMERANG') {
    const owner = w.get(p.owner, 'grunt');
    if (
      owner &&
      owner.x === p.fromX &&
      owner.y === p.fromY &&
      owner.tool === null &&
      !isGone(owner) &&
      owner.action.kind !== 'play'
    ) {
      w.edit(owner, { tool: 'BOOMERANG' });
    }
    w.destroy(p);
    return;
  }
  w.edit(p, { state: 'impact' });
  w.fx('impact', { x: p.tx, y: p.ty }, p.id, p.type);
  hitAt(w, p, { x: p.tx, y: p.ty });
  w.schedule(msToTicks(IMPACT_MS), 'projectileGone', p.id, 'impact');
});

registerTask('projectileGone', (w, id) => {
  const p = w.get(id, 'projectile');
  if (p) w.destroy(p);
});

function hitAt(w: World, p: Projectile, at: Point): void {
  const g = w.gruntAt(at.x, at.y);
  if (!g || g.id === p.owner || p.hit.includes(g.id) || isGone(g)) return;
  w.edit(p, { hit: [...p.hit, g.id] });
  struckByProjectile(w, g, p);
}

export function struckByProjectile(w: World, g: Grunt, p: Projectile): void {
  if (isGone(g)) return;
  const gunhat = g.tool === 'GUNHAT';
  if (p.type === 'WELDER' && !gunhat && g.powerup !== 'INVULNERABILITY') {
    kill(w, g, 'BURN');
    creditKill(w, p.team);
    return;
  }
  let slide: Dir | undefined;
  if (p.type === 'NERFGUN') slide = dirBetween({ x: p.fromX, y: p.fromY }, { x: p.tx, y: p.ty });
  if (p.type === 'WINGZ') slide = w.randomInt(8) as Dir; // tornadoes throw you anywhere
  const damage = gunhat ? Math.floor(p.damage / 2) : p.damage;
  const before = g.health;
  struckForDamage(w, g, damage, slide);
  if (before > 0 && g.health <= 0) creditKill(w, p.team);
}
