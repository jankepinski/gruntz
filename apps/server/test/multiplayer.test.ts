import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Packr } from 'msgpackr';
import { WebSocket } from 'ws';
import {
  applyDelta,
  replicaHash,
  worldFromView,
  type ClientMsg,
  type GameStart,
  type RoomState,
  type ServerMsg,
  type World,
} from '@gruntz/core';
import { startServer, type GameServer } from '../src/server.ts';

const packr = new Packr({ useRecords: false, mapsAsObjects: true });

/** A headless test client that keeps a replica like the browser does. */
class TestClient {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  room: RoomState | null = null;
  playerId = '';
  token = '';
  start: GameStart | null = null;
  world: World | null = null;
  hashChecks = 0;
  hashMismatches = 0;
  acks = new Map<number, number>();
  rejects = new Map<number, string>();
  private seq = 1;

  constructor(port: number, readonly name: string, token?: string) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on('open', () => this.send({ t: 'hello', name, ...(token ? { token } : {}) }));
    this.ws.on('message', data => this.receive(packr.unpack(data as Buffer) as ServerMsg));
  }

  send(msg: ClientMsg): void {
    this.ws.send(packr.pack(msg));
  }

  command(c: Extract<ClientMsg, { t: 'cmd' }>['c']): number {
    const seq = this.seq++;
    this.send({ t: 'cmd', seq, c });
    return seq;
  }

  private receive(msg: ServerMsg): void {
    this.msgs.push(msg);
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.token = msg.token;
        break;
      case 'room':
        this.room = msg.room;
        break;
      case 'start':
        this.start = msg.start;
        this.world = worldFromView(msg.start.snapshot);
        break;
      case 'snapshot':
        this.world = worldFromView(msg.s);
        break;
      case 'delta':
        if (this.world) applyDelta(this.world, msg.d);
        break;
      case 'hash':
        if (this.world && this.world.tick === msg.tick + 1) {
          this.hashChecks++;
          if (replicaHash(this.world) !== msg.h) this.hashMismatches++;
        }
        break;
      case 'ack':
        this.acks.set(msg.seq, msg.tick);
        break;
      case 'reject':
        this.rejects.set(msg.seq, msg.reason);
        break;
    }
  }

  async until(pred: () => boolean, ms = 8000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: condition not reached`);
      await new Promise(r => setTimeout(r, 20));
    }
  }

  close(): void {
    this.ws.close();
  }
}

let server: GameServer;

beforeAll(async () => {
  server = await startServer(0);
});

afterAll(async () => {
  await server.close();
});

describe('multiplayer', () => {
  it('rooms, codes, start, commands, replication and reconnect', async () => {
    const alice = new TestClient(server.port, 'Alice');
    const bob = new TestClient(server.port, 'Bob');
    await alice.until(() => !!alice.playerId);
    await bob.until(() => !!bob.playerId);

    alice.send({ t: 'createRoom', name: 'Test', levelId: 'battle-duel', isPublic: false });
    await alice.until(() => !!alice.room);
    const code = alice.room!.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    bob.send({ t: 'joinRoom', code });
    await bob.until(() => bob.room?.code === code);
    bob.send({ t: 'ready', ready: true });
    await alice.until(() => alice.room!.slots.some(s => s.name === 'Bob' && s.ready));
    alice.send({ t: 'start' });

    await alice.until(() => !!alice.world, 6000);
    await bob.until(() => !!bob.world, 6000);
    expect(alice.start!.team).toBe(0);
    expect(bob.start!.team).toBe(1);

    // Move one of Alice's gruntz, and try (and fail) to move one of Bob's.
    // (Copy the values: replica entities are patched in place.)
    const aliceGrunt = { ...[...alice.world!.all('grunt')].find(g => g.team === 0)! };
    const bobGrunt = { ...[...alice.world!.all('grunt')].find(g => g.team === 1)! };
    const ok = alice.command({ type: 'move', ids: [aliceGrunt.id], x: aliceGrunt.x + 2, y: aliceGrunt.y });
    const cheat = alice.command({ type: 'move', ids: [bobGrunt.id], x: 1, y: 1 });
    await alice.until(() => alice.acks.has(ok) && alice.rejects.has(cheat));
    expect(alice.rejects.get(cheat)).toBe('no-units');

    // Both replicas see Alice's grunt walk.
    await alice.until(() => alice.world!.get(aliceGrunt.id, 'grunt')!.x === aliceGrunt.x + 2, 5000);
    await bob.until(() => bob.world!.get(aliceGrunt.id, 'grunt')!.x === aliceGrunt.x + 2, 5000);

    // Replicas stay consistent with the server (hash checks every 20 ticks).
    await alice.until(() => alice.hashChecks >= 3 && bob.hashChecks >= 3, 6000);
    expect(alice.hashMismatches).toBe(0);
    expect(bob.hashMismatches).toBe(0);

    // Bob drops and comes back with his token: he gets the game again.
    const token = bob.token;
    bob.close();
    await new Promise(r => setTimeout(r, 300));
    const bob2 = new TestClient(server.port, 'Bob', token);
    await bob2.until(() => !!bob2.world, 5000);
    expect(bob2.start!.team).toBe(1);
    await bob2.until(() => bob2.hashChecks >= 2, 5000);
    expect(bob2.hashMismatches).toBe(0);

    // Garbage is rejected by closing the socket.
    const evil = new TestClient(server.port, 'Evil');
    await evil.until(() => !!evil.playerId);
    let closed = false;
    evil.ws.on('close', () => (closed = true));
    evil.ws.send(packr.pack({ t: 'cmd', seq: 1, c: { type: 'move', ids: ['x'], x: -5, y: 1e9 } }));
    await evil.until(() => closed, 3000);

    alice.close();
    bob2.close();
  }, 30000);
});
