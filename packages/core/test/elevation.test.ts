import { describe, expect, it } from 'vitest';
import { levelsConnect } from '../src/sim/elevation.ts';
import { cmd, grunts, run, runUntil, world } from './helpers.ts';

// Stairz climb towards: A north, D east, V south, Q west.
const legend = { A: 'RAMP_N', D: 'RAMP_E', V: 'RAMP_S', Q: 'RAMP_W' };

describe('height levels', () => {
  it('a grunt cannot walk up a cliff without stairz', () => {
    const w = world(['....', '....'], [{ type: 'grunt', x: 0, y: 1 }], { heights: ['1111', '0000'] });
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 0, y: 0 });
    run(w, 80);
    expect(g!.y).toBe(1);
  });

  it('stairz lead up and back down', () => {
    const w = world(['....', '.A..', '....'], [{ type: 'grunt', x: 3, y: 2 }], {
      legend,
      heights: ['1111', '0000', '0000'],
    });
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 3, y: 0 });
    runUntil(w, () => g!.x === 3 && g!.y === 0 && g!.action.kind === 'idle');
    // It had to go through the stairz.
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 0, y: 2 });
    runUntil(w, () => g!.x === 0 && g!.y === 2 && g!.action.kind === 'idle');
  });

  it('stairz are closed on their sides', () => {
    const w = world(['...', '.A.', '...'], [], { legend, heights: ['111', '000', '000'] });
    expect(levelsConnect(w, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(levelsConnect(w, { x: 1, y: 2 }, { x: 1, y: 1 })).toBe(true);
    expect(levelsConnect(w, { x: 1, y: 1 }, { x: 1, y: 0 })).toBe(true);
    // No cutting corners on or around stairz.
    expect(levelsConnect(w, { x: 0, y: 2 }, { x: 1, y: 1 })).toBe(false);
    expect(levelsConnect(w, { x: 1, y: 1 }, { x: 0, y: 0 })).toBe(false);
  });

  it('two stairz side by side make one wide staircase', () => {
    const w = world(['....', '.AA.', '....'], [], { legend, heights: ['1111', '0000', '0000'] });
    expect(levelsConnect(w, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
  });

  it('diagonal steps need flat ground of one level', () => {
    const w = world(['...', '...'], [], { heights: ['010', '000'] });
    expect(levelsConnect(w, { x: 0, y: 1 }, { x: 1, y: 0 })).toBe(false);
    expect(levelsConnect(w, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(levelsConnect(w, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(true);
  });

  it('gruntz cannot hit each other across a cliff', () => {
    const w = world(
      ['...', '...'],
      [
        { type: 'grunt', x: 1, y: 1, tool: 'GAUNTLETZ' },
        { type: 'grunt', x: 1, y: 0, ai: 'PostGuard', tool: 'CLUB' },
      ],
      { heights: ['111', '000'] },
    );
    const [me, enemy] = grunts(w);
    cmd(w, 0, { type: 'attack', ids: [me!.id], target: enemy!.id });
    run(w, 200);
    expect(enemy!.health).toBe(20);
    expect(me!.health).toBe(20);
  });

  it('a springz grunt jumps a trench to the same level', () => {
    const w = world(['.o.'], [{ type: 'grunt', x: 0, y: 0, tool: 'SPRING' }], { heights: ['101'] });
    const [g] = grunts(w);
    expect(levelsConnect(w, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 2, y: 0 });
    runUntil(w, () => g!.x === 2 && g!.action.kind === 'idle', 400);
    expect(g!.health).toBe(20);
  });

  it('rolling ballz break against a cliff', () => {
    const w = world(['....'], [{ type: 'ball', x: 0, y: 0, dir: 2 }], { heights: ['0011'] });
    const [ball] = [...w.all('ball')];
    runUntil(w, () => ball!.state !== 'roll', 400);
    expect(ball!.x).toBe(1);
  });

  it('the height levels survive a snapshot', () => {
    const w = world(['...'], [], { heights: ['012'] });
    expect(w.maxLevel).toBe(2);
    const snap = w.snapshot();
    expect(snap.heights).toEqual([0, 1, 2]);
  });
});
