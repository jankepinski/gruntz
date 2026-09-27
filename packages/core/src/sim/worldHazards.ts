import { msToTicks } from '../constants.ts';
import { TOY_INFO, type ToyId } from '../data/items.ts';
import { DIRS, type Dir, type Point } from '../point.ts';
import { isGone, kill } from './grunt.ts';
import type { Cloud, DeathKind, Dropper, Grunt, Poop, Slime, SpotLight, StaticHazard, Ufo } from './types.ts';
import { registerTask, type ThemeId, type World } from './world.ts';

/**
 * Hazards that belong to a world: lava geysers, candles, trapdoors and electric outlets
 * (static hazards), birds and planes that drop things on your gruntz, storm clouds,
 * UFOs, "star search" spotlights and kitchen slime. Timings follow the original game;
 * distances were given in pixels (32 per tile) and are converted to tiles here.
 */

const TILE = 32;

/** Where a grunt is right now, between tiles while it walks (tile units). */
export function gruntPosition(g: Grunt, tick: number): Point {
  const a = g.action;
  if ((a.kind === 'move' || a.kind === 'jump') && a.fromX !== undefined && a.fromY !== undefined) {
    const t = Math.max(0, Math.min(1, (tick - a.start) / Math.max(1, a.end - a.start)));
    return { x: a.fromX + (g.x - a.fromX) * t, y: a.fromY + (g.y - a.fromY) * t };
  }
  if (a.kind === 'play' && a.moving && a.fromX !== undefined && a.fromY !== undefined && a.variant !== undefined) {
    const rate = msToTicks(TOY_INFO[a.item as ToyId]?.rate ?? 600);
    const t = Math.max(0, Math.min(1, (tick - a.variant) / rate));
    return { x: a.fromX + (g.x - a.fromX) * t, y: a.fromY + (g.y - a.fromY) * t };
  }
  return { x: g.x, y: g.y };
}

/** Gruntz close to a point. Ground hazards miss gruntz flying over them on wingz. */
function near(w: World, at: Point, radiusTiles: number, fn: (g: Grunt) => void, ground = true): void {
  for (const g of w.all('grunt')) {
    if (isGone(g) || (ground && g.flying)) continue;
    if (Math.abs(g.x - at.x) > radiusTiles + 1.5 || Math.abs(g.y - at.y) > radiusTiles + 1.5) continue;
    const p = gruntPosition(g, w.tick);
    if (Math.hypot(p.x - at.x, p.y - at.y) <= radiusTiles) fn(g);
  }
}

// --- static hazards ------------------------------------------------------------------------

export interface StaticHazardInfo {
  /** Whole emission in ms. */
  time: number;
  /** When it starts to kill within an emission. */
  killTime: number;
  death: DeathKind;
}

const STATIC_KILL_MS = 250;
const STATIC_KILL_TICK_MS = 100;
export const STATIC_COOLDOWN_MS = 400;
const STATIC_KILL_TILES = 14 / TILE;

/** Per world: lava geysers, candles, trapdoors, electric outlets... */
export const STATIC_HAZARDS: Partial<Record<ThemeId, StaticHazardInfo>> = {
  tropics: { time: 1050, killTime: STATIC_KILL_MS, death: 'EXPLODE' },
  sweetz: { time: 2480, killTime: STATIC_KILL_MS, death: 'EXPLODE' },
  rollerz: { time: 4280, killTime: 1400, death: 'FALL' },
  shrunk: { time: 1760, killTime: STATIC_KILL_MS, death: 'ELECTROCUTE' },
  minis: { time: 1560, killTime: STATIC_KILL_MS, death: 'EXPLODE' },
  space: { time: 1050, killTime: STATIC_KILL_MS, death: 'EXPLODE' },
};

export function staticHazardInfo(theme: ThemeId): StaticHazardInfo {
  return STATIC_HAZARDS[theme] ?? { time: 1000, killTime: STATIC_KILL_MS, death: 'SINK' };
}

export function spawnStaticHazard(w: World, x: number, y: number, delayMs: number, periodMs: number): void {
  const h = w.spawn<StaticHazard>({ kind: 'hazard', x, y, period: msToTicks(periodMs), active: false, since: 0 });
  w.schedule(Math.max(1, msToTicks(delayMs)), 'hazardEmit', h.id, 'cycle');
}

