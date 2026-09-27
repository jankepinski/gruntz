import { expect } from 'vitest';
import ice1 from '../../../../content/src/levels/ice-1.ts';
import ice2 from '../../../../content/src/levels/ice-2.ts';
import ice3 from '../../../../content/src/levels/ice-3.ts';
import ice4 from '../../../../content/src/levels/ice-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { cloudsAway } from './helpers.ts';
import { marks } from './marks.ts';

export const ICE: Record<string, (r: Walkthrough) => void> = {
  'ice-1': r => {
    const m = marks(ice1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const chaser = r.enemyAt(...m.at('C'));
    const thrower = r.enemyAt(...m.at('K'));
    const [toob1, toob2] = m.all('t');
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...toob1!, 'TOOB');
    r.pickup(c, ...toob2!, 'TOOB');
    // the secret: c swims to the islet in the north west while a waits by the red wormhole
    const [sx, sy] = m.at('S');
    r.move(a, sx, sy + 1);
    r.move(c, 15, 10);
    r.move(c, ...m.at('T'));
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(a, sx, sy, ...m.at('L'));
    r.move(a, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.warp(a, ...m.at('O'), ...m.at('l'));
    // b swims out to the island between the cloud's passes and raises the bridge
    r.move(b, 28, 34);
    cloudsAway(r, 28, 28, 9, 'the cloud away from the swim');
    r.move(b, 28, 24);
    r.move(b, ...m.at('b'));
    const bridge = m.all('-');
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'BRIDGE'), 'bridge up');
    const [bx] = bridge[0]!;
    r.move(a, bx, 35);
    r.move(a, bx, 23);
    const [wx, wy] = m.at('w');
    r.tool(a, wx, wy + 1); // one rock of the ring
    r.move(a, wx - 2, wy + 2);
    r.pickup(b, wx, wy, 'WARPSTONE');
    // c swims on to the east islet and lowers the pyramid at the shelf stairz
    cloudsAway(r, 39, 10, 6, 'the east cloud away');
    r.move(c, ...m.at('G'));
    const [px, py] = m.at('P');
    r.until(() => r.tile(px, py) === 'PYRAMID_GREEN_LO', 'stairz open');
    r.move(c, 46, 20);
    r.move(c, 49, 24);
    for (const [g, dx] of [
      [a, -1],
      [b, 1],
    ] as const) {
      r.move(g, bx, 23);
      r.move(g, bx, 34);
      r.move(g, bx + dx, 36);
    }
    r.moveAll([
      [a, 50, 36],
      [b, 45, 38],
    ]);
    r.gangUp([a, c], chaser);
    r.moveAll([
      [a, px, py + 1],
      [c, px + 1, py + 1],
    ]);
    r.moveAll([
      [a, 51, 17],
      [c, 52, 18],
    ]);
    r.gangUp([a, c], thrower);
    r.deliver(b, ...m.at('F'));
  },

  'ice-2': r => {
    const m = marks(ice2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const chaser = r.enemyAt(...m.at('E'));
    const [s1, s2] = m.all('s');
    r.pickup(a, ...s1!, 'SPRING');
    r.pickup(b, ...s2!, 'SPRING');
    r.pickup(c, ...m.at('B'), 'GRAVITYBOOTZ');
    // springz hop the columns of holez, the bootz grunt walks the spikez
    r.move(a, 16, 8);
    r.move(a, 31, 8);
    r.move(b, 16, 10);
    r.move(b, 31, 10);
    r.move(c, 16, 36);
    r.move(c, ...m.at('Q')); // the secret switch at the end of the spike route
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret door open');
    r.move(c, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    r.move(c, 16, 36);
    r.move(c, 31, 36);
    // gather by the bridge behind the storm cloud
    cloudsAway(r, 33, 22, 8, 'the cloud away from the bridge');
    // (springz gruntz hop into abysses when that looks shorter: safe paths here)
    r.moveSafe(a, 35, 22);
    r.moveSafe(b, 35, 21);
    r.moveSafe(c, 35, 23);
    r.moveSafe(a, 45, 22); // hop the gapz
    r.move(a, ...m.at('b'));
    const gaps = m.all(':');
    r.until(() => gaps.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'gapz closed');
    r.moveSafe(b, 46, 23);
    r.moveSafe(c, 45, 21);
    r.gangUp([a, b, c], chaser);
    // the yellow switch flips the arrowz towards the stairz: ride them up
    r.move(b, ...m.at('y'));
    const arrows = m.all('⇓');
    r.until(() => arrows.every(([x, y]) => r.tile(x, y) === 'ARROW2_N'), 'arrowz flipped');
    const [ax] = arrows[0]!;
    const bottom = Math.max(...arrows.map(p => p[1]));
    r.move(a, ax, bottom + 1);
    r.cmd({ type: 'move', ids: [a], x: ax, y: bottom });
    r.until(() => r.grunt(a).y < Math.min(...arrows.map(p => p[1])), 'a to ride the arrowz');
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    r.move(a, ax, Math.min(...arrows.map(p => p[1])) - 1);
    // flip them back: now they carry the carrier down
    r.move(b, 46, 27);
    r.move(b, ...m.at('y'));
    r.until(() => arrows.every(([x, y]) => r.tile(x, y) === 'ARROW2_S'), 'arrowz flipped back');
    r.cmd({ type: 'move', ids: [a], x: ax, y: Math.min(...arrows.map(p => p[1])) });
    r.until(() => r.grunt(a).y > bottom, 'a to ride down');
    r.deliver(a, ...m.at('F'));
  },

  'ice-3': r => {
    const m = marks(ice3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const clubber = r.enemyAt(...m.at('C'));
    const bombers = m.all('B').map(p => r.enemyAt(...p));
    const guard = r.enemyAt(...m.at('E'));
    /** Set a timebomb on a tile, walk away and wait for the bang. */
    const blast = (x: number, y: number, safeX: number, safeY: number, broken: () => boolean) => {
      r.until(() => r.w.tick >= r.grunt(a).staminaEnd, 'a to get its breath back');
      r.cmd({ type: 'useTool', ids: [a], x, y });
      r.until(() => !!r.w.objectAt(x, y, 'timebomb'), 'the timebomb set');
      r.move(a, safeX, safeY);
      r.until(broken, `the blast at ${x},${y}`);
    };
    r.pickup(a, ...m.at('k'), 'TIMEBOMB');
    r.pickup(b, ...m.at('v'), 'GLOVEZ');
    r.pickup(c, ...m.at('j'), 'ROCK');
    r.moveAll([
      [b, 5, 30],
      [c, 5, 41],
    ]);
    blast(14, 35, 9, 35, () => r.tile(15, 35) !== 'ROCK');
    blast(15, 35, 10, 35, () => r.tile(16, 35) !== 'ROCK');
    // up the walkway; the club guard on its corner gets a boxing glove from the side
    for (const [g, x] of [
      [b, 30],
      [c, 29],
      [a, 28],
    ] as const) {
      r.moveSafe(g, 24, 27);
      r.moveSafe(g, 24, 18);
      r.moveSafe(g, x, 18);
    }
    const [kx, ky] = m.at('C');
    // he comes down the walkway at us: every punch knocks him back towardz the crevasse,
    // and c throws rockz over b's head
    r.gangUp([b, c], clubber);
    // the secret: a side arm of the walkway ends at a trigger for a red wormhole
    for (const [g, x] of [
      [b, 33],
      [c, 35],
      [a, 34],
    ] as const) {
      r.moveSafe(g, kx, ky - 1);
      r.moveSafe(g, kx, 9);
      r.moveSafe(g, x, 8);
    }
    const [sx, sy] = m.at('S');
    r.move(b, sx, sy + 1);
    r.moveSafe(c, kx, 17);
    r.moveSafe(c, kx, ky);
    r.moveSafe(c, ...m.at('T'));
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(b, sx, sy, ...m.at('L'));
    r.move(b, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.warp(b, ...m.at('O'), ...m.at('l'));
    r.moveSafe(c, kx, ky);
    r.moveSafe(c, kx, 9);
    for (const [i, bomber] of bombers.entries()) {
      const [bx, by] = m.all('B')[i]!;
      r.moveSafe(c, bx, by + 4); // below the snow pillar, within a throw
      r.attack(c, bomber);
    }
    // gold brickz and a giant snowball: timebombz
    blast(45, 5, 40, 7, () => r.tile(46, 5) !== 'BRICKZ');
    const [gx, gy] = m.at('G');
    blast(gx - 2, gy, 42, 7, () => r.tile(gx, gy) !== 'GIANT_ROCK');
    r.pickup(b, ...m.at('w'), 'WARPSTONE');
    for (const [g, x] of [
      [a, 22],
      [b, 23],
      [c, 26],
    ] as const) {
      r.moveSafe(g, kx, 9);
      r.moveSafe(g, kx, ky);
      r.moveSafe(g, 24, ky);
      r.moveSafe(g, 24, 26);
      r.moveSafe(g, x, 27);
    }
    // the landing guard: rockz from the strip below, out of his reach
    r.moveSafe(c, 56, 24);
    r.attack(c, guard);
    r.moveSafe(b, 51, 26);
    r.deliver(b, ...m.at('F'));
  },

  'ice-4': r => {
    const m = marks(ice4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const clubber = r.enemyAt(...m.at('C'));
    const shield = r.enemyAt(...m.at('D'));
    const toyer = r.enemyAt(...m.at('T'));
    const down = (ch: string) => m.all(ch).every(([x, y]) => r.tile(x, y).endsWith('_LO'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('s'), 'SPY');
    r.pickup(c, ...m.at('v'), 'WINGZ');
    // wingz over the moat to the islet: the drawbridge comes down
    r.move(c, 55, 33);
    r.move(c, ...m.at('b'));
    const bridge = m.all(':');
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'drawbridge down');
    r.move(c, 55, 33);
    const [bx] = bridge[0]!;
    r.moveAll([
      [a, bx - 1, 33],
      [b, bx, 33],
      [c, bx + 1, 33],
    ]);
    // up onto the ramparts between two sweeps of the storm cloud
    for (const [g, x] of [
      [a, bx - 3],
      [b, bx - 2],
      [c, bx + 2],
    ] as const) {
      cloudsAway(r, bx, 26, 9, 'the cloud away from the stairz');
      r.moveSafe(g, bx, 32);
      r.moveSafe(g, bx, 27);
      r.moveSafe(g, x, 24);
    }
    r.gangUp([a, b, c], clubber);
    // orange switch 1 opens the south gate: the south hall has the secret switch
    r.move(a, ...m.at('Y'));
    r.until(() => down('K'), 'south gate down');
    r.move(c, bx, 20);
    r.move(c, ...m.at('Q'));
    r.until(() => down('q'), 'secret door open');
    r.move(c, bx, 20);
    r.move(c, bx, 23);
    // round the ramparts to the north: orange switch 2 opens the north gate (and shuts the south one)
    r.moveAll([
      [a, 18, 12],
      [b, 19, 12],
      [c, 20, 12],
    ]);
    r.gangUp([a, b, c], toyer); // or his beach ball sends someone bouncing off
    r.move(c, ...m.at('P'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.move(b, ...m.at('Z'));
    r.until(() => down('N'), 'north gate down');
    r.gangUp([a, b, c], shield); // all at once, the moment the gate is down
    const [nx, ny] = m.all('n').sort((p, q) => p[0] - q[0])[0]!;
    // spy gear: which brickz are which
    r.tool(b, nx, ny, () => !!r.w.objectAt(nx, ny, 'brickz')?.revealed.includes(0));
    r.breakBrickz(a, nx, ny);
    r.move(a, nx - 2, ny - 1);
    r.pickup(b, ...m.at('w'), 'WARPSTONE');
    // out through the north gate and all the way round to the drawbridge and the fort
    r.moveAll([
      [a, 18, 20],
      [b, 19, 20],
      [c, 20, 20],
    ]);
    for (const [g, x] of [
      [a, bx - 1],
      [b, bx],
      [c, bx + 1],
    ] as const) {
      r.moveSafe(g, bx, 24); // two rows clear of the cloud's lane
      cloudsAway(r, bx, 26, 9, 'the cloud away from the stairz');
      r.moveSafe(g, bx, 32);
      r.moveSafe(g, x, 34);
    }
    r.moveSafe(b, 61, 20);
    r.deliver(b, ...m.at('F'));
  },
};
