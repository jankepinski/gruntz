import { formatLevel, type LevelData } from '@gruntz/core';

/** Levels made in the editor, kept in the browser. */
const KEY = 'gruntz.custom.levels';

export function customLevels(): LevelData[] {
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, LevelData>) : {};
    return Object.values(map).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  } catch {
    return [];
  }
}

export function saveCustomLevel(level: LevelData): void {
  const map = Object.fromEntries(customLevels().map(l => [l.id, l]));
  map[level.id] = level;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function deleteCustomLevel(id: string): void {
  const map = Object.fromEntries(customLevels().map(l => [l.id, l]));
  delete map[id];
  localStorage.setItem(KEY, JSON.stringify(map));
}

/** Offer the level as a .json file. */
export function downloadLevel(level: LevelData): void {
  const blob = new Blob([formatLevel(level)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${level.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readLevelFile(file: File): Promise<LevelData> {
  return parseLevelText(await file.text());
}

export function parseLevelText(text: string): LevelData {
  const data = JSON.parse(text) as LevelData;
  if (!data || typeof data !== 'object' || !Array.isArray(data.tiles) || !Array.isArray(data.objects))
    throw new Error('Not a level file');
  if (data.mode !== 'quest' && data.mode !== 'battle') throw new Error('Unknown mode');
  return data;
}

/** Dev server only: write the level into content/levels so it ships with the game. */
export async function saveToContent(level: LevelData): Promise<void> {
  const res = await fetch('/__editor/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: level.id, text: formatLevel(level) }),
  });
  if (!res.ok) throw new Error(await res.text());
}
