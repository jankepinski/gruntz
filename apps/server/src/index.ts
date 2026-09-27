import { LEVELS } from './levels.ts';
import { startServer } from './server.ts';

const PORT = Number(process.env.PORT ?? 8686);
const server = await startServer(PORT);
console.log(`Gruntz server on http://localhost:${server.port} (ws: /ws), ${LEVELS.size} levels`);

// Containers stop with SIGTERM: close sockets cleanly so clients reconnect elsewhere.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
