import { createWorld, type LevelData, type LevelObject } from '../src/map/level.ts';
import { questRules } from '../src/sim/rules.ts';
import type { Grunt } from '../src/sim/types.ts';
import type { World } from '../src/sim/world.ts';
import { applyCommand, type Command } from '../src/sim/commands.ts';

export function level(tiles: string[], objects: LevelObject[] = [], extra: Partial<LevelData> = {}): LevelData {
  return {
    id: 'test',
    name: { en: 'Test', pl: 'Test' },
    mode: 'quest',
    theme: 'rocky',
    tiles,
    objects,
    ...extra,
  };
}

export function world(tiles: string[], objects: LevelObject[] = [], extra: Partial<LevelData> = {}): World {
  const lvl = level(tiles, objects, extra);
  const w = createWorld(lvl, { seed: 42, teams: [{ team: 0, name: 'P1' }, { team: 1, name: 'P2' }] });
  if (lvl.mode === 'quest') w.rules = questRules(0);
  return w;
}

export function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.rules.onTick?.(w);
    w.runTasks();
    w.tick++;
    w.takeChanges();
  }
}

/** Run until a predicate holds (or fail after `max` ticks). */
export function runUntil(w: World, pred: () => boolean, max = 2000): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    run(w, 1);
  }
  throw new Error('Condition not reached');
}

export function grunts(w: World, team?: number): Grunt[] {
  return [...w.all('grunt')].filter(g => team === undefined || g.team === team);
}

export function cmd(w: World, team: number, c: Command): void {
  const reason = applyCommand(w, team, c);
  if (reason) throw new Error(`Command rejected: ${reason}`);
}
