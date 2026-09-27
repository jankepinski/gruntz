import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LevelData } from '@gruntz/core';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../content/levels');

export const LEVELS = new Map<string, LevelData>();
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.json')) continue;
  const level = JSON.parse(readFileSync(join(dir, file), 'utf8')) as LevelData;
  LEVELS.set(level.id, level);
}

export function battleLevels(): LevelData[] {
  return [...LEVELS.values()].filter(l => l.mode === 'battle');
}
