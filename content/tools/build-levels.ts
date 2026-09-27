/**
 * Builds level sources (content/src/levels/*.ts) into the level files the game loads
 * (content/levels/<id>.json) and reports validation problems.
 *
 *   pnpm levels            # build everything
 *   pnpm levels rocky-1    # only these
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatLevel } from '../../packages/core/src/index.ts';
import { build, type LevelSource } from '../src/kit.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = join(root, 'src/levels');
const out = join(root, 'levels');
const wanted = process.argv.slice(2);

let errors = 0;
for (const file of readdirSync(sources).sort()) {
  if (!file.endsWith('.ts')) continue;
  const id = file.slice(0, -3);
  if (wanted.length && !wanted.includes(id)) continue;
  const src = (await import(pathToFileURL(join(sources, file)).href)).default as LevelSource;
  const { level, issues } = build(src);
  for (const i of issues) {
    const where = i.x !== undefined ? ` at ${i.x},${i.y}` : '';
    console.log(`  ${i.severity === 'error' ? '✗' : '!'} ${id}: ${i.code}${where}`);
    if (i.severity === 'error') errors++;
  }
  writeFileSync(join(out, `${level.id}.json`), formatLevel(level));
  const size = `${level.tiles[0]!.length}x${level.tiles.length}`;
  console.log(`✓ ${level.id} (${size}, ${level.objects.length} objects)`);
}
if (errors) {
  console.error(`${errors} error(s)`);
  process.exit(1);
}
