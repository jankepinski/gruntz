import { expect } from 'vitest';
import rollerz1 from '../../../../content/src/levels/rollerz-1.ts';
import rollerz2 from '../../../../content/src/levels/rollerz-2.ts';
import rollerz3 from '../../../../content/src/levels/rollerz-3.ts';
import rollerz4 from '../../../../content/src/levels/rollerz-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { crossBallLane, overToggle, throughHazards } from './helpers.ts';
import { marks } from './marks.ts';

export const ROLLERZ: Record<string, (r: Walkthrough) => void> = {
  'rollerz-1': r => {
    const m = marks(rollerz1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const guard = r.enemyAt(...m.at('K'));
    const chaser = r.enemyAt(...m.at('C'));
    r.pickup(a, ...m.at('n'), 'NERFGUN');
    r.pickup(b, ...m.at('b'), 'GRAVITYBOOTZ');
    r.pickup(c, ...m.at('k'), 'CLUB');
    // over the 8-ball lane
    const [, laneY] = m.at('O');
    const [kx, ky] = m.at('K');
    for (const [g, x] of [
      [a, kx - 3],
      [b, kx - 1],
      [c, kx + 1],
    ] as const)
      crossBallLane(r, g, x, laneY, laneY + 1, laneY - 2);
    // the bridge guard: a nerf shot from the diagonal knocks him into the pit
    r.move(a, kx - 3, ky + 3);
    r.attack(a, guard);
    // over the bridge onto the gaming floor
    const pit = m.all('_').map(p => p[1]);
    const [top, bottom] = [Math.min(...pit), Math.max(...pit)];
    for (const [g, dx] of [
      [a, -3],
      [b, 3],
      [c, 4],
    ] as const) {
      r.move(g, kx, bottom + 1);
      r.move(g, kx, top - 1);
      r.move(g, kx + dx, top - 2);
    }
    // the secret: the slot machine's green wormhole payz out
    const [zx, zy] = m.at('Z');
    r.move(a, zx, zy + 2); // (round the other two, not through them)
    r.warp(a, zx, zy, ...m.at('t'));
    r.move(a, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.warp(a, ...m.at('Y'), ...m.at('s'));
    // bootz over the spikez to the blue switch: the balcony stairz open
    r.move(b, ...m.at('x'));
    const [gx, gy] = m.at('G');
    r.until(() => r.tile(gx, gy) === 'PYRAMID_GREEN_LO', 'balcony stairz open');
    // up the trapdoor corridor and the stairz to the stage
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => q - p);
    const [sx, sy] = m.all('▲').find(([, y]) => y === 14)!;
    for (const g of [c, a, b]) {
      r.move(g, sx, rows[0]! + 2);
      throughHazards(r, g, sx, rows, -1);
      r.move(g, sx, sy - 1);
      r.move(g, sx - 1 - [c, a, b].indexOf(g), sy - 2); // west of the spotlight's sweep
    }
    // together up to the balcony between two passes of the spotlight
    for (const [g, dx, dy] of [
      [c, 0, -3],
      [a, 1, -2],
      [b, -1, -2],
    ] as const) {
      r.waitSpot(sx, 10, 4);
      r.move(g, gx, gy - 2);
      r.move(g, gx + dx, gy - 2 + dy);
    }
    r.gangUp([c, a, b], chaser);
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    // back down: spotlight, stairz, trapdoorz, bridge, 8-ballz, fort
    r.move(c, gx, gy - 1);
    r.waitSpot(sx, 10, 4);
    r.move(c, sx, sy - 1);
    r.move(c, sx, sy + 1);
    throughHazards(r, c, sx, [...rows].reverse(), 1);
    r.move(c, kx, top - 1);
    r.move(c, kx, bottom + 1);
    crossBallLane(r, c, kx, laneY, laneY - 2, laneY + 1);
    r.deliver(c, ...m.at('F'));
  },

  'rollerz-2': r => {
    const m = marks(rollerz2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const welder = r.enemyAt(...m.at('D'));
    /** Set a timebomb from where the grunt standz, walk off and wait for the bang. */
    const blast = (g: number, x: number, y: number, safe: [number, number], done: () => boolean) => {
      r.until(() => r.w.tick >= r.grunt(g).staminaEnd, 'breath back');
      r.cmd({ type: 'useTool', ids: [g], x, y });
      r.until(() => !!r.w.objectAt(x, y, 'timebomb'), 'the timebomb set');
      r.move(g, ...safe);
      r.until(done, `the blast at ${x},${y}`);
    };
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('s'), 'SPY');
    r.pickup(c, ...m.at('u'), 'GUNHAT');
    r.move(a, ...m.all('z')[1]!); // megaphone: a timebomb
    // spy gear on the rope line: one plain brown brick among the red, blue and black
    const [yx, yy] = m.at('y');
    r.move(b, yx, yy + 2);
    r.tool(b, yx, yy, () => !!r.w.objectAt(yx, yy, 'brickz')?.revealed.includes(0));
    r.breakBrickz(a, yx, yy);
    // the secret: a timebomb by the black brick, the black brick by the gold
    r.cmd({ type: 'give', slot: 0, id: b });
    const [kx, ky] = m.at('K');
    const [gx, gy] = m.at('G');
    r.move(b, kx + 2, ky);
    blast(b, kx + 1, ky, [kx + 6, ky], () => !r.w.objectAt(gx, gy, 'brickz'));
    r.move(b, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    // c in the gun hat goes up first: the stopwatch freezes the welder for a shot
    const [sx, sy] = m.all('▲').find(([, y]) => y === 25)!; // lobby -> vault floor
    for (const g of [c, a, b]) {
      r.move(g, yx, yy + 1);
      r.move(g, yx, yy - 1);
      r.move(g, yx + 3 - [c, a, b].indexOf(g), yy - 1); // (a one-tile strip: first in goes furthest)
    }
    r.move(c, sx, sy + 1);
    r.move(c, ...m.at('x'));
    expect(r.grunt(welder).frozen).toBe(true);
    r.attack(c, welder);
    // everyone up the approach: past one spotlight, over the 8-ball lane, past the other
    const [, laneY] = m.at('O');
    const [, ly] = m.at('L');
    const [, my] = m.at('M');
    for (const g of [a, b, c]) {
      r.move(g, sx, sy + 1);
      r.move(g, sx + 1, sy - 1);
      r.waitSpot(sx, ly, 5);
      r.move(g, sx, laneY + 1);
      crossBallLane(r, g, sx, laneY, laneY + 1, laneY - 1);
      r.waitSpot(sx, my, 5);
      r.move(g, sx - 2 - [a, b, c].indexOf(g), my - 1);
    }
    // the gold safe door: the second megaphone, the second timebomb
    r.move(b, ...m.all('z')[0]!);
    r.cmd({ type: 'give', slot: 0, id: a });
    expect(r.grunt(a).tool).toBe('TIMEBOMB');
    const [jx, jy] = m.at('J');
    blast(a, jx - 1, jy + 1, [jx - 6, jy + 2], () => !r.w.objectAt(jx, jy, 'brickz'));
    r.move(a, jx - 1, jy + 1);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // back out the same way, and to the fort
    r.move(a, jx, jy);
    r.move(a, jx - 2, jy + 2);
    r.waitSpot(sx, my, 5);
    r.move(a, sx, laneY - 1);
    crossBallLane(r, a, sx, laneY, laneY - 1, laneY + 1);
    r.waitSpot(sx, ly, 5);
    r.move(a, sx + 1, sy - 1);
    r.move(a, sx, sy + 1);
    r.move(a, yx, yy - 1);
    r.move(a, yx, yy + 1);
    r.deliver(a, ...m.at('F'));
  },

  'rollerz-3': r => {
    const m = marks(rollerz3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const [guard] = m.all('K').map(p => r.enemyAt(...p));
    const club = r.enemyAt(...m.at('D'));
    const toyer = r.enemyAt(...m.at('T'));
    r.pickup(a, ...m.at('v'), 'GLOVEZ');
    r.pickup(b, ...m.at('t'), 'TOOB');
    r.pickup(c, ...m.at('k'), 'CLUB');
    // b swims to the island: its switch opens the stairz to the balcony
    r.move(b, ...m.at('s'));
    const [gx, gy] = m.at('G');
    r.until(() => r.tile(gx, gy) === 'PYRAMID_GREEN_LO', 'balcony stairz open');
    // a punches the west walkway's guard from the side, into the pit
    const [kx, ky] = m.all('K')[0]!;
    r.move(a, kx - 1, ky + 1);
    r.attack(a, guard!);
    // over the walkway and up onto the stage
    const [wx, wy] = m.all('▲').find(([x]) => x === kx)!;
    for (const [g, dx] of [
      [a, 1],
      [b, 2],
      [c, 3],
    ] as const) {
      r.move(g, kx, ky + 1);
      r.move(g, wx, wy - 1);
      r.move(g, wx + dx, wy - 1);
    }
    // across the stage: each spotlight sweeps past one point of the route
    const spots = m.all('M').sort((p, q) => q[1] - p[1]); // nearest the pit first
    const [s1x, s1y] = spots[0]!;
    const [, s2y] = spots[1]!;
    const [, s3y] = spots[2]!;
    for (const [g, k] of [
      [c, 0],
      [a, 1],
      [b, 2],
    ] as const) {
      r.move(g, s1x - 3, s1y + 3); // wait close to where the first spotlight sweeps past
      r.waitSpot(s1x, s1y + 3, 4.5);
      r.move(g, gx - 1 + k, wy - 1);
      r.move(g, gx, s2y + 3);
      r.waitSpot(gx, s2y, 4.5);
      r.move(g, gx, s3y + 2);
      r.waitSpot(gx, s3y, 4.5);
      r.move(g, gx, gy + 1);
      r.move(g, gx - 1 + k, gy - 3);
    }
    r.gangUp([c, a, b], club);
    r.gangUp([c, a, b], toyer);
    // the secret: up on the catwalk
    r.move(a, ...m.at('Q'));
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret room open');
    // back across the stage, over the walkway, to the hall
    for (const g of [c, a]) {
      r.move(g, gx, gy); // (wait on the lowered door: the tile below is on the spotlight's edge)
      r.waitSpot(gx, s3y, 4.5);
      r.move(g, gx, s2y + 3);
      r.waitSpot(gx, s2y, 4.5);
      r.move(g, s1x + 3, wy - 1);
      r.waitSpot(s1x, s1y + 3, 4.5);
      r.move(g, wx, wy - 1);
      r.move(g, kx, ky + 1);
      r.move(g, kx + 1 + [c, a].indexOf(g), ky + 2);
    }
    r.move(a, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.deliver(c, ...m.at('F'));
  },

  'rollerz-4': r => {
    const m = marks(rollerz4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const welder = r.enemyAt(...m.at('D'));
    const bouncers = m.all('S').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('u'), 'GUNHAT');
    r.pickup(c, ...m.at('v'), 'WINGZ');
    // the secret: wingz out to the platform in the atrium and back
    const [lx, ly] = m.at('L');
    const edge = Math.max(...m.all('_').map(p => p[1])) + 1;
    r.move(c, lx, edge);
    r.move(c, lx, ly);
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.move(c, lx, edge);
    r.pickup(c, ...m.at('k'), 'CLUB');
    // over the bridge that risez and sinkz on its own
    const bridge = m.all('A');
    const [bx] = bridge[0]!;
    const [, sy] = m.all('▲').find(([x, y]) => x === bx && y > bridge[0]![1] - 2)!; // atrium -> balcony
    for (const [g, dx] of [
      [b, 0],
      [a, -1],
      [c, 1],
    ] as const) {
      r.move(g, bx, edge);
      overToggle(r, g, bridge, [bx, sy - 2]);
      r.move(g, bx + dx * 2, sy - 3);
    }
    // the gun hat grunt takes the welder on
    r.attack(b, welder);
    // up the corridor of trapdoorz to the lounge
    const [tx, ty] = m.all('▲').find(([x]) => x !== bx)!;
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => q - p);
    for (const [g, dx] of [
      [a, -3],
      [b, 0],
      [c, 3],
    ] as const) {
      r.move(g, tx, rows[0]! + 2);
      throughHazards(r, g, tx, rows, -1);
      r.move(g, tx, ty - 1);
      r.move(g, tx + dx, ty - 2);
    }
    for (const bouncer of bouncers) r.gangUp([a, b, c], bouncer);
    // up the grand stairz right behind an 8-ball: the next one is far behind
    const [ox] = m.at('O');
    const [, gy] = m.all('▲').find(([x]) => x === ox)!;
    const behind = (y0: number, y1: number) =>
      [...r.w.all('ball')].some(ball => ball.state === 'roll' && ball.x === ox && ball.y >= y0 && ball.y <= y1);
    if (r.grunt(a).x < ox) {
      // (the fight left a on the other side of the lane)
      r.move(a, ox - 1, gy + 4);
      r.crossColumn(a, ox, gy + 4, ox + 1);
    }
    r.move(a, ox + 1, gy + 2);
    r.until(() => behind(gy + 2, gy + 4), 'an 8-ball just past the stairz');
    r.move(a, ox, gy + 1);
    r.move(a, ox + 1, gy - 2);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // and down again behind another one
    r.move(a, ox + 1, gy - 2);
    r.until(() => behind(gy, gy + 1), 'an 8-ball just past the top of the stairz');
    r.move(a, ox, gy + 1);
    r.move(a, ox + 1, gy + 2);
    // down through the trapdoorz, over the bridge, to the fort
    r.move(a, tx, ty - 1);
    r.move(a, tx, rows[rows.length - 1]! - 1);
    throughHazards(r, a, tx, [...rows].reverse(), 1);
    r.move(a, bx, sy - 1);
    r.move(a, bx, sy); // wait on the stairz right above the bridge
    overToggle(r, a, bridge, [bx, edge]);
    r.deliver(a, ...m.at('F'));
  },
};
