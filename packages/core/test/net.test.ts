import { describe, expect, it } from 'vitest';
import { applyDelta, replicaHash, worldFromView } from '../src/net/replica.ts';
import { GameSession } from '../src/session/session.ts';
import type { LevelData } from '../src/map/level.ts';
import { grunts } from './helpers.ts';

const LEVEL: LevelData = {
  id: 'net',
  name: { en: 'Net', pl: 'Net' },
  mode: 'quest',
  theme: 'rocky',
  tiles: ['..R....', '..B....', '.......'],
  objects: [
    { type: 'grunt', x: 0, y: 0, tool: 'GAUNTLETZ' },
    { type: 'grunt', x: 0, y: 2, tool: 'SPY' },
    { type: 'pickup', x: 2, y: 0, item: 'SWORD', hidden: true },
    { type: 'brickz', x: 2, y: 1, layers: ['red', 'gold'] },
    { type: 'grunt', x: 6, y: 2, ai: 'Chaser', tool: 'CLUB' },
  ],
};

describe('replication', () => {
  it('hides buried items and unspied brick colours', () => {
    const s = new GameSession(LEVEL, [{ team: 0, name: 'P', alliance: 0 }], 7);
    const snap = s.tracker(0).snapshot(s.world);
    expect(snap.entities.some(e => e.kind === 'pickup')).toBe(false);
    const bricks = snap.entities.find(e => e.kind === 'brickz');
    expect(bricks && 'layers' in bricks ? bricks.layers : []).toEqual(['brown', 'brown']);
  });

  it('a replica built from deltas matches the server view hash', () => {
    const s = new GameSession(LEVEL, [{ team: 0, name: 'P', alliance: 0 }], 7);
    const tracker = s.tracker(0);
    const replica = worldFromView(tracker.snapshot(s.world));
    const [breaker, spy] = grunts(s.world, 0);
    s.submit(0, { type: 'useTool', ids: [breaker!.id], x: 2, y: 0 }, 1);
    s.submit(0, { type: 'useTool', ids: [spy!.id], x: 1, y: 2 }, 2);
    for (let i = 0; i < 400; i++) {
      const step = s.step();
      applyDelta(replica, tracker.delta(s.world, step.changes, step.tick));
      if (i % 20 === 0) expect(replicaHash(replica)).toBe(tracker.hash());
    }
    expect(replicaHash(replica)).toBe(tracker.hash());
    // The sword under the rock is visible now, and the spy revealed the bricks.
    expect([...replica.all('pickup')].some(p => p.item === 'SWORD')).toBe(true);
    const bricks = [...replica.all('brickz')][0]!;
    expect(bricks.layers).toEqual(['red', 'gold']);
  });

  it('is deterministic: same seed and commands give the same state', () => {
    const play = () => {
      const s = new GameSession(LEVEL, [{ team: 0, name: 'P', alliance: 0 }], 99);
      const [breaker] = grunts(s.world, 0);
      s.submit(0, { type: 'move', ids: [breaker!.id], x: 5, y: 2 });
      for (let i = 0; i < 600; i++) s.step();
      return s.tracker(0).snapshot(s.world);
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});
