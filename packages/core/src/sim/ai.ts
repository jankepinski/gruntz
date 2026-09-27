import { TOOL_INFO, type ToolId } from '../data/items.ts';
import { T } from '../data/tiles.ts';
import { chebyshev, DIRS, eq, type Point } from '../point.ts';
import { alertDistance, chase, posesThreat } from './combat.ts';
import { combatTool, hasFullStamina, isGone, isIdle, move, setTask, walkTask } from './grunt.ts';
import { canMoveTo, canUseWater, Flood, floodOptions } from './path.ts';
import { useToyOn } from './toys.ts';
import type { Grunt, Pickup, WalkTask } from './types.ts';
import { registerTask, type World } from './world.ts';

/*
 * Behaviour of enemy gruntz in Quest levels. Colour tells the type:
 * light green = Chaser, dark purple = PostGuard (short chase), dark green = SmartChaser
 * (only picks on weaker gruntz), yellow = HitAndRun, black = ToolThief, white = Toyer,
 * red = Bomber, dark red = TimeBomber, plus worker gruntz that lay bricks, dig, break
 * rocks or suck up goo.
 */

const THINK_MIN = 20;
const THINK_RANDOM = 40;

/** An enemy walked onto a tile near AI gruntz. */
export function aiNotice(w: World, intruder: Grunt): void {
  for (const g of w.all('grunt')) {
    if (!g.ai || g.id === intruder.id || isGone(g)) continue;
    if (!isIdle(g) || !hasFullStamina(w, g)) continue;
    if (posesThreat(w, g, intruder)) think(w, g);
  }
}

export function aiOnIdle(w: World, g: Grunt): boolean {
  return think(w, g);
}

registerTask('aiThink', (w, id) => {
  const g = w.get(id, 'grunt');
  if (g && isIdle(g) && !g.task) think(w, g);
});

function think(w: World, g: Grunt): boolean {
  if (!g.ai || isGone(g) || g.frozen) return false;
  if (hasFullStamina(w, g) && findEnemy(w, g)) return true;
  switch (g.ai) {
    case 'BrickLayer':
      if (workNear(w, g, T.LAY, p => !w.gruntAt(p.x, p.y) && (w.objectAt(p.x, p.y, 'brickz')?.layers.length ?? 0) < 3))
        return true;
      break;
    case 'GooSucker':
      if (suckGoo(w, g)) return true;
      break;
    case 'Digger':
      if (workNear(w, g, T.MOUND)) return true;
      break;
    case 'RockBreaker':
      if (workNear(w, g, T.BREAK)) return true;
      break;
    case 'Defender':
    case 'ObjectGuard':
      if (!eq(g, { x: g.guardX, y: g.guardY })) {
        setTask(w, g, walkTask(g.guardX, g.guardY, { safe: true }));
        if (g.task) return true;
      }
      break;
    case 'TimeBomber': {
      const bomb = nearestBomb(w, g);
      if (bomb) {
        const away = { x: g.x + Math.sign(g.x - bomb.x) * 2, y: g.y + Math.sign(g.y - bomb.y) * 2 };
        setTask(w, g, walkTask(away.x, away.y, { safe: true }));
        if (g.task) return true;
      }
      break;
    }
  }
  idleMove(w, g);
  return true;
}

function findEnemy(w: World, g: Grunt): boolean {
  if (g.ai === 'Toyer' && !g.toy) return false;
  const range = alertDistance(g) + 2;
  const candidates: Grunt[] = [];
  for (const other of w.all('grunt')) {
    if (other.id === g.id || isGone(other)) continue;
    if (chebyshev(g, other) > range) continue;
    if (!posesThreat(w, g, other)) continue;
    if (g.ai === 'SmartChaser' && isWeaker(g, other)) continue;
    candidates.push(other);
  }
  candidates.sort((a, b) => chebyshev(g, a) - chebyshev(g, b) || a.id - b.id);
  for (const enemy of candidates) if (chase(w, g, enemy)) return true;
  return false;
}

/** Is `g` weaker than `enemy` (compares tool damage)? */
function isWeaker(g: Grunt, enemy: Grunt): boolean {
  return TOOL_INFO[combatTool(enemy)].damage > TOOL_INFO[combatTool(g)].damage;
}

function workNear(w: World, g: Grunt, trait: number, ok: (p: Point) => boolean = () => true): boolean {
  if (!hasFullStamina(w, g)) return false;
  const r = alertDistance(g) + 1;
  const tiles: Point[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const p = { x: g.x + dx, y: g.y + dy };
      if (w.has(p.x, p.y, trait) && ok(p)) tiles.push(p);
    }
  while (tiles.length > 0) {
    const [target] = tiles.splice(w.randomInt(tiles.length), 1);
    const flood = new Flood(w, target!, g.team, floodOptions(w, g, true), g);
    if (flood.reaches(g)) {
      setTask(w, g, walkTask(target!.x, target!.y, { useTool: true, safe: true }));
      if (g.task || !isIdle(g)) return true;
    }
  }
  return false;
}

