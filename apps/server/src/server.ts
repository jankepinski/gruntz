import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, LobbyServerMsg } from '@gruntz/core';
import { decode } from './codec.ts';
import { battleLevels, LEVELS } from './levels.ts';
import { Player, Players } from './players.ts';
import { newRoomCode, Room } from './room.ts';
import { parseClientMsg } from './validate.ts';

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const MAX_PAYLOAD = 16 * 1024;
const IDLE_PLAYER_MS = 5 * 60_000;

export interface GameServer {
  port: number;
  close(): Promise<void>;
}

/** Start the HTTP + WebSocket server. Port 0 picks a free port (tests). */
export function startServer(port: number): Promise<GameServer> {
  const players = new Players();
  const rooms = new Map<string, Room>();

  // --- static files (production build of the client) ----------------------------------

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
  };
  const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.glb', '.svg', '.map']);
  /** Built files never change while the server runs: keep them (and their gzip) in memory. */
  const cache = new Map<string, { raw: Buffer; gz: Buffer | null; etag: string }>();

  function load(file: string) {
    let hit = cache.get(file);
    if (!hit) {
      const raw = readFileSync(file);
      const gz = COMPRESSIBLE.has(extname(file)) && raw.length > 1024 ? gzipSync(raw, { level: 9 }) : null;
      hit = { raw, gz, etag: `"${createHash('sha1').update(raw).digest('base64url').slice(0, 16)}"` };
      cache.set(file, hit);
    }
    return hit;
  }

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (!existsSync(STATIC_DIR)) {
      res.writeHead(404);
      res.end('Client not built. Run `pnpm build` or use the Vite dev server.');
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    let file = normalize(join(STATIC_DIR, path));
    if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
    const { raw, gz, etag } = load(file);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    const useGzip = gz !== null && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    // Only Vite's hashed bundles are immutable; models, icons and index.html keep their names.
    const hashed = file.startsWith(join(STATIC_DIR, 'assets'));
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      vary: 'accept-encoding',
      etag,
      ...(useGzip ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(useGzip ? gz : raw);
  });

  // --- websocket ------------------------------------------------------------------------

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PAYLOAD });

  function publicRooms() {
    return [...rooms.values()].filter(r => r.isPublic).map(r => r.summary());
  }

  function sendLobby(p: Player): void {
    p.send({ t: 'rooms', rooms: publicRooms() });
  }

  function broadcastLobby(): void {
    const msg: LobbyServerMsg = { t: 'rooms', rooms: publicRooms() };
    for (const p of players.all()) if (!p.roomCode) p.send(msg);
  }

  function roomOf(p: Player): Room | undefined {
    return p.roomCode ? rooms.get(p.roomCode) : undefined;
  }

  function onEmpty(room: Room): void {
    rooms.delete(room.code);
    broadcastLobby();
  }

  wss.on('connection', (socket: WebSocket) => {
    let player: Player | null = null;

    socket.on('message', raw => {
      let msg: ClientMsg | null;
      try {
        msg = parseClientMsg(decode(raw as Buffer));
      } catch {
        msg = null;
      }
      if (!msg) {
        socket.close(1008, 'bad message');
        return;
      }
      if (!player) {
        if (msg.t !== 'hello') return;
        const existing = players.byTokenValue(msg.token);
        if (existing) {
          existing.socket?.close(4000, 'replaced');
          player = existing;
          player.name = msg.name;
        } else {
          player = players.create(msg.name);
        }
        player.socket = socket;
        player.lastSeen = Date.now();
        player.send({ t: 'welcome', playerId: player.id, token: player.token, name: player.name });
        const room = roomOf(player);
        if (room) room.reattach(player);
        else sendLobby(player);
        return;
      }
      const p = player;
      p.lastSeen = Date.now();
      if (!p.messageLimiter.take()) {
        socket.close(1008, 'rate limit');
        return;
      }
      switch (msg.t) {
        case 'hello':
          return;
        case 'ping':
          p.send({ t: 'pong', c: msg.c, s: Date.now() });
          return;
        case 'listRooms':
          sendLobby(p);
          return;
        case 'createRoom': {
          roomOf(p)?.leave(p);
          const level = LEVELS.get(msg.levelId) ?? battleLevels()[0];
          if (!level) return;
          const code = newRoomCode(c => rooms.has(c));
          const room = new Room(code, msg.name, msg.isPublic, level, p, onEmpty);
          rooms.set(code, room);
          room.join(p);
          broadcastLobby();
          return;
        }
        case 'joinRoom': {
          const room = rooms.get(msg.code);
          if (!room) {
            p.send({ t: 'error', code: 'no-room' });
            return;
          }
          if (roomOf(p) && roomOf(p) !== room) roomOf(p)!.leave(p);
          const err = room.join(p);
          if (err) p.send({ t: 'error', code: err });
          broadcastLobby();
          return;
        }
        case 'leaveRoom':
          roomOf(p)?.leave(p);
          p.send({ t: 'room', room: null });
          sendLobby(p);
          broadcastLobby();
          return;
        case 'chat':
          if (!p.chatLimiter.take()) return;
          roomOf(p)?.handle(p, msg);
          return;
        default:
          roomOf(p)?.handle(p, msg);
          if (msg.t === 'start' || msg.t === 'setLevel' || msg.t === 'setSlot') broadcastLobby();
      }
    });

    socket.on('close', () => {
      if (!player || player.socket !== socket) return;
      player.socket = null;
      roomOf(player)?.disconnected(player);
      broadcastLobby();
    });
  });

  // Forget players that went away long ago.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const p of players.all()) {
      if (!p.socket && !p.roomCode && now - p.lastSeen > IDLE_PLAYER_MS) players.remove(p);
    }
  }, 60_000);

  return new Promise(resolve => {
    http.listen(port, () => {
      const address = http.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: actual,
        close: () =>
          new Promise<void>(done => {
            clearInterval(cleanup);
            for (const room of rooms.values()) room.stop();
            for (const client of wss.clients) client.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}
