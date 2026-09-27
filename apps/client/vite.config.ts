import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const LEVEL_DIR = fileURLToPath(new URL('../../content/levels/', import.meta.url));

/** Dev only: lets the level editor save straight into content/levels. */
function editorSave(): Plugin {
  return {
    name: 'gruntz-editor-save',
    apply: 'serve',
    configureServer(server) {
      // Levels live outside the client root: watch them so new files reach import.meta.glob.
      server.watcher.add(LEVEL_DIR);
      server.middlewares.use('/__editor/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', async () => {
          try {
            const { id, text } = JSON.parse(body) as { id: string; text: string };
            if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Bad level id (use a-z, 0-9 and -)');
            const level = JSON.parse(text) as { id?: unknown; tiles?: unknown; objects?: unknown };
            if (level.id !== id || !Array.isArray(level.tiles) || !Array.isArray(level.objects)) throw new Error('Not a level file');
            await writeFile(`${LEVEL_DIR}${id}.json`, text);
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end((err as Error).message);
          }
        });
      });
    },
  };
}

const PREVIEW_DIR = fileURLToPath(new URL('../../assets/previews/', import.meta.url));

/** Dev only: save a PNG sent from the page (frame captures for comparisons) into assets/previews. */
function devScreenshots(): Plugin {
  return {
    name: 'gruntz-dev-screenshots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/screenshot', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
          const data = Buffer.concat(chunks).toString().replace(/^data:image\/png;base64,/, '');
          await mkdir(PREVIEW_DIR, { recursive: true });
          await writeFile(`${PREVIEW_DIR}${name}.png`, Buffer.from(data, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), editorSave(), devScreenshots()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8686', ws: true },
    },
    fs: { allow: ['../..'] },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
