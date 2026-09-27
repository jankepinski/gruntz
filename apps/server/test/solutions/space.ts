import { expect } from 'vitest';
import space1 from '../../../../content/src/levels/space-1.ts';
import space2 from '../../../../content/src/levels/space-2.ts';
import space3 from '../../../../content/src/levels/space-3.ts';
import space4 from '../../../../content/src/levels/space-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { overToggle, throughHazards } from './helpers.ts';
import { marks } from './marks.ts';

export const SPACE: Record<string, (r: Walkthrough) => void> = {
  'space-1': r => {
    const m = marks(space1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const alien = r.enemyAt(...m.at('C'));
    r.pickup(a, ...m.at('s'), 'SPRING');
    r.pickup(b, ...m.at('k'), 'CLUB');
    // the secret: wingz out to the floating rock and back
    r.pickup(c, ...m.at('n'), 'WINGZ');
    const [wx, wy] = m.at('W');
    const shore = Math.max(...m.all('_').map(p => p[1])) + 1;
    r.move(c, wx, shore);
    r.move(c, wx, wy);
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.move(c, wx, shore);
    r.pickup(c, ...m.at('K'), 'CLUB');
    // a hops the craterz to the switch that opens the valley
    const [bx, by] = m.at('b');
    r.moveSafe(a, bx, shore); // (springz hop into the void when that lookz shorter: safe paths)
    r.moveSafe(a, bx, by);
    const door = m.all('G');
    r.until(() => door.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'the valley open');
    // b and c through the valley between two sweeps of the UFO
    const [vx] = door[3]!;
    const [, uy] = m.at('U');
    const top = door[0]![1];
    for (const g of [b, c]) {
      r.move(g, vx, shore);
      r.move(g, vx, uy + 3);
      r.waitUfo(vx, uy, 8);
      r.move(g, vx, top - 1);
      r.move(g, vx - 2 - [b, c].indexOf(g), top - 2);
    }
    // everyone at the airlock: the time switch, and all three in before it shuts
    const [xx, xy] = m.at('X');
    r.moveAll([
      [a, xx - 1, xy + 1],
      [b, xx + 1, xy + 1],
      [c, xx, xy + 2],
    ]);
    r.move(c, ...m.at('x'));
    r.until(() => r.tile(xx, xy) === 'PYRAMID_TIME_LO', 'the airlock open');
    r.moveAll([
      [a, xx - 1, xy - 3],
      [b, xx + 1, xy - 3],
      [c, xx, xy - 3],
    ]);
    // the plasma ventz, the alien, the roof
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => q - p);
    for (const [g, dx] of [
      [b, 1],
      [c, -1],
      [a, 0],
    ] as const) {
      r.move(g, xx + dx, rows[0]! + 1);
      throughHazards(r, g, xx + dx, rows, -1);
      r.move(g, xx + dx, rows[rows.length - 1]! - 1);
    }
    r.gangUp([b, c, a], alien);
    const [rx, ry] = m.all('▲').find(([, y]) => y < xy - 2)!;
    r.move(a, rx, ry + 1);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // out again: the ventz, the switch inside the airlock, the valley, the fort
    r.move(a, rx, ry + 1);
    r.move(a, xx, rows[rows.length - 1]! - 1);
    throughHazards(r, a, xx, [...rows].reverse(), 1);
    r.move(a, ...m.at('y'));
    r.until(() => r.tile(xx, xy) === 'PYRAMID_TIME_LO', 'the airlock open');
    r.move(a, xx, xy + 1);
    r.move(a, vx, top - 1);
    r.move(a, vx, uy - 3);
    r.waitUfo(vx, uy, 8);
    r.move(a, vx, shore);
    r.deliver(a, ...m.at('F'));
  },

  'space-2': r => {
    const m = marks(space2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const welder = r.enemyAt(...m.at('D'));
    const boss = r.enemyAt(...m.at('C'));
    r.pickup(a, ...m.at('c'), 'CLUB');
    r.pickup(b, ...m.at('u'), 'GUNHAT');
    r.pickup(c, ...m.at('k'), 'SWORD');
    // sector A: a through the rowz of plasma ventz to the first switch
    r.warp(a, ...m.at('P'), ...m.at('p'));
    const [gx, gy] = m.at('g');
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => q - p);
    r.move(a, gx, rows[0]! + 1);
    throughHazards(r, a, gx, rows, -1);
    r.move(a, gx, gy);
    r.warp(a, ...m.at('Y'), ...m.at('j'));
    // sector B: b's gun hat shootz the welder from afar, then the second switch
    r.warp(b, ...m.at('Q'), ...m.at('q'));
    const [dx, dy] = m.at('D');
    r.move(b, dx - 5, dy);
    r.attack(b, welder);
    r.move(b, ...m.at('d'));
    r.warp(b, ...m.at('Z'), ...m.at('l'));
    // sector C: c crosses the UFO's yard to the third switch (and the secret trigger)
    r.warp(c, ...m.at('V'), ...m.at('v'));
    const [ix, iy] = m.at('i');
    const [ux, uy] = m.at('U');
    const cx = ux + 2; // cross near the west end: when the UFO is over at the east end
    r.move(c, cx, uy + 5);
    r.waitUfo(cx, uy, 7);
    r.move(c, cx, uy - 5);
    r.move(c, ix, iy);
    r.move(c, ...m.at('T'));
    const [sx, sy] = m.at('S');
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'the red teleporter open');
    r.warp(c, ...m.at('J'), ...m.at('n'));
    r.warp(c, sx, sy, ...m.at('x'));
    r.move(c, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    r.warp(c, ...m.at('X'), ...m.at('n'));
    // the three doorz are down: into the command centre, the sword boss, the platform
    const doors = m.all('GHI');
    r.until(() => doors.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'the doorz open');
    const [ex, ey] = m.all('▲').find(([, y]) => y > 25)!;
    for (const [g, k] of [
      [c, 0],
      [a, -1],
      [b, 1],
    ] as const) {
      r.move(g, ex, ey + 4);
      r.move(g, ex, ey - 1);
      r.move(g, ex + k, ey - 2);
    }
    r.gangUp([c, a, b], boss);
    const [px, py] = m.all('▲').find(([, y]) => y < 25)!;
    r.move(c, px, py + 1);
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    r.move(c, px, py + 1);
    r.move(c, ex, ey - 1);
    r.move(c, ex, ey + 4);
    r.deliver(c, ...m.at('F'));
  },

  'space-3': r => {
    const m = marks(space3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const alien = r.enemyAt(...m.at('C'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('k'), 'CLUB');
    r.pickup(c, ...m.at('n'), 'WINGZ');
    // over the bridge that risez and sinkz on its own
    const bridge = m.all('A');
    const [x0, y0] = bridge[0]!;
    const x1 = bridge[bridge.length - 1]![0];
    for (const [g, dy] of [
      [a, -2],
      [b, 0],
      [c, 2],
    ] as const) {
      r.move(g, x0 - 1, y0);
      overToggle(r, g, bridge, [x1 + 1, y0]);
      r.move(g, x1 + 3, y0 + dy);
    }
    // a takes the crumbling path; the switch at its end raises the bridge for b and c
    const path = m.all('c');
    const [cx0, cy] = path[0]!;
    const cx1 = path[path.length - 1]![0];
    r.move(a, cx0 - 1, cy);
    r.move(a, cx1 + 1, cy);
    r.move(a, ...m.at('b'));
    const lower = m.all(':');
    const [lx0, ly] = lower[0]!;
    const lx1 = lower[lower.length - 1]![0];
    r.until(() => lower.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'the lower bridge up');
    for (const g of [b, c]) {
      r.move(g, lx0 - 1, ly);
      r.move(g, lx1 + 1, ly);
      r.move(g, lx1 + 2 + [b, c].indexOf(g), ly - 3);
    }
    // the teleporter up to the big asteroid, one at a time
    const [tx, ty] = m.at('t');
    for (const g of [a, b, c]) {
      r.warp(g, ...m.at('T'), tx, ty);
      r.move(g, tx + 2 + [a, b, c].indexOf(g), ty + 1);
    }
    r.gangUp([b, a, c], alien);
    // the secret: c flies out to the speck and back
    const [sx, sy] = m.at('L');
    const east = Math.max(
      ...m
        .all('.')
        .filter(([, y]) => y === sy && r.w.level(20, y) === 0)
        .map(p => p[0])
        .filter(x => x < 46),
    );
    r.move(c, east, sy);
    r.move(c, sx, sy);
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.move(c, east, sy);
    // a punches the giant rock off the stairz
    const [gx, gy] = m.at('G');
    r.move(a, gx, gy + 2);
    r.tool(a, gx, gy + 1);
    const [rx, ry] = m.at('▲');
    for (const g of [a, b, c]) {
      r.move(g, rx, ry + 1);
      r.move(g, rx + [-1, 1, -2][[a, b, c].indexOf(g)]!, ry - 1); // (three rowz from the UFO's lane)
    }
    // over the UFO's lane to the warpstone, and home through the green wormhole
    const [wx, wy] = m.at('w');
    const [, uy] = m.at('U');
    r.move(a, wx, uy + 3); // (three rowz from the lane: out of the beamz' reach)
    r.waitUfo(wx, uy, 8);
    r.move(a, wx, wy);
    r.waitUfo(wx, uy, 8);
    r.move(a, wx, uy + 3);
    r.move(a, rx, ry - 1);
    r.move(a, rx, ry + 1);
    r.warp(a, ...m.at('V'), ...m.at('v'));
    r.deliver(a, ...m.at('F'));
  },

  'space-4': r => {
    const m = marks(space4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const welder = r.enemyAt(...m.at('D'));
    const boss = r.enemyAt(...m.at('B'));
    r.pickup(a, ...m.at('k'), 'SWORD');
    r.pickup(b, ...m.at('u'), 'GUNHAT');
    r.pickup(c, ...m.at('q'), 'GOOBER');
    // west wing: goo for a fourth grunt, then two on the purple switchez while a slips through
    for (const p of m.all('p')) r.suck(c, ...p);
    const d = r.bake(...m.at('P'));
    r.moveAll([
      [c, ...m.at('v')],
      [d, ...m.at('y')],
    ]);
    const [vx, vy] = m.at('V');
    r.until(() => r.tile(vx, vy) === 'PYRAMID_MANY_LO', 'the purple gate down');
    r.move(a, vx, vy + 1);
    r.move(a, ...m.at('e'));
    r.move(a, vx, vy + 2);
    r.pickup(c, ...m.at('c'), 'CLUB');
    // east wing: the time switch turnz the lane of arrowz uphill; ride up to the switch
    const lane = m.all('⇓');
    const [lx] = lane[0]!;
    const top = Math.min(...lane.map(p => p[1]));
    const bottom = Math.max(...lane.map(p => p[1]));
    r.move(a, ...m.at('x'));
    r.until(() => lane.every(([x, y]) => r.tile(x, y) === 'ARROW2_N'), 'the arrowz uphill');
    r.move(a, lx, bottom + 1);
    r.cmd({ type: 'move', ids: [a], x: lx, y: bottom });
    r.until(() => r.grunt(a).y < top && r.settled(a), 'a carried up the lane');
    r.move(a, ...m.at('f'));
    // the secret: the trigger up here opens the red teleporter in the bay, where d waits
    const [sx, sy] = m.at('S');
    r.move(d, sx - 1, sy);
    r.move(a, ...m.at('T'));
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'the red teleporter open');
    r.warp(d, sx, sy, ...m.at('r'));
    r.move(d, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.warp(d, ...m.at('X'), ...m.at('n'));
    // a rides back down once the arrowz turn again
    r.move(a, lx, top - 1);
    r.until(() => lane.every(([x, y]) => r.tile(x, y) === 'ARROW2_S'), 'the arrowz downhill');
    r.cmd({ type: 'move', ids: [a], x: lx, y: top });
    r.until(() => r.grunt(a).y > bottom && r.settled(a), 'a carried down the lane');
    // south: b through the rowz of plasma ventz, shootz the welder, pressez the switch
    const rows = [...new Set(m.all('ZY').map(p => p[1]))].sort((p, q) => q - p);
    const [jx, jy] = m.at('j');
    const vent = jx + 2;
    r.move(b, vent, rows[0]! + 1);
    throughHazards(r, b, vent, rows, -1);
    r.attack(b, welder);
    r.move(b, jx, jy);
    // north: c past the UFO to the last switch
    const [ix, iy] = m.at('i');
    const [, uy] = m.at('U');
    r.move(c, vent, rows[0]! + 1);
    throughHazards(r, c, vent, rows, -1);
    r.move(c, ix, uy + 4);
    r.waitUfo(ix, uy, 8);
    r.move(c, ix, iy);
    r.waitUfo(ix, uy, 8);
    r.move(c, ix, uy + 4);
    // the shield is down: up the core, past the time bomber, to the warpstone
    const shield = m.all('GHIJ');
    r.until(() => shield.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'the shield down');
    const [sx0] = shield[0]!;
    const low = Math.max(...shield.map(p => p[1]));
    const steps = m.all('▲').sort((p, q) => q[1] - p[1]);
    // (don't gather where he can bomb the lot: straight at him, stepping away from his bombz)
    // (in through the south-west door and along the corner's bottom row, under its ventz:
    // one tile high, so the one going furthest goes first)
    for (const [g, x] of [
      [b, sx0 + 1],
      [a, sx0],
      [c, sx0 - 2],
    ] as const) {
      if (r.grunt(g).y < rows[rows.length - 1]!) {
        // coming from the north: back through the ventz, one row at a time
        r.move(g, vent, rows[rows.length - 1]! - 1);
        throughHazards(r, g, vent, [...rows].reverse(), 1);
      } else {
        r.move(g, vent, low + 3);
      }
      r.move(g, vent, low + 1);
      r.move(g, x, low + 1);
    }
    r.gangUp([a, c, b], boss);
    r.move(a, sx0, steps[2]![1] - 1);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // home: down the core and out through the shield to the fort in the bay
    r.moveAll([
      [b, sx0 + 3, steps[0]![1] - 2],
      [c, sx0 - 3, steps[0]![1] - 2],
    ]);
    r.move(a, sx0, steps[1]![1] + 1);
    r.move(a, sx0, steps[0]![1] + 1);
    r.move(a, sx0, low + 1);
    r.deliver(a, ...m.at('F'));
  },
};
