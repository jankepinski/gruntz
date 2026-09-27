import type { LevelData } from '@gruntz/core';

const modules = import.meta.glob<LevelData>('../../../../content/levels/*.json', { eager: true, import: 'default' });

export const LEVELS: LevelData[] = Object.values(modules).sort((a, b) =>
  a.id.localeCompare(b.id, 'en', { numeric: true }),
);

export function levelById(id: string): LevelData | undefined {
  return LEVELS.find(l => l.id === id);
}

/** Campaign order: world by world (0 = training), then the order inside a world. */
export const QUEST_LEVELS = LEVELS.filter(l => l.mode === 'quest').sort(
  (a, b) =>
    (a.world ?? 99) - (b.world ?? 99) ||
    (a.index ?? 99) - (b.index ?? 99) ||
    a.id.localeCompare(b.id, 'en', { numeric: true }),
);
export const BATTLE_LEVELS = LEVELS.filter(l => l.mode === 'battle');

/** The main campaign path (secret levels are side trips). */
export const CAMPAIGN = QUEST_LEVELS.filter(l => !l.secret);

/** Quest levels grouped by world, in campaign order. */
export function questWorlds(): { world: number; levels: LevelData[] }[] {
  const groups = new Map<number, LevelData[]>();
  for (const l of QUEST_LEVELS) {
    const w = l.world ?? 99;
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w)!.push(l);
  }
  return [...groups.entries()].map(([world, levels]) => ({ world, levels }));
}