registerTask('hazardEmit', (w, id) => {
  const h = w.get(id, 'hazard');
  if (!h) return;
  const info = staticHazardInfo(w.theme);
  w.edit(h, { active: true, since: w.tick });
  w.fx('hazard', h, h.id);
  const killFrom = msToTicks(info.killTime);
  const killTo = msToTicks(info.time - STATIC_KILL_MS);
  for (let t = killFrom; t < killTo; t += msToTicks(STATIC_KILL_TICK_MS))
    w.schedule(Math.max(1, t), 'hazardKill', h.id, `kill${t}`);
  w.schedule(msToTicks(info.time), 'hazardIdle', h.id, 'cycle');
});

registerTask('hazardKill', (w, id) => {
  const h = w.get(id, 'hazard');
  if (!h || !h.active) return;
  const death = staticHazardInfo(w.theme).death;
  near(w, h, STATIC_KILL_TILES, g => {
    // Invulnerability shrugs off anything that explodes (geysers, candles, fireworks).
    if (death === 'EXPLODE' && g.powerup === 'INVULNERABILITY') return;
    kill(w, g, death);
  });
});

registerTask('hazardIdle', (w, id) => {
  const h = w.get(id, 'hazard');
  if (!h) return;
  w.edit(h, { active: false, since: w.tick });
  w.schedule(h.period + msToTicks(STATIC_COOLDOWN_MS), 'hazardEmit', h.id, 'cycle');
});

// --- birds / planes that drop things -------------------------------------------------------

const DROP_TRIGGER_TILES = 50 / TILE;
const DROP_COOLDOWN_MS = 3000;
const DROP_ENVELOPE = 3;
const POOP_HIT_MS = 2000;
const POOP_SPLAT_MS = 800;
const POOP_KILL_TILES = 16 / TILE;

/** Lane length (tiles) including the stretch off map on both sides. */
function dropperSpan(w: World, d: Dropper): number {
  const vertical = d.dir === 0 || d.dir === 4;
  return (vertical ? w.height : w.width) + DROP_ENVELOPE * 2;
}

/** A dropper flies across the whole map along its lane, over and over. */
export function dropperPosition(w: World, d: Dropper, tick: number): Point {
  const span = dropperSpan(w, d);
  const travelled = ((((tick - d.start) / d.rate) % span) + span) % span;
  const s = travelled - DROP_ENVELOPE;
  switch (d.dir) {
    case 0:
      return { x: d.lane, y: w.height - 1 - s };
    case 4:
      return { x: d.lane, y: s };
    case 2:
      return { x: s, y: d.lane };
    default:
      return { x: w.width - 1 - s, y: d.lane };
  }
}

export function spawnDropper(w: World, dir: Dir, lane: number, rateMs: number, offset: number): void {
  const rate = Math.max(1, msToTicks(rateMs));
  const d = w.spawn<Dropper>({
    kind: 'dropper',
    x: 0,
    y: 0,
    dir,
    lane,
    rate,
    start: w.tick - offset * rate,
    cooldownUntil: 0,
  });
  w.schedule(1, 'dropperCheck', d.id, 'check');
}

registerTask('dropperCheck', (w, id) => {
  const d = w.get(id, 'dropper');
  if (!d) return;
  if (w.tick >= d.cooldownUntil) {
    const at = dropperPosition(w, d, w.tick);
    for (const g of w.all('grunt')) {
      // Birds only pick on the players' gruntz.
      if (g.ai || isGone(g) || Math.abs(g.x - at.x) > 3 || Math.abs(g.y - at.y) > 3) continue;
      const p = gruntPosition(g, w.tick);
      if (Math.hypot(p.x - at.x, p.y - at.y) > DROP_TRIGGER_TILES) continue;
      const poop = w.spawn<Poop>({ kind: 'poop', x: g.x, y: g.y, px: p.x, py: p.y, dropped: w.tick, hit: false });
      w.schedule(msToTicks(POOP_HIT_MS), 'poopSplat', poop.id, 'splat');
      w.edit(d, { cooldownUntil: w.tick + msToTicks(DROP_COOLDOWN_MS) });
      w.fx('drop', g, g.id);
      break;
    }
  }
  w.schedule(1, 'dropperCheck', d.id, 'check');
});

registerTask('poopSplat', (w, id) => {
  const p = w.get(id, 'poop');
  if (!p) return;
  w.edit(p, { hit: true });
  w.fx('splat', p, p.id);
  near(w, { x: p.px, y: p.py }, POOP_KILL_TILES, g => kill(w, g, 'SQUASH'), false);
  w.schedule(msToTicks(POOP_SPLAT_MS), 'poopGone', p.id, 'splat');
});

registerTask('poopGone', (w, id) => {
  const p = w.get(id, 'poop');
  if (p) w.destroy(p);
});

