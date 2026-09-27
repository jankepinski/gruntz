import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels.ts';
import { Walkthrough } from './walkthrough.ts';
import { ROCKY } from './solutions/rocky.ts';
import { ICE } from './solutions/ice.ts';
import { TROPICS } from './solutions/tropics.ts';
import { SWEETZ } from './solutions/sweetz.ts';
import { ROLLERZ } from './solutions/rollerz.ts';
import { SHRUNK } from './solutions/shrunk.ts';
import { MINIS } from './solutions/minis.ts';
import { SPACE } from './solutions/space.ts';

/**
 * Every quest level ships with a scripted solution: proof that it can be won with the
 * real simulation. A level without a solution fails the last test.
 */
const SOLUTIONS: Record<string, (r: Walkthrough) => void> = {
  ...ROCKY,
  ...ICE,
  ...TROPICS,
  ...SWEETZ,
  ...ROLLERZ,
  ...SHRUNK,
  ...MINIS,
  ...SPACE,
  'training-1': r => {
    const g = r.gruntAt(3, 8);
    r.pickup(g, 7, 4, 'GAUNTLETZ');
    r.tool(g, 4, 4);
    r.move(g, 4, 4); // the coin under the rock
    r.move(g, 17, 12); // checkpoint switch lowers the pyramids
    r.until(() => r.tile(20, 8).endsWith('_LO'), 'pyramids down');
    r.pickup(g, 26, 4, 'WARPSTONE');
    r.deliver(g, 26, 12);
  },

  'training-2': r => {
    const a = r.gruntAt(3, 9);
    const b = r.gruntAt(3, 11);
    r.pickup(a, 6, 6, 'GAUNTLETZ');
    r.tool(a, 10, 9);
    r.move(a, 5, 9); // out of the gap
    r.move(b, 6, 13); // megaphone: the grunt machine hands out a shovel
    r.cmd({ type: 'give', slot: 0, id: b });
    expect(r.grunt(b).tool).toBe('SHOVEL');
    r.move(b, 19, 14); // over the mound in the wall
    r.tool(b, 24, 16); // dig the mound: the warpstone was buried there
    r.tool(b, 24, 16); // fill the hole again to walk onto it
    r.pickup(b, 24, 16, 'WARPSTONE');
    r.deliver(b, 26, 16);
  },

  'training-3': r => {
    const a = r.gruntAt(2, 9);
    const b = r.gruntAt(2, 11);
    const c = r.gruntAt(2, 10);
    r.move(a, 4, 4); // green switch opens the first gate for good
    r.until(() => r.tile(8, 9) === 'PYRAMID_GREEN_LO', 'green pyramids down');
    r.moveAll([
      [a, 14, 9],
      [b, 14, 10],
      [c, 12, 14],
    ]);
    r.move(c, 12, 15); // silver switch: the timed gate opens for a few seconds
    r.cmd({ type: 'move', ids: [a], x: 18, y: 9 });
    r.cmd({ type: 'move', ids: [b], x: 18, y: 11 });
    r.cmd({ type: 'move', ids: [c], x: 18, y: 13 });
    r.until(() => [a, b, c].every(id => r.grunt(id).x >= 17), 'everybody through the timed gate');
    r.move(a, 18, 5); // blue switch raises the bridge
    r.until(() => r.tile(20, 10) === 'BRIDGE', 'bridge up');
    r.moveAll([
      [a, 25, 3],
      [b, 25, 17],
    ]);
    r.until(() => r.tile(27, 10) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.pickup(c, 30, 4, 'WARPSTONE');
    r.deliver(c, 30, 14);
  },

  'rocky-secret': r => {
    const g = r.gruntAt(3, 9);
    r.pickup(g, 5, 9, 'GAUNTLETZ');
    r.tool(g, 8, 8);
    r.move(g, 8, 8); // a coin under every rock
    r.move(g, 17, 10);
    r.move(g, 18, 10);
    r.crossColumn(g, 19, 10, 20);
    r.move(g, 23, 10);
    r.crossColumn(g, 24, 10, 25);
    r.pickup(g, 28, 10, 'WARPSTONE');
    r.deliver(g, 28, 5);
  },

  'ice-secret': r => {
    const g = r.gruntAt(3, 10);
    r.move(g, 7, 5);
    r.cmd({ type: 'move', ids: [g], x: 8, y: 5 }); // whee!
    r.until(() => r.grunt(g).x === 8 && r.grunt(g).y === 16 && r.grunt(g).action.kind === 'idle', 'down the slide');
    r.pickup(g, 4, 16, 'WARPSTONE');
    r.deliver(g, 4, 18);
  },

  'tropics-secret': r => {
    const g = r.gruntAt(3, 10);
    r.pickup(g, 5, 10, 'WINGZ');
    r.move(g, 8, 10);
    r.move(g, 26, 10); // over the lava in one go (the island saves a little flight)
    r.pickup(g, 29, 10, 'WARPSTONE');
    r.deliver(g, 29, 16);
  },

  'sweetz-secret': r => {
    const a = r.gruntAt(3, 9);
    const b = r.gruntAt(3, 11);
    const [g1, g2] = [r.enemyAt(16, 8), r.enemyAt(16, 11)];
    // the long toyz: a jump rope (15 s) and a squeak toy (10 s); a yoyo is over too soon
    r.pickup(a, 9, 10, 'JUMPROPE');
    r.pickup(b, 6, 15, 'SQUEAKTOY');
    // into the gate: the swordsmen come for us, and get a toy each the moment they're close
    r.cmd({ type: 'move', ids: [a], x: 14, y: 9 });
    r.cmd({ type: 'move', ids: [b], x: 14, y: 10 });
    r.toyWhenClose([a, b], [g1!, g2!]);
    r.move(b, 4, 10); // back out of reach
    r.move(a, 20, 8);
    r.pickup(a, 26, 5, 'WARPSTONE');
    r.deliver(a, 26, 14);
  },

  'rollerz-secret': r => {
    const g = r.gruntAt(3, 10);
    r.move(g, 7, 10);
    for (const x of [8, 12, 16, 20, 24]) {
      r.crossColumn(g, x, 10, x + 1);
      if (x !== 24) r.move(g, x + 3, 10);
    }
    r.pickup(g, 29, 10, 'WARPSTONE');
    r.deliver(g, 29, 16);
  },

  'shrunk-secret': r => {
    const g = r.gruntAt(3, 10);
    r.move(g, 30, 10); // the crumb trail runs between the two slimez
    r.pickup(g, 30, 4, 'WARPSTONE');
    r.deliver(g, 30, 15);
  },

  'minis-secret': r => {
    const g = r.gruntAt(3, 10);
    r.pickup(g, 5, 12, 'SHOVEL');
    r.move(g, 5, 18); // the ballz start at x=8: go round the tee
    r.move(g, 22, 19);
    r.tool(g, 24, 19);
    r.tool(g, 24, 19);
    r.pickup(g, 24, 19, 'WARPSTONE');
    r.move(g, 28, 19);
    r.move(g, 30, 13);
    r.deliver(g, 30, 11);
  },

  'space-secret': r => {
    const g = r.gruntAt(3, 11);
    r.move(g, 5, 11); // super speed
    r.move(g, 16, 11);
    r.waitUfo(16, 5, 6);
    r.pickup(g, 16, 5, 'WARPSTONE');
    r.move(g, 16, 11);
    r.move(g, 28, 11);
    r.deliver(g, 29, 18);
  },
};

describe('quest levels can be won', () => {
  for (const [id, solve] of Object.entries(SOLUTIONS)) {
    it(id, () => {
      const level = LEVELS.get(id);
      expect(level, id).toBeDefined();
      solve(new Walkthrough(level!));
    });
  }

  it('every quest level has a solution', () => {
    const missing = [...LEVELS.values()].filter(l => l.mode === 'quest' && !SOLUTIONS[l.id]).map(l => l.id);
    expect(missing).toEqual([]);
  });
});
