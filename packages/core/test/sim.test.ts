import { describe, expect, it } from 'vitest';
import { msToTicks } from '../src/constants.ts';
import { tileId } from '../src/data/tiles.ts';
import { stamina } from '../src/sim/grunt.ts';
import { cmd, grunts, run, runUntil, world } from './helpers.ts';

describe('movement', () => {
  it('walks tile by tile, 600 ms per step', () => {
    const w = world(['.....'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 4, y: 0 });
    run(w, 1);
    expect(g!.action.kind).toBe('move');
    expect(g!.action.end - g!.action.start).toBe(msToTicks(600));
    const ticks = runUntil(w, () => g!.x === 4 && g!.action.kind === 'idle');
    expect(ticks).toBeGreaterThanOrEqual(msToTicks(600) * 3);
  });

  it('player gruntz walk straight into holes (they are dumb)', () => {
    const w = world(['.o.'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 2, y: 0 });
    runUntil(w, () => g!.action.kind === 'death');
    expect(g!.action.item).toBe('HOLE');
  });

  it('safe pathfinding goes around holes', () => {
    const w = world(['.o.', '...'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 2, y: 0, safe: true });
    runUntil(w, () => g!.x === 2 && g!.y === 0 && g!.action.kind === 'idle');
    expect(g!.health).toBe(20);
  });

  it('gruntz never walk into water without a toob', () => {
    const w = world(['.~.'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 2, y: 0 });
    run(w, 60);
    expect(g!.x).toBe(0);
    expect(g!.action.kind).toBe('idle');
  });

  it('a toob grunt swims across water', () => {
    const w = world(['.~~.'], [{ type: 'grunt', x: 0, y: 0, tool: 'TOOB' }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 3, y: 0 });
    runUntil(w, () => g!.x === 3 && g!.action.kind === 'idle', 400);
    expect(g!.tool).toBe('TOOB');
  });

  it('arrows push gruntz along', () => {
    const w = world(['.e..'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => g!.x === 2 && g!.action.kind === 'idle');
  });
});

describe('tools', () => {
  it('gauntletz break rocks and drain stamina', () => {
    const w = world(['.R.'], [{ type: 'grunt', x: 0, y: 0, tool: 'GAUNTLETZ' }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'useTool', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => w.tileAt(1, 0) === tileId('GROUND'));
    expect(stamina(w, g!)).toBeLessThan(20);
    run(w, msToTicks(2750) + 1);
    expect(stamina(w, g!)).toBe(20);
  });

  it('shovel fills holes and digs mounds', () => {
    const w = world(['.o'], [{ type: 'grunt', x: 0, y: 0, tool: 'SHOVEL' }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'useTool', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => w.tileAt(1, 0) === tileId('MOUND'));
  });

  it('timebombs blow up everything in 3x3 after 4 s', () => {
    const w = world(['.....', '.R...'], [
      { type: 'grunt', x: 0, y: 0, tool: 'TIMEBOMB' },
      { type: 'grunt', x: 3, y: 1, ai: 'PostGuard' },
    ]);
    const [g] = grunts(w, 0);
    cmd(w, 0, { type: 'useTool', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => [...w.all('timebomb')].length === 1);
    // Run away (another grunt would die in the blast).
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 4, y: 0 });
    runUntil(w, () => [...w.all('timebomb')].length === 0, 200);
    expect(w.tileAt(1, 1)).toBe(tileId('GROUND'));
  });

  it('goober straw sucks puddles into the goo well and bakes a grunt', () => {
    const w = world(['......'], [
      { type: 'grunt', x: 0, y: 0, tool: 'GOOBER' },
      { type: 'puddle', x: 1, y: 0 },
      { type: 'puddle', x: 2, y: 0 },
      { type: 'puddle', x: 3, y: 0 },
      { type: 'puddle', x: 4, y: 0 },
    ]);
    const [g] = grunts(w);
    for (let x = 1; x <= 4; x++) {
      cmd(w, 0, { type: 'useTool', ids: [g!.id], x, y: 0, queue: true });
    }
    runUntil(w, () => [...w.all('puddle')].length === 0, 4000);
    const team = w.team(0)!;
    expect(team.ovens.filter(o => o >= 0).length).toBe(1);
  });
});

describe('combat', () => {
  it('a sword grunt kills a bare handed enemy and leaves a goo puddle', () => {
    const w = world(['....'], [
      { type: 'grunt', x: 0, y: 0, tool: 'SWORD' },
      { type: 'grunt', x: 2, y: 0, ai: 'PostGuard' },
    ]);
    const [me] = grunts(w, 0);
    const [enemy] = grunts(w, 4);
    cmd(w, 0, { type: 'attack', ids: [me!.id], target: enemy!.id });
    runUntil(w, () => !w.entities.has(enemy!.id), 2000);
    expect([...w.all('puddle')].length).toBe(1);
    expect(me!.health).toBeGreaterThan(10);
  });

  it('shield halves melee damage', () => {
    const w = world(['...'], [
      { type: 'grunt', x: 0, y: 0, tool: 'SHIELD' },
      { type: 'grunt', x: 1, y: 0, tool: 'SWORD', ai: 'Chaser' },
    ]);
    const [me] = grunts(w, 0);
    runUntil(w, () => me!.health < 20, 400);
    expect(me!.health).toBe(15);
  });

  it('spikes hurt 2 HP per second', () => {
    const w = world(['.^'], [{ type: 'grunt', x: 0, y: 0 }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => g!.x === 1 && g!.action.kind === 'idle');
    const before = g!.health;
    run(w, msToTicks(3000));
    expect(before - g!.health).toBeGreaterThanOrEqual(6);
  });
});

describe('switches', () => {
  it('green toggle switch lowers green pyramids', () => {
    const w = world(['.g.G.'], [
      { type: 'grunt', x: 0, y: 0 },
      { type: 'switch', x: 1, y: 0, targets: [[3, 0]] },
    ]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 1, y: 0 });
    runUntil(w, () => w.tileAt(3, 0) === tileId('PYRAMID_GREEN_LO'));
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 4, y: 0 });
    runUntil(w, () => g!.x === 4 && g!.action.kind === 'idle');
  });

  it('a pyramid rising under a grunt kills it', () => {
    const w = world(['.gh'], [
      { type: 'grunt', x: 2, y: 0 },
      { type: 'grunt', x: 0, y: 0 },
      { type: 'switch', x: 1, y: 0, targets: [[2, 0]] },
    ]);
    const [onPyramid, presser] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [presser!.id], x: 1, y: 0 });
    runUntil(w, () => onPyramid!.action.kind === 'death');
    expect(onPyramid!.action.item).toBe('EXPLODE');
  });
});

