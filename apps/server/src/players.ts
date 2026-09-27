import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ServerMsg } from '@gruntz/core';
import { encode } from './codec.ts';
import { RateLimiter } from './validate.ts';

/** Optional artificial network conditions for testing (LAG_MS, JITTER_MS env vars). */
const LAG = Number(process.env.LAG_MS ?? 0);
const JITTER = Number(process.env.JITTER_MS ?? 0);

export class Player {
  readonly id = randomBytes(8).toString('hex');
  readonly token = randomBytes(16).toString('hex');
  socket: WebSocket | null = null;
  roomCode: string | null = null;
  lastSeen = Date.now();
  readonly commandLimiter = new RateLimiter(40, 20);
  readonly messageLimiter = new RateLimiter(120, 60);
  readonly chatLimiter = new RateLimiter(5, 1);
  private sendAt = 0;

  constructor(public name: string) {}

  send(msg: ServerMsg): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== socket.OPEN) return;
    const data = encode(msg);
    if (LAG <= 0 && JITTER <= 0) {
      socket.send(data);
      return;
    }
    // Keep order: never schedule before the previous message.
    const now = Date.now();
    const at = Math.max(this.sendAt, now + LAG + (Math.random() - 0.5) * 2 * JITTER);
    this.sendAt = at;
    setTimeout(() => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }, at - now);
  }
}

export class Players {
  private byToken = new Map<string, Player>();
  private byId = new Map<string, Player>();

  create(name: string): Player {
    const p = new Player(name);
    this.byToken.set(p.token, p);
    this.byId.set(p.id, p);
    return p;
  }

  byTokenValue(token: string | undefined): Player | undefined {
    return token ? this.byToken.get(token) : undefined;
  }

  get(id: string): Player | undefined {
    return this.byId.get(id);
  }

  remove(p: Player): void {
    this.byToken.delete(p.token);
    this.byId.delete(p.id);
  }

  all(): IterableIterator<Player> {
    return this.byId.values();
  }
}
