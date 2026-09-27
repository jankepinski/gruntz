import { expect } from 'vitest';
import shrunk1 from '../../../../content/src/levels/shrunk-1.ts';
import shrunk2 from '../../../../content/src/levels/shrunk-2.ts';
import shrunk3 from '../../../../content/src/levels/shrunk-3.ts';
import shrunk4 from '../../../../content/src/levels/shrunk-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { marks } from './marks.ts';

/**
 * Cross a slime's straight path at (x, y) when the slime is well away from that point:
 * from the tile before it to the tile after it, going (dx, dy).
 */
function pastSlime(r: Walkthrough, g: number, x: number, y: number, dx: number, dy: number): void {
  r.move(g, x - dx, y - dy);
  r.waitSlime((sx, sy) => Math.abs(sx - x) + Math.abs(sy - y) > 7, `the slime away from ${x},${y}`);
  r.move(g, x + dx, y + dy);
}

export const SHRUNK: Record<string, (r: Walkthrough) => void> = {
  'shrunk-1': r => {
    const m = marks(shrunk1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const thief = r.enemyAt(...m.at('T'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('k'), 'SHOVEL');
    // the secret: dig the right crumb mound (not the one with the timebomb in it)
    const [wx, wy] = m.at('W');
    r.tool(b, wx, wy); // dig...
    r.tool(b, wx, wy); // ...and fill the hole again to walk onto what was buried
    r.move(b, wx, wy);
    expect(r.w.team(0)!.stats.letters).toContain('W');
    // past the slime's round: its south side, then its north side
    const [s0x, s0y] = m.at('S');
    const [s1x, s1y] = m.at('s');
    const cx = Math.round((s0x + s1x) / 2);
    for (const [g, k] of [
      [a, 0],
      [b, 1],
      [c, 2],
    ] as const) {
      pastSlime(r, g, cx, s1y, 0, -1);
      pastSlime(r, g, cx, s0y, 0, -1);
      r.move(g, cx + 3 + k, s0y - 2);
    }
    // two of the four switchez, the right two: the gate's three pyramidz go down
    const [ax, ay] = m.at('a');
    const [dx, dy] = m.at('d');
    r.move(c, ax, ay + 2);
    r.move(c, ax, ay);
    r.move(c, ax, ay + 2);
    r.move(c, dx, dy + 2);
    r.move(c, dx, dy);
    const gate = m.all('XYZ');
    r.until(() => gate.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'the gate open');
    // up the stool and along the counter corridor, past the outletz
    const [tx, ty] = m.all('▲').find(([, y]) => y === 13)!;
    const cols = [...new Set(m.all('efj').map(p => p[0]))].sort((p, q) => p - q);
    const [gx] = gate[0]!;
    for (const [g, row] of [
      [a, 10],
      [b, 9],
      [c, 11],
    ] as const) {
      r.move(g, tx, ty + 1);
      r.move(g, tx, ty - 1);
      for (const x of cols) {
        r.move(g, x - 1, row);
        r.passHazard(g, x, row, x + 1, row);
      }
      r.move(g, gx - 1 - [a, b, c].indexOf(g), row);
    }
    // a knocks the sugar cube off the shelf stairz; up to the thief and the warpstone
    const [rx, ry] = m.at('R');
    r.move(a, gx, ry + 1);
    r.tool(a, rx, ry);
    r.gangUp([a, b, c], thief);
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    // home: down the corridor, the stool, the slime, the fort
    r.move(c, rx, ry);
    r.move(c, gx, ry + 1);
    for (const x of [...cols].reverse()) {
      r.move(c, x + 1, ry + 1);
      r.passHazard(c, x, ry + 1, x - 1, ry + 1);
    }
    r.move(c, tx, ty - 1);
    r.move(c, tx, ty + 1);
    r.move(c, cx + 3, s0y - 2);
    pastSlime(r, c, cx, s0y, 0, 1);
    pastSlime(r, c, cx, s1y, 0, 1);
    r.deliver(c, ...m.at('F'));
  },

  'shrunk-2': r => {
    const m = marks(shrunk2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const guard = r.enemyAt(...m.at('D'));
    const [t1, t2] = m.all('t');
    r.pickup(a, ...t2!, 'TOOB');
    r.pickup(b, ...t1!, 'TOOB');
    r.pickup(c, ...m.at('k'), 'SWORD');
    // the secret: b swims round into the grotto behind the west wall
    r.move(b, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    // a swims out to the islet: the time switch raises the long bridge for c
    const bridge = m.all('-');
    const [bx] = bridge[0]!;
    const south = Math.max(...bridge.map(p => p[1]));
    const north = Math.min(...bridge.map(p => p[1]));
    r.move(c, bx, south + 1);
    const [xx, xy] = m.at('x');
    const timed = () => {
      r.move(a, xx, xy + 1);
      r.move(a, xx, xy);
      r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'BRIDGE'), 'the bridge up');
    };
    timed();
    r.move(c, bx, north - 1);
    // the swimmerz to the north shore too
    r.moveAll([
      [a, bx + 2, north - 1],
      [b, bx - 2, north - 1],
    ]);
    // up to the counter and past the slime's round (its west side, then its east side)
    const [stx, sty] = m.all('▲').find(([, y]) => y === north - 3)!;
    const [s0x] = m.at('S');
    const [s1x] = m.at('s');
    const row = sty - 5;
    for (const [g, dy] of [
      [c, 0],
      [a, -1],
      [b, 1],
    ] as const) {
      r.move(g, stx, sty + 1);
      r.move(g, stx, sty - 1);
      pastSlime(r, g, s0x, row + dy, 1, 0);
      pastSlime(r, g, s1x, row + dy, 1, 0);
    }
    // the sword guard on the faucet tower, the warpstone on top
    const [fx, fy] = m.all('▲').find(([, y]) => y < sty)!;
    for (const [g, k] of [
      [c, 0],
      [a, -1],
      [b, -2],
    ] as const) {
      r.move(g, fx + k, fy + 1);
    }
    r.gangUp([c, a, b], guard);
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    // home: past the slime, down to the shore, and the bridge once more
    r.move(c, fx, fy + 1);
    pastSlime(r, c, s1x, row, -1, 0);
    pastSlime(r, c, s0x, row, -1, 0);
    r.move(c, stx, sty - 1);
    r.move(c, stx, sty + 1);
    r.move(c, bx, north - 1);
    r.move(a, stx, sty - 1);
    r.move(a, stx, sty + 1);
    r.move(a, bx + 2, north - 1);
    r.move(a, xx, xy - 1);
    r.until(() => r.w.objectAt(xx, xy, 'switch')?.disabled === false, 'the time switch ready again');
    timed();
    r.move(c, bx, south + 1);
    r.deliver(c, ...m.at('F'));
  },

  'shrunk-3': r => {
    const m = marks(shrunk3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const bomber = r.enemyAt(...m.at('B'));
    const guard = r.enemyAt(...m.at('K'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('q'), 'GOOBER');
    r.pickup(c, ...m.at('k'), 'SWORD');
    // four puddlez of goo: a fourth grunt, who waits by the red mouse hole
    for (const p of m.all('u')) r.suck(b, ...p);
    const d = r.bake(...m.at('p'));
    const [sx, sy] = m.at('S');
    r.move(d, sx - 1, sy);
    // up to shelf 1 and along its corridor of outletz
    const [wx, wy] = m.all('▲').find(([, y]) => y === 31)!;
    const cols = [...new Set(m.all('efr').map(p => p[0]))].sort((p, q) => p - q);
    const row = m.all('e')[1]![1];
    for (const g of [c, a, b]) {
      r.move(g, wx, wy + 1);
      r.move(g, wx, wy - 2);
      for (const x of cols) {
        r.move(g, x - 1, row);
        r.passHazard(g, x, row, x + 1, row);
      }
      r.move(g, cols[cols.length - 1]! + 3 + [c, a, b].indexOf(g), row);
    }
    // up the east stairz between two cans
    const [ox] = m.at('O');
    const [, ey] = m.all('▲').find(([x]) => x === ox)!;
    // a can smashes at the foot of the stairz: the next one is a good while away
    const smashed = () => [...r.w.all('ball')].some(ball => ball.state === 'break' && ball.x === ox && ball.y > ey);
    for (const [g, k] of [
      [c, 0],
      [a, 1],
      [b, 2],
    ] as const) {
      r.move(g, ox + 1, ey + 1);
      r.until(smashed, 'a can to smash');
      r.move(g, ox, ey);
      r.move(g, ox - 2 - k, ey - 2);
    }
    // the time bomber: all three at once
    r.gangUp([c, a, b], bomber);
    // a punches the sugar lump off the top shelf's stairz
    const [gx, gy] = m.at('G');
    r.move(a, gx, gy + 2);
    r.tool(a, gx, gy + 1);
    expect([...r.w.all('giantrock')]).toHaveLength(0);
    const [tx, ty] = m.all('▲').find(([, y]) => y === gy - 2)!;
    for (const [g, k] of [
      [c, 0],
      [a, 1],
      [b, 2],
    ] as const) {
      r.move(g, tx, ty + 1);
      r.move(g, tx + k, ty - 2);
    }
    r.gangUp([c, a, b], guard);
    // the secret trigger up here opens the red mouse hole down on the floor, where d waits
    r.move(b, ...m.at('T'));
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'the mouse hole open');
    r.warp(d, sx, sy, ...m.at('z'));
    r.move(d, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.warp(d, ...m.at('Y'), ...m.at('l'));
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    // home: down the stairz, the cans, the outletz, the west stairz
    r.move(c, tx, ty + 1);
    r.move(c, ox - 2, ey - 2);
    r.move(c, ox - 1, ey - 1);
    r.until(smashed, 'a can to smash');
    r.move(c, ox, ey + 1);
    r.move(c, ox + 1, ey + 1);
    r.move(c, cols[cols.length - 1]! + 3, row);
    for (const x of [...cols].reverse()) {
      r.move(c, x + 1, row);
      r.passHazard(c, x, row, x - 1, row);
    }
    r.move(c, wx, wy - 2);
    r.move(c, wx, wy + 1);
    r.deliver(c, ...m.at('F'));
  },

  'shrunk-4': r => {
    const m = marks(shrunk4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const layer = r.enemyAt(...m.at('W'));
    const welders = m.all('D').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('k'), 'SWORD');
    r.pickup(b, ...m.at('u'), 'GUNHAT');
    // the secret: c swims out to the island in the spilled drink first
    r.pickup(c, ...m.at('t'), 'TOOB');
    r.move(c, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.pickup(c, ...m.at('g'), 'GAUNTLETZ');
    // past the first slime's round (south side, north side) to the sofa stairz
    const [, s0y] = m.at('S');
    const [, s1y] = m.at('s');
    const [sx, sy] = m.all('▲').find(([, y]) => y === s0y - 2)!;
    for (const [g, k] of [
      [a, 0],
      [b, 1],
      [c, 2],
    ] as const) {
      pastSlime(r, g, sx, s1y, 0, -1);
      pastSlime(r, g, sx, s0y, 0, -1);
      r.move(g, sx, sy);
      r.move(g, sx + 1 + k, sy - 2);
    }
    // the brick layer first, then the brickz on the stairz to the sofa back
    r.gangUp([a, b, c], layer);
    const [px, py] = m.at('P');
    r.breakBrickz(c, px, py);
    // along the sofa back and over the plank, past its outletz
    const cols = [...new Set(m.all('ef').map(p => p[0]))].sort((p, q) => p - q);
    const row = m.all('e')[1]![1];
    for (const g of [a, b, c]) {
      r.move(g, px, py - 2);
      for (const x of cols) {
        r.move(g, x - 1, row);
        r.passHazard(g, x, row, x + 1, row);
      }
      r.move(g, cols[cols.length - 1]! + 3 + [a, b, c].indexOf(g), row + 2);
    }
    // the gun hat shoots the welderz from afar
    const [tx, ty] = m.all('▲').find(([, y]) => y < row)!;
    r.move(b, tx, ty + 6);
    for (const welder of welders) r.attack(b, welder);
    r.move(a, tx, ty + 1);
    r.move(a, tx, ty - 1);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // home to the fort, which is in the middle of the other slime's round
    r.move(a, tx, ty + 1);
    r.move(a, cols[cols.length - 1]! + 1, row);
    for (const x of [...cols].reverse()) {
      r.move(a, x + 1, row);
      r.passHazard(a, x, row, x - 1, row);
    }
    r.move(a, px, py - 2);
    r.move(a, px, py + 1);
    r.move(a, sx, sy);
    r.move(a, sx, sy + 1);
    const [fx] = m.at('F');
    const [, x0y] = m.at('X');
    r.move(a, fx, x0y - 2);
    pastSlime(r, a, fx, x0y, 0, 1);
    r.deliver(a, ...m.at('F'));
  },
};
