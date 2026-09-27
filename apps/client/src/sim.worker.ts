/// <reference lib="webworker" />
import { GameSession, TICK_MS, type GameServerMsg, type WorldSnapshot } from '@gruntz/core';
import { createBot } from './game/botFactory.ts';
import type { WorkerInit } from './net/workerTransport.ts';
import type { WorkerControl } from './net/transport.ts';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('unhandledrejection', e => console.warn('worker unhandled rejection:', (e.reason as Error)?.stack ?? e.reason));

let session: GameSession | null = null;
let team = 0;
let paused = false;
let speed = 1;
let acc = 0;
let last = 0;
let ended = false;

function post(msg: GameServerMsg): void {
  self.postMessage(msg);
}

function loop(): void {
  if (!session || ended) return;
  const now = performance.now();
  if (!paused) acc += (now - last) * speed;
  last = now;
  // Never try to catch up more than a second at once (tab was hidden, etc.).
  acc = Math.min(acc, TICK_MS * 20);
  while (acc >= TICK_MS && session && !ended) {
    acc -= TICK_MS;
    const step = session.step();
    post({ t: 'delta', d: session.tracker(team).delta(session.world, step.changes, step.tick) });
    for (const r of step.results) {
      if (r.team !== team) continue;
      post(r.reason === null ? { t: 'ack', seq: r.seq, tick: r.tick } : { t: 'reject', seq: r.seq, reason: r.reason });
    }
    if (step.tick % 20 === 0) post({ t: 'hash', tick: step.tick, h: session.tracker(team).hash() });
    if (session.end) {
      ended = true;
      post({ t: 'end', end: session.end });
    }
  }
  setTimeout(loop, 4);
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | WorkerInit
    | WorkerControl
    | { t: 'cmd'; seq: number; c: never }
    | { t: 'resync' }
    | { t: 'ping'; c: number }
    | { t: 'save' }
    | { t: 'load'; data: WorldSnapshot };
  switch (msg.t) {
    case 'init': {
      team = msg.team;
      session = new GameSession(msg.level, msg.players, msg.seed, createBot);
      const snapshot = session.tracker(team).snapshot(session.world);
      post({
        t: 'start',
        start: { level: msg.level, team, players: msg.players, snapshot, startTime: performance.timeOrigin + performance.now() },
      });
      last = performance.now();
      acc = 0;
      loop();
      break;
    }
    case 'cmd':
      session?.submit(team, msg.c, msg.seq);
      break;
    case 'resync':
      if (session) post({ t: 'snapshot', s: session.tracker(team).snapshot(session.world) });
      break;
    case 'ping':
      post({ t: 'pong', c: msg.c, s: performance.timeOrigin + performance.now() });
      break;
    case 'pause':
      paused = msg.paused;
      break;
    case 'speed':
      speed = Math.max(0.25, Math.min(4, msg.speed));
      break;
    case 'save':
      if (session) self.postMessage({ t: 'saved', data: session.world.snapshot() });
      break;
    case 'load':
      if (session) {
        session.loadSnapshot(msg.data);
        ended = false;
        post({ t: 'snapshot', s: session.tracker(team).snapshot(session.world) });
      }
      break;
  }
};
