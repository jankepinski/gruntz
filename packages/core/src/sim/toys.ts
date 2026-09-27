import { MAX_HEALTH, msToTicks } from '../constants.ts';
import { SPELL_RADIUS, TOY_INFO, TOYS, type SpellId, type ToyId } from '../data/items.ts';
import { T } from '../data/tiles.ts';
import { DIRS, type Point } from '../point.ts';
import { interrupt } from './combat.ts';
import { areEnemies, checkIdle, checkTile, enterTile, exitTile, face, isGone, setAction, spawnGrunt } from './grunt.ts';
import { spawnRollingBall } from './hazards.ts';
import { canMoveTo } from './path.ts';
import type { Grunt, Pickup } from './types.ts';
import { registerTask, type World } from './world.ts';

const FREEZE_MS = 10000;
const UNFREEZE_MS = 2000;
const RESURRECT_HEALTH = 5;
const SPELL_BALL_MS = 5000;

/** Give our toy to another grunt (or read our own scroll). */
export function useToyOn(w: World, g: Grunt, target: Grunt): void {
  const toy = g.toy;
  if (!toy) return;
  const own = target.id === g.id;
  if (!own) {
    face(w, g, target);
    w.edit(g, { toy: null, spell: null, task: null });
    w.fx('giveToy', target, target.id, toy);
  }
  if (!own || toy === 'SCROLL') {
    interrupt(w, target);
    playToy(w, target, toy, own ? g.spell : null, own);
  }
  if (!own) checkIdle(w, g);
}

/** Start playing with a toy (can't be controlled until it breaks). */
export function playToy(w: World, g: Grunt, toy: ToyId, spell: SpellId | null, own: boolean): void {
  if (isGone(g)) return;
  const info = TOY_INFO[toy];
  const duration = msToTicks(info.duration);
  w.edit(g, { task: null, toyEnd: w.tick + duration });
  setAction(w, g, 'play', duration, { item: toy, variant: own ? 1 : 0 });
  if (own && toy === 'SCROLL') w.edit(g, { toy: null, spell: null });
  w.schedule(duration, 'breakToy', g.id, 'toy', spell ?? '');
  if (info.rate) w.schedule(msToTicks(info.rate), 'travelToy', g.id, 'travel', info.tiles ?? 1, -1);
}

registerTask('travelToy', (w, id, left: number, dir: number) => {
  const g = w.get(id, 'grunt');
  if (!g || g.action.kind !== 'play' || isGone(g)) return;
  const toy = g.action.item as ToyId;
  const info = TOY_INFO[toy];
  if (checkTile(w, g)) return; // rode into something deadly
  let nextDir = dir;
  let nextLeft = left - 1;
  const straight = dir >= 0 ? { x: g.x + DIRS[dir]!.x, y: g.y + DIRS[dir]!.y } : undefined;
  if (!straight || nextLeft <= 0 || !canMoveTo(w, g, straight, false)) {
    const options: number[] = [];
    for (let d = 0; d < 8; d += 2) {
      const p = { x: g.x + DIRS[d]!.x, y: g.y + DIRS[d]!.y };
      if (canMoveTo(w, g, p, false)) options.push(d);
    }
    if (options.length === 0) {
      breakToy(w, g);
      return;
    }
    nextDir = options[w.randomInt(options.length)]!;
    nextLeft = info.tiles ?? 1;
  }
  const to = { x: g.x + DIRS[nextDir]!.x, y: g.y + DIRS[nextDir]!.y };
  const from = { x: g.x, y: g.y };
  face(w, g, to);
  exitTile(w, g);
  enterTile(w, g, to);
  const rate = msToTicks(info.rate ?? 1000);
  w.edit(g, {
    action: { ...g.action, moving: true, fromX: from.x, fromY: from.y, tx: to.x, ty: to.y, variant: w.tick },
  });
  w.schedule(rate, 'travelToy', g.id, 'travel', nextLeft, nextDir);
});

registerTask('breakToy', (w, id, spell: string) => {
  const g = w.get(id, 'grunt');
  if (g) breakToy(w, g, (spell || null) as SpellId | null);
});

function breakToy(w: World, g: Grunt, spell: SpellId | null = null): void {
  if (g.action.kind !== 'play') return;
  const toy = g.action.item as ToyId;
  interruptToy(w, g);
  if (toy === 'SCROLL' && spell) castSpell(w, g, spell);
  const ticks = msToTicks(TOY_INFO[toy].breakDuration);
  setAction(w, g, 'play', ticks, { item: toy, variant: 2 });
  w.schedule(ticks, 'finishToy', g.id, 'action');
}