// --- things that travel along a path (storm clouds, UFOs) -------------------------------------

interface PathMover {
  points: Point[];
  index: number;
  /** Ticks per tile. */
  rate: number;
  /** Ticks to wait at each point. */
  pause: number;
  start: number;
}

function legTicks(m: PathMover): number {
  const a = m.points[m.index]!;
  const b = m.points[(m.index + 1) % m.points.length]!;
  return Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * m.rate));
}

/** Position along a looping path: move from point to point, then wait. */
export function pathPosition(m: PathMover, tick: number): Point {
  const a = m.points[m.index]!;
  if (m.points.length < 2) return { x: a.x, y: a.y };
  const b = m.points[(m.index + 1) % m.points.length]!;
  const t = Math.max(0, Math.min(1, (tick - m.start) / legTicks(m)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function scheduleLeg(w: World, id: number, m: PathMover, task: string): void {
  if (m.points.length < 2) return;
  w.schedule(legTicks(m) + m.pause, task, id, 'leg');
}

const CLOUD_KILL_TILES = 32 / TILE;
const CLOUD_ZAP_MS = 100;

export function spawnCloud(w: World, points: Point[], rateMs: number, pauseMs: number): void {
  const c = w.spawn<Cloud>({
    kind: 'cloud',
    x: points[0]!.x,
    y: points[0]!.y,
    points,
    index: 0,
    rate: Math.max(1, msToTicks(rateMs)),
    pause: msToTicks(pauseMs),
    start: w.tick,
  });
  scheduleLeg(w, c.id, c, 'cloudLeg');
  w.schedule(msToTicks(CLOUD_ZAP_MS), 'cloudZap', c.id, 'zap');
}

registerTask('cloudLeg', (w, id) => {
  const c = w.get(id, 'cloud');
  if (!c) return;
  const index = (c.index + 1) % c.points.length;
  w.edit(c, { index, start: w.tick, x: c.points[index]!.x, y: c.points[index]!.y });
  scheduleLeg(w, c.id, { ...c, index }, 'cloudLeg');
});

registerTask('cloudZap', (w, id) => {
  const c = w.get(id, 'cloud');
  if (!c) return;
  near(w, pathPosition(c, w.tick), CLOUD_KILL_TILES, g => kill(w, g, 'ELECTROCUTE'), false);
  w.schedule(msToTicks(CLOUD_ZAP_MS), 'cloudZap', c.id, 'zap');
});

const UFO_KILL_TILES = 20 / TILE;
const UFO_BEAM_RADIUS = 64 / TILE;
const UFO_CHECK_MS = 50;

/** The two beams of a UFO sweep around it. */
export function ufoBeams(u: Ufo, tick: number): [Point, Point] {
  const c = pathPosition(u, tick);
  const turn = ((tick - u.spinStart) / Math.max(1, u.spin * 2)) * Math.PI * 2 * (u.clockwise ? 1 : -1);
  const dx = Math.cos(turn) * UFO_BEAM_RADIUS;
  const dy = Math.sin(turn) * UFO_BEAM_RADIUS;
  return [
    { x: c.x + dx, y: c.y + dy },
    { x: c.x - dx, y: c.y - dy },
  ];
}

export function spawnUfo(
  w: World,
  points: Point[],
  rateMs: number,
  pauseMs: number,
  spinMs: number,
  clockwise: boolean,
): void {
  const u = w.spawn<Ufo>({
    kind: 'ufo',
    x: points[0]!.x,
    y: points[0]!.y,
    points,
    index: 0,
    rate: Math.max(1, msToTicks(rateMs)),
    pause: msToTicks(pauseMs),
    start: w.tick,
    spin: Math.max(1, msToTicks(spinMs)),
    spinStart: w.tick,
    clockwise,
  });
  scheduleLeg(w, u.id, u, 'ufoLeg');
  w.schedule(1, 'ufoMelt', u.id, 'melt');
}

registerTask('ufoLeg', (w, id) => {
  const u = w.get(id, 'ufo');
  if (!u) return;
  const index = (u.index + 1) % u.points.length;
  w.edit(u, { index, start: w.tick, x: u.points[index]!.x, y: u.points[index]!.y });
  scheduleLeg(w, u.id, { ...u, index }, 'ufoLeg');
});

registerTask('ufoMelt', (w, id) => {
  const u = w.get(id, 'ufo');
  if (!u) return;
  for (const beam of ufoBeams(u, w.tick)) near(w, beam, UFO_KILL_TILES, g => kill(w, g, 'MELT'), false);
  w.schedule(msToTicks(UFO_CHECK_MS), 'ufoMelt', u.id, 'melt');
});

// --- "star search" spotlights ------------------------------------------------------------------

const SPOT_KILL_TILES = 16 / TILE;
const SPOT_CHECK_MS = 100;
const SPOT_PAUSE_MS = 13650;

/** Where the spotlight is pointing (it circles around its centre). */
export function spotPosition(s: SpotLight, tick: number): Point {
  const now = s.pausedAt > 0 ? s.pausedAt : tick;
  const a = ((now - s.start) / Math.max(1, s.rate * 2)) * Math.PI * 2 * (s.clockwise ? 1 : -1);
  return { x: s.x + Math.cos(a) * s.radius, y: s.y + Math.sin(a) * s.radius };
}

export function spawnSpotLight(
  w: World,
  x: number,
  y: number,
  radius: number,
  rateMs: number,
  clockwise: boolean,
): void {
  const s = w.spawn<SpotLight>({
    kind: 'spotlight',
    x,
    y,
    radius,
    rate: Math.max(1, msToTicks(rateMs)),
    clockwise,
    start: w.tick,
    pausedAt: 0,
  });
  w.schedule(1, 'spotCheck', s.id, 'check');
}

registerTask('spotCheck', (w, id) => {
  const s = w.get(id, 'spotlight');
  if (!s) return;
  if (s.pausedAt === 0) {
    let found = false;
    near(w, spotPosition(s, w.tick), SPOT_KILL_TILES, g => {
      kill(w, g, 'KARAOKE');
      found = true;
    });
    if (found) {
      // The spotlight stays on the singer for the whole performance.
      w.edit(s, { pausedAt: w.tick });
      w.schedule(msToTicks(SPOT_PAUSE_MS), 'spotResume', s.id, 'resume');
    }
  }
  w.schedule(msToTicks(SPOT_CHECK_MS), 'spotCheck', s.id, 'check');
});

registerTask('spotResume', (w, id) => {
  const s = w.get(id, 'spotlight');
  if (!s) return;
  w.edit(s, { start: s.start + (w.tick - s.pausedAt), pausedAt: 0 });
});

// --- kitchen slime ---------------------------------------------------------------------------------

const SLIME_KILL_TILES = 10 / TILE;
const SLIME_CHECK_MS = 50;

/** Next tile going around the slime's rectangle. */
function slimeStep(s: Slime): Point {
  const left = Math.min(s.x0, s.x1);
  const right = Math.max(s.x0, s.x1);
  const top = Math.min(s.y0, s.y1);
  const bottom = Math.max(s.y0, s.y1);
  let d: Dir = 6;
  if (s.clockwise) {
    if (s.x === left && s.y !== top) d = 0;
    else if (s.y === top && s.x !== right) d = 2;
    else if (s.x === right && s.y !== bottom) d = 4;
  } else if (s.x === left && s.y !== bottom) d = 4;
  else if (s.y === top && s.x !== left) d = 6;
  else if (s.x === right && s.y !== top) d = 0;
  else d = 2;
  return { x: s.x + DIRS[d]!.x, y: s.y + DIRS[d]!.y };
}

export function slimePosition(s: Slime, tick: number): Point {
  const t = Math.max(0, Math.min(1, (tick - s.start) / s.rate));
  return { x: s.fromX + (s.x - s.fromX) * t, y: s.fromY + (s.y - s.fromY) * t };
}

export function spawnSlime(
  w: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  clockwise: boolean,
  rateMs: number,
): void {
  const s = w.spawn<Slime>({
    kind: 'slime',
    x: x0,
    y: y0,
    fromX: x0,
    fromY: y0,
    x0,
    y0,
    x1,
    y1,
    clockwise,
    rate: Math.max(1, msToTicks(rateMs)),
    start: w.tick,
  });
  w.schedule(1, 'slimeMove', s.id, 'move');
  w.schedule(1, 'slimeMelt', s.id, 'melt');
}

registerTask('slimeMove', (w, id) => {
  const s = w.get(id, 'slime');
  if (!s) return;
  const next = slimeStep(s);
  w.edit(s, { fromX: s.x, fromY: s.y, x: next.x, y: next.y, start: w.tick });
  w.schedule(s.rate, 'slimeMove', s.id, 'move');
});

registerTask('slimeMelt', (w, id) => {
  const s = w.get(id, 'slime');
  if (!s) return;
  near(w, slimePosition(s, w.tick), SLIME_KILL_TILES, g => kill(w, g, 'MELT'));
  w.schedule(msToTicks(SLIME_CHECK_MS), 'slimeMelt', s.id, 'melt');
});
