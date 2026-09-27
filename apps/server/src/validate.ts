import { z } from 'zod';
import type { ClientMsg } from '@gruntz/core';

const int = z.number().int().min(-1).max(1_000_000);
const coord = z.number().int().min(0).max(1024);
const ids = z.array(z.number().int().min(0).max(10_000_000)).max(64);

const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), ids, x: coord, y: coord, queue: z.boolean().optional(), safe: z.boolean().optional() }),
  z.object({ type: z.literal('attack'), ids, target: int, queue: z.boolean().optional() }),
  z.object({ type: z.literal('useTool'), ids, x: coord, y: coord, target: int.optional(), queue: z.boolean().optional() }),
  z.object({ type: z.literal('useToy'), ids, x: coord, y: coord, target: int.optional(), queue: z.boolean().optional() }),
  z.object({ type: z.literal('stop'), ids }),
  z.object({ type: z.literal('give'), slot: z.number().int().min(0).max(32), id: int }),
  z.object({ type: z.literal('drop'), oven: z.number().int().min(0).max(16), pad: int }),
  z.object({ type: z.literal('destruct') }),
]);

const name = z.string().trim().min(1).max(16);
const bot = z.enum(['easy', 'normal', 'hard']);

export const clientMsg = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), name, token: z.string().max(64).optional() }),
  z.object({ t: z.literal('listRooms') }),
  z.object({ t: z.literal('createRoom'), name: z.string().trim().min(1).max(32), levelId: z.string().max(64), isPublic: z.boolean() }),
  z.object({ t: z.literal('joinRoom'), code: z.string().trim().toUpperCase().length(6) }),
  z.object({ t: z.literal('leaveRoom') }),
  z.object({ t: z.literal('setSlot'), slot: z.number().int().min(0).max(3), kind: z.enum(['open', 'closed', 'human', 'bot']), bot: bot.optional() }),
  z.object({ t: z.literal('setAlliance'), slot: z.number().int().min(0).max(3), alliance: z.number().int().min(0).max(3) }),
  z.object({ t: z.literal('setLevel'), levelId: z.string().max(64) }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('cmd'), seq: z.number().int().min(0), c: command }),
  z.object({ t: z.literal('resync') }),
  z.object({ t: z.literal('ping'), c: z.number() }),
]);

export function parseClientMsg(raw: unknown): ClientMsg | null {
  const r = clientMsg.safeParse(raw);
  return r.success ? (r.data as ClientMsg) : null;
}

/** Token bucket rate limiter. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private capacity: number,
    private perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
