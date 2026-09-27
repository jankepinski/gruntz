#!/usr/bin/env node
/**
 * Builds every 3D asset: runs the Blender scripts headless, then compresses the GLBs
 * with meshopt (lossless, the client's GLTFLoader decodes it).
 *
 *   pnpm assets                 # everything
 *   pnpm assets props hazards   # only these models
 *   pnpm assets --no-blender    # just re-compress what is there
 *
 * BLENDER=/path/to/blender overrides the default macOS location.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const MODELS = join(ROOT, 'apps/client/public/models');

/** Blender script per model, plus extra arguments. */
const SCRIPTS = {
  grunt: ['grunt.py'],
  terrain: ['terrain.py'],
  items: ['items.py', '--icons'],
  props: ['props.py'],
  hazards: ['hazards.py'],
};

const args = process.argv.slice(2);
const skipBlender = args.includes('--no-blender');
const wanted = args.filter(a => !a.startsWith('--'));
const names = wanted.length ? wanted : Object.keys(SCRIPTS);
for (const n of names) if (!SCRIPTS[n]) throw new Error(`Unknown model "${n}" (known: ${Object.keys(SCRIPTS).join(', ')})`);

const kb = f => `${(statSync(f).size / 1024).toFixed(0)} KB`;

if (!skipBlender) {
  if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER} (set BLENDER=...)`);
  for (const n of names) {
    const [script, ...extra] = SCRIPTS[n];
    console.log(`▸ blender ${script} ${extra.join(' ')}`);
    execFileSync(BLENDER, ['-b', '-P', join(ROOT, 'assets/blender/models', script), '--', ...extra], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRTextureTransform, KHRMaterialsEmissiveStrength])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const n of names) {
  const file = join(MODELS, `${n}.glb`);
  if (!existsSync(file)) {
    console.warn(`  (no ${n}.glb yet)`);
    continue;
  }
  const before = kb(file);
  const doc = await io.read(file);
  await doc.transform(dedup(), weld(), prune({ keepAttributes: true }));
  // Meshopt compression without quantization: quantizing would move scale into the
  // nodes, and the game bakes node transforms into instanced terrain pieces itself.
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(file, doc);
  console.log(`✓ ${n}.glb ${before} → ${kb(file)}`);
}