function suckGoo(w: World, g: Grunt): boolean {
  if (g.tool !== 'GOOBER' || !hasFullStamina(w, g)) return false;
  const r = alertDistance(g) + 1;
  for (const p of w.all('puddle')) {
    if (p.sucking >= 0 || chebyshev(g, p) > r) continue;
    setTask(w, g, walkTask(p.x, p.y, { useTool: true, safe: true }));
    if (g.task || !isIdle(g)) return true;
  }
  return false;
}

function nearestBomb(w: World, g: Grunt) {
  for (const b of w.all('timebomb')) if (chebyshev(g, b) <= 1) return b;
  return undefined;
}

/** Idle shuffling around the guard point, then think again later. */
function idleMove(w: World, g: Grunt): void {
  if (w.random() < 0.35) {
    const dir = w.randomInt(8);
    const d = DIRS[dir]!;
    const to = { x: g.x + d.x, y: g.y + d.y };
    const nearHome = chebyshev(to, { x: g.guardX, y: g.guardY }) <= 2;
    const safe = (w.traits(to.x, to.y) & (T.HOLE | T.PAIN | T.DEATH | T.ARROW | T.CRUMBLE)) === 0;
    if (nearHome && safe && canMoveTo(w, g, to, canUseWater(g)) && !w.objectAt(to.x, to.y, 'switch')) {
      move(w, g, to);
      return;
    }
  }
  w.schedule(THINK_MIN + w.randomInt(THINK_RANDOM), 'aiThink', g.id, 'think');
}

export function aiOnWalk(w: World, g: Grunt, task: WalkTask): WalkTask | undefined {
  if (task.enemy === undefined) {
    if (g.ai === 'Defender' && hasFullStamina(w, g) && findEnemy(w, g)) return undefined;
    return task;
  }
  const enemy = w.get(task.enemy, 'grunt');
  if (!enemy || isGone(enemy)) {
    w.edit(g, { task: null });
    return undefined;
  }
  if (g.ai === 'Defender' || g.ai === 'ObjectGuard') {
    if (chebyshev({ x: g.guardX, y: g.guardY }, enemy) > alertDistance(g) + 2) {
      const home = walkTask(g.guardX, g.guardY, { safe: true });
      w.edit(g, { task: home });
      return home;
    }
  }
  if (g.ai === 'SmartChaser' && isWeaker(g, enemy)) return undefined;
  // Keep following the enemy wherever it goes.
  if (enemy.x !== task.tx || enemy.y !== task.ty) {
    const flood = new Flood(w, enemy, g.team, floodOptions(w, g, task.safe), g);
    if (flood.reaches(g) || TOOL_INFO[combatTool(g)].ranged) {
      const next = { ...task, tx: enemy.x, ty: enemy.y };
      w.edit(g, { task: next });
      return next;
    }
  }
  return task;
}

export function aiOnChase(_w: World, g: Grunt, enemy: Grunt, _hasPath: boolean): boolean {
  // Post guards only fight what is right next to them.
  if (g.ai === 'PostGuard' && chebyshev(g, enemy) > 1) return false;
  return true;
}

export function aiOnEngage(w: World, g: Grunt, enemy: Grunt): boolean {
  if (g.ai === 'ToolThief' && !g.tool && enemy.tool && enemy.tool !== 'WARPSTONE' && enemy.tool !== 'TOOBWATER') {
    w.edit(g, { tool: enemy.tool });
    w.edit(enemy, { tool: null });
    w.fx('steal', enemy, g.id, g.tool ?? undefined);
    return false;
  }
  if (g.ai === 'Toyer' && g.toy) {
    useToyOn(w, g, enemy);
    idleMove(w, g);
    return true;
  }
  return false;
}

export function aiOnAttack(w: World, g: Grunt, enemy: Grunt): void {
  if (g.ai === 'HitAndRun') w.edit(g, { task: { kind: 'flee', enemy: enemy.id } });
}

export function aiOnRangedAttack(w: World, target: Grunt, attacker: Grunt): void {
  if (target.ai === 'HitAndRun') w.edit(target, { task: { kind: 'flee', enemy: attacker.id } });
}

export function aiOnStruck(w: World, g: Grunt, enemy: Grunt | undefined): void {
  if (!enemy) return;
  if (g.ai === 'HitAndRun' && !hasFullStamina(w, g)) w.edit(g, { task: { kind: 'flee', enemy: enemy.id } });
}

export function aiOnDeath(w: World, g: Grunt): void {
  // Killing a tool thief gives the stolen tool back.
  if (g.ai === 'ToolThief' && g.tool && g.tool !== 'TOOBWATER') {
    w.spawn<Pickup>({ kind: 'pickup', x: g.x, y: g.y, item: g.tool as ToolId });
  }
}

export function canBomberCharge(g: Grunt, target: Point): boolean {
  const dx = target.x - g.x;
  const dy = target.y - g.y;
  return (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && (dx !== 0 || dy !== 0);
}