describe('quest', () => {
  it('bringing the warpstone to the fort wins the level', () => {
    const w = world(['.....', '.....', '.....'], [
      { type: 'grunt', x: 0, y: 1 },
      { type: 'pickup', x: 1, y: 1, item: 'WARPSTONE' },
      { type: 'fort', x: 3, y: 1 },
    ]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 2, y: 1 });
    runUntil(w, () => w.team(0)!.won, 400);
  });
});

describe('world 1 hazards', () => {
  it('a giant rock breaks as a whole and reveals what was buried', () => {
    const w = world(
      ['......', '......', '......', '......'],
      [
        { type: 'grunt', x: 0, y: 1, tool: 'GAUNTLETZ' },
        { type: 'giantRock', x: 3, y: 1 },
        { type: 'pickup', x: 3, y: 1, item: 'COIN', hidden: true },
      ],
    );
    expect(w.tileAt(2, 0)).toBe(tileId('GIANT_ROCK'));
    expect(w.tileAt(4, 2)).toBe(tileId('GIANT_ROCK'));
    const [g] = grunts(w);
    cmd(w, 0, { type: 'useTool', ids: [g!.id], x: 2, y: 1 });
    runUntil(w, () => w.tileAt(2, 1) === tileId('GROUND'));
    for (let y = 0; y < 3; y++) for (let x = 2; x < 5; x++) expect(w.tileAt(x, y)).toBe(tileId('GROUND'));
    expect(w.objectAt(3, 1, 'pickup')?.hidden).toBeFalsy();
    expect([...w.all('giantrock')]).toHaveLength(0);
  });

  it('clients never learn what is under a giant rock', async () => {
    const { ViewTracker } = await import('../src/net/view.ts');
    const w = world(['.....', '.....', '.....'], [{ type: 'giantRock', x: 2, y: 1 }]);
    const snap = new ViewTracker(0).snapshot(w);
    const rock = snap.entities.find(e => e.kind === 'giantrock');
    expect(rock && 'under' in rock ? rock.under : null).toEqual([]);
  });

  it('a boulder launcher keeps rolling new boulders', () => {
    const w = world(['.....#'], [{ type: 'ball', x: 0, y: 0, dir: 2, rate: 4, every: 20 }]);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      run(w, 1);
      for (const b of w.all('ball')) seen.add(b.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

describe('world hazards', () => {
  const field = (n = 7) => Array.from({ length: n }, () => '.'.repeat(n));

  it('a lava geyser kills a grunt standing on it when it goes off', () => {
    const w = world(field(), [{ type: 'grunt', x: 3, y: 3 }, { type: 'hazard', x: 3, y: 3, delay: 500, period: 2000 }], { theme: 'tropics' });
    const [g] = grunts(w);
    runUntil(w, () => g!.action.kind === 'death', 200);
    expect(g!.action.item).toBe('EXPLODE');
  });

  it('a static hazard leaves neighbours alone', () => {
    const w = world(field(), [{ type: 'grunt', x: 4, y: 3 }, { type: 'hazard', x: 3, y: 3, period: 500 }], { theme: 'tropics' });
    const [g] = grunts(w);
    run(w, 200);
    expect(g!.action.kind).not.toBe('death');
  });

  it('a bird drops something on a grunt; standing still gets you squashed', () => {
    const w = world(field(9), [{ type: 'grunt', x: 4, y: 4 }, { type: 'dropper', x: 4, y: 0, dir: 4, rate: 200 }], { theme: 'tropics' });
    const [g] = grunts(w);
    runUntil(w, () => [...w.all('poop')].length > 0, 400);
    runUntil(w, () => g!.action.kind === 'death', 60);
    expect(g!.action.item).toBe('SQUASH');
  });

  it('walking away from the drop saves you', () => {
    const w = world(field(9), [{ type: 'grunt', x: 4, y: 4 }, { type: 'dropper', x: 4, y: 0, dir: 4, rate: 200 }], { theme: 'tropics' });
    const [g] = grunts(w);
    runUntil(w, () => [...w.all('poop')].length > 0, 400);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 7, y: 4 });
    run(w, msToTicks(2600));
    expect(g!.action.kind).not.toBe('death');
  });

  it('a storm cloud zaps gruntz on its path', () => {
    const w = world(field(9), [{ type: 'grunt', x: 6, y: 2 }, { type: 'cloud', x: 1, y: 2, points: [[7, 2]], rate: 200 }], { theme: 'ice' });
    const [g] = grunts(w);
    runUntil(w, () => g!.action.kind === 'death', 200);
    expect(g!.action.item).toBe('ELECTROCUTE');
  });

  it('a spotlight makes a grunt sing and waits for the song to end', () => {
    const w = world(field(9), [{ type: 'grunt', x: 6, y: 4 }, { type: 'spotlight', x: 4, y: 4, radius: 2, rate: 1000 }], { theme: 'rollerz' });
    const [g] = grunts(w);
    runUntil(w, () => g!.action.kind === 'death', 200);
    expect(g!.action.item).toBe('KARAOKE');
    const s = [...w.all('spotlight')][0]!;
    expect(s.pausedAt).toBeGreaterThan(0);
  });

  it('kitchen slime creeps around its rectangle and melts gruntz', () => {
    const w = world(field(9), [{ type: 'grunt', x: 5, y: 1 }, { type: 'slime', x: 1, y: 1, x1: 5, y1: 5, rate: 200 }], { theme: 'shrunk' });
    const [g] = grunts(w);
    const s = [...w.all('slime')][0]!;
    run(w, 10);
    expect(s.x !== 1 || s.y !== 1).toBe(true);
    runUntil(w, () => g!.action.kind === 'death', 400);
    expect(g!.action.item).toBe('MELT');
  });

  it('UFO beams melt gruntz near it', () => {
    const w = world(field(9), [{ type: 'grunt', x: 6, y: 4 }, { type: 'ufo', x: 4, y: 4, points: [], spin: 500 }], { theme: 'space' });
    const [g] = grunts(w);
    runUntil(w, () => g!.action.kind === 'death', 400);
    expect(g!.action.item).toBe('MELT');
  });
});

describe('springz', () => {
  it('a springz grunt jumps a hole instead of walking into it', () => {
    const w = world(['..o..'], [{ type: 'grunt', x: 0, y: 0, tool: 'SPRING' }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 4, y: 0 });
    runUntil(w, () => g!.x === 4 && g!.action.kind === 'idle', 400);
    expect(g!.tool).toBe('SPRING');
  });

  it('...and jumps spikez so the spring survives', () => {
    const w = world(['..^..', '..^..'], [{ type: 'grunt', x: 0, y: 0, tool: 'SPRING' }]);
    const [g] = grunts(w);
    cmd(w, 0, { type: 'move', ids: [g!.id], x: 4, y: 1 });
    runUntil(w, () => g!.x === 4 && g!.action.kind === 'idle', 400);
    expect(g!.tool).toBe('SPRING');
  });
});

describe('world hazards and powerups', () => {
  it('an invulnerable grunt walks through an erupting geyser', () => {
    const w = world(['.......'], [{ type: 'grunt', x: 3, y: 0 }, { type: 'hazard', x: 3, y: 0, delay: 200, period: 500 }], { theme: 'tropics' });
    const [g] = grunts(w);
    w.edit(g!, { powerup: 'INVULNERABILITY', powerupEnd: 10_000 });
    run(w, 200);
    expect(g!.action.kind).not.toBe('death');
  });
});