registerTask('finishToy', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'idle', 0);
  w.edit(g, { toyEnd: 0 });
  checkIdle(w, g);
});

export function interruptToy(w: World, g: Grunt): void {
  w.cancel(g.id, 'toy');
  w.cancel(g.id, 'travel');
}

/** Put the toy down in a toybox: an enemy walking over it starts playing. */
export function placeToybox(w: World, g: Grunt, at: Point): boolean {
  if (!g.toy || g.toy === 'SCROLL') return false;
  if (w.traits(at.x, at.y) & (T.SOLID | T.NOGO)) return false;
  if (w.objectAt(at.x, at.y, 'pickup')) return false;
  w.spawn<Pickup>({ kind: 'pickup', x: at.x, y: at.y, item: 'TOYBOX', toy: g.toy, team: g.team });
  w.edit(g, { toy: null });
  w.fx('toybox', at, g.id);
  return true;
}

// --- spells --------------------------------------------------------------------------

function around(w: World, c: Point, fn: (x: number, y: number) => void): void {
  for (let dy = -SPELL_RADIUS; dy <= SPELL_RADIUS; dy++)
    for (let dx = -SPELL_RADIUS; dx <= SPELL_RADIUS; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (w.inBounds(x, y)) fn(x, y);
    }
}

export function castSpell(w: World, caster: Grunt, spell: SpellId): void {
  w.fx('spell', caster, caster.id, spell);
  switch (spell) {
    case 'FREEZE':
      around(w, caster, (x, y) => {
        const g = w.gruntAt(x, y);
        if (g && g.id !== caster.id && !isGone(g)) freeze(w, g);
      });
      break;
    case 'HEALTH':
      around(w, caster, (x, y) => {
        const g = w.gruntAt(x, y);
        if (g && g.id !== caster.id && !isGone(g)) w.edit(g, { health: MAX_HEALTH });
      });
      break;
    case 'RESURRECT':
      around(w, caster, (x, y) => {
        const puddle = w.objectAt(x, y, 'puddle');
        if (!puddle || w.gruntAt(x, y)) return;
        w.destroy(puddle);
        spawnGrunt(w, { team: caster.team, x, y, health: RESURRECT_HEALTH });
      });
      break;
    case 'TOYZ':
      // Every enemy nearby gets a random toy to play with.
      around(w, caster, (x, y) => {
        const g = w.gruntAt(x, y);
        if (g && !isGone(g) && areEnemies(w, caster.team, g.team)) {
          const toys = TOYS.filter(t => t !== 'SCROLL');
          interrupt(w, g);
          playToy(w, g, toys[w.randomInt(toys.length)]!, null, false);
        }
      });
      break;
    case 'TELEPORT': {
      const free: Point[] = [];
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x < w.width; x++)
          if ((w.traits(x, y) & (T.SOLID | T.NOGO | T.WATER | T.DEATH | T.HOLE | T.PAIN | T.ARROW)) === 0 && !w.gruntAt(x, y))
            free.push({ x, y });
      if (free.length > 0) {
        const to = free[w.randomInt(free.length)]!;
        exitTile(w, caster);
        enterTile(w, caster, to);
      }
      break;
    }
    case 'ROLLINGBALLZ':
      for (const dir of [0, 2, 4, 6] as const) {
        const d = DIRS[dir]!;
        spawnRollingBall(w, caster.x + d.x, caster.y + d.y, dir, msToTicks(200), msToTicks(SPELL_BALL_MS));
      }
      break;
  }
}

export function freeze(w: World, g: Grunt): void {
  freezeFor(w, g, FREEZE_MS);
}

export function freezeFor(w: World, g: Grunt, ms: number): void {
  interrupt(w, g);
  w.edit(g, { frozen: true, task: null });
  setAction(w, g, 'struck', msToTicks(ms), { item: 'FREEZE' });
  w.schedule(msToTicks(ms), 'unfreeze', g.id, 'action');
}

registerTask('unfreeze', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'struck', msToTicks(UNFREEZE_MS), { item: 'UNFREEZE' });
  w.schedule(msToTicks(UNFREEZE_MS), 'thawed', g.id, 'action');
});

registerTask('thawed', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  w.edit(g, { frozen: false });
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});
