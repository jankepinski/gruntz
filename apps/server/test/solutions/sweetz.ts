import { expect } from 'vitest';
import sweetz1 from '../../../../content/src/levels/sweetz-1.ts';
import sweetz2 from '../../../../content/src/levels/sweetz-2.ts';
import sweetz3 from '../../../../content/src/levels/sweetz-3.ts';
import sweetz4 from '../../../../content/src/levels/sweetz-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { rideArrows, throughHazards } from './helpers.ts';
import { marks } from './marks.ts';

export const SWEETZ: Record<string, (r: Walkthrough) => void> = {
  'sweetz-1': r => {
    const m = marks(sweetz1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const toyer = r.enemyAt(...m.at('T'));
    const guards = m.all('tD').map(p => r.enemyAt(...p));
    r.pickup(c, ...m.at('v'), 'WINGZ');
    // the secret: a short hop over the chasm to the islet and back
    const [wx, wy] = m.at('W');
    r.move(c, wx - 3, wy);
    r.move(c, wx, wy);
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.move(c, wx - 3, wy + 1);
    // clubz on the west plateau, and the toyer who guardz them
    const [k1, k2] = m.all('k');
    r.pickup(a, ...k1!, 'CLUB');
    r.pickup(b, ...k2!, 'CLUB');
    r.gangUp([a, b], toyer);
    // c flies over the chasm to the knoll: the blue switch raises the bridge
    const bridge = m.all(':');
    const [bx, by] = bridge[0]!;
    r.move(c, bx - 1, by);
    r.move(c, bx + bridge.length, by);
    r.move(c, ...m.at('b'));
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'bridge up');
    for (const [g, dy] of [
      [a, -1],
      [b, 1],
    ] as const) {
      r.move(g, bx - 1, by); // straight along the bridge (a diagonal would be down the chasm)
      r.move(g, bx + bridge.length, by);
      r.move(g, bx + bridge.length, by + dy);
    }
    // a through the candle corridor to the yellow switch, and back
    const [yx, yy] = m.at('y');
    const rows = [...new Set(m.all('efj').map(p => p[1]))].sort((p, q) => q - p);
    r.move(a, yx, rows[0]! + 2);
    throughHazards(r, a, yx, rows, -1);
    r.move(a, yx, yy);
    const [cx, cy] = m.at('⇓');
    r.until(() => r.tile(cx, cy) === 'ARROW2_N', 'carousel corner turned');
    throughHazards(r, a, yx, [...rows].reverse(), 1);
    // one by one onto the carousel: it now dropz them at the stairz up
    const [ex, ey] = m.all('▲')[2]!; // the stairz from the lowland onto the carousel ledge
    for (const g of [a, b, c]) {
      r.move(g, ex + 1, ey - 1);
      rideArrows(r, g, [ex + 1, ey - 2], [cx, cy - 1]);
      r.move(g, cx + [a, b, c].indexOf(g) - 1, cy - 3);
    }
    for (const guard of guards) r.gangUp([a, b, c], guard);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    r.deliver(a, ...m.at('F'));
  },

  'sweetz-2': r => {
    const m = marks(sweetz2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const hitter = r.enemyAt(...m.at('H'));
    const camp = m.all('KT').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('s'), 'SPRING');
    r.pickup(b, ...m.at('t'), 'TOOB');
    r.pickup(c, ...m.at('n'), 'WAND');
    // the time switch: a hops straight over the holez and through the gate in time
    r.move(a, ...m.at('x'));
    const [bx, by] = m.at('b');
    r.move(a, bx, by);
    const [gx, gy] = m.at('G');
    r.until(() => r.tile(gx, gy) === 'PYRAMID_GREEN_LO', 'green door open');
    // b and c walk the long way round the holez (safe paths: no hopping into them)
    r.moveSafe(b, gx, gy + 2);
    r.moveSafe(c, gx - 1, gy + 3);
    // down into the gorge; b swims over to the drawbridge switch
    const [rx, ry] = m.all('◀')[1]!;
    r.moveAll([
      [a, rx + 2, ry - 1],
      [c, rx + 2, ry + 1],
    ]);
    r.move(b, rx + 1, ry);
    r.move(b, ...m.at('y'));
    const bridge = m.all('-');
    const [dx, dy] = bridge[0]!;
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'BRIDGE'), 'drawbridge up');
    for (const [g, side] of [
      [a, -1],
      [c, 1],
    ] as const) {
      r.move(g, dx - 1, dy); // straight along the bridge, not into the soda
      r.move(g, dx + bridge.length, dy);
      r.move(g, dx + bridge.length + 1, dy + side);
    }
    r.pickup(a, ...m.at('k'), 'SWORD'); // the springz have done their job
    r.gangUp([a, b, c], hitter);
    r.move(a, ...m.at('u')); // a keg of zap cola after that
    // the secret: b swims down the river into the grotto
    r.move(b, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    r.move(b, dx + bridge.length, dy + 1);
    // up to the east terrace, through the candlez, up to the camp
    const [ex, ey] = m.all('▶')[0]!;
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => p - q);
    for (const [g, x] of [
      [a, ex + 1],
      [b, ex + 2],
      [c, ex + 3],
    ] as const) {
      r.move(g, ex - 1, ey);
      r.move(g, x, ey + 1);
      throughHazards(r, g, x, rows, 1);
    }
    const [ux, uy] = m.all('▶')[1]!;
    r.moveAll([
      [a, ux + 3, uy - 2],
      [b, ux + 3, uy + 2],
      [c, ux + 2, uy],
    ]);
    r.move(c, ...m.at('*')); // the caster wants full health: the guardz will swing at him
    // c walks into the camp and freezes everybody; the ice shatterz at the first blow
    // c walks up to the camp (post guardz only hit what is right next to them): all of them
    // are within the spell from here, none close enough to swing
    const [wx, wy] = m.at('w');
    r.moveAll([
      [c, wx, wy + 5],
      [a, wx - 5, wy + 5],
      [b, wx + 5, wy + 5],
    ]); // post guardz don't come out: the smashers wait close by (the spell freezes friendz too)
    const inSpell = (e: number) =>
      !r.w.get(e, 'grunt') || Math.max(Math.abs(r.grunt(e).x - wx), Math.abs(r.grunt(e).y - wy - 5)) <= 4;
    r.until(() => camp.every(inSpell), 'the whole camp within the spell');
    r.cmd({ type: 'useTool', ids: [c], x: wx, y: wy + 5 }); // the spell goes off where he stands
    r.until(() => camp.every(g => !r.w.get(g, 'grunt') || r.grunt(g).frozen), 'the camp frozen');
    // a and b smash the ice before it thaws (c keeps out: his wand would only freeze again)
    const [g1, g2, g3] = m.all('K').map(p => r.enemyAt(...p));
    const gone = (e: number) => !r.w.get(e, 'grunt') || r.grunt(e).action.kind === 'death';
    r.cmd({ type: 'attack', ids: [a], target: g1! });
    r.cmd({ type: 'attack', ids: [b], target: g2! });
    r.until(() => gone(g1!), 'the first guard shattered');
    r.cmd({ type: 'attack', ids: [a], target: g3! });
    r.until(() => [g1!, g2!, g3!].every(gone), 'the guardz shattered');
    for (const g of camp)
      r.gangUp(
        [a, b].filter(q => r.w.get(q, 'grunt')),
        g,
      );
    r.pickup(a, wx, wy, 'WARPSTONE');
    r.deliver(a, ...m.at('F'));
  },

  'sweetz-3': r => {
    const m = marks(sweetz3);
    const a = r.gruntAt(...m.at('1'));
    const layer = r.enemyAt(...m.at('W'));
    const guards = m.all('K').map(p => r.enemyAt(...p));
    const swordsman = r.enemyAt(...m.at('S'));
    // the goo puddlez come back to life; the second scroll healz them
    r.pickup(a, ...m.at('s'), 'SCROLL');
    const [sx, sy] = m.at('1');
    r.move(a, sx, sy);
    r.castScroll(a);
    const [b, c, d, e] = [...r.w.all('grunt')]
      .filter(g => g.team === 0 && g.id !== a)
      .map(g => g.id)
      .sort((p, q) => p - q) as [number, number, number, number];
    r.pickup(a, ...m.at('v'), 'SCROLL');
    r.move(a, sx, sy);
    r.castScroll(a);
    expect(r.grunt(b).health).toBe(20);
    const [k1, k2] = m.all('k');
    r.pickup(b, ...k1!, 'CLUB');
    r.pickup(c, ...k2!, 'CLUB');
    // e holdz the drawbridge up while the otherz cross
    const bridge = m.all(':');
    const [bx] = bridge[0]!;
    const by = Math.max(...bridge.map(p => p[1]));
    r.move(e, ...m.at('H'));
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'drawbridge up');
    for (const [g, dx] of [
      [a, -2],
      [b, -1],
      [c, 1],
      [d, 2],
    ] as const) {
      r.move(g, bx, by + 1); // straight over it
      r.move(g, bx, by - 5);
      r.move(g, bx + dx, by - 7);
    }
    // the switch by the east gate lowers the east drawbridge for e
    r.move(a, ...m.at('o'));
    const east = m.all('E');
    r.until(() => east.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'east drawbridge up');
    const [ex, ey] = east[east.length - 1]!;
    r.moveSafe(e, ex + 2, ey);
    r.move(e, ex + 1, ey);
    r.move(e, ex - 5, ey + 1);
    // stop the brick layer, then the club guardz, then knock the brickz out of the keep door
    r.gangUp([b, c, d, e], layer);
    for (const guard of guards) r.gangUp([b, c, d, e], guard);
    // a second healing scroll in the courtyard: everyone gatherz round it
    const [hx, hy] = m.at('x');
    const team = [a, b, c, d, e].filter(g => r.w.get(g, 'grunt'));
    // (someone may have picked it up in the fight already)
    if (!team.some(g => r.grunt(g).toy === 'SCROLL')) r.pickup(a, hx, hy, 'SCROLL');
    const reader = team.find(g => r.grunt(g).toy === 'SCROLL')!;
    const { x: rx, y: ry } = r.grunt(reader);
    r.moveAll(
      team
        .filter(g => g !== reader)
        .map((g, k) => [g, rx - 2 + k + (k >= 2 ? 1 : 0), ry - 1] as [number, number, number]),
    );
    r.castScroll(reader);
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.breakBrickz(a, ...m.at('Y'));
    // along the corridor of candlez, one column at a time
    const cols = [...new Set(m.all('ef').map(p => p[0]))].sort((p, q) => p - q);
    const [tx, ty] = m.at('J'); // the tower stairz
    // the clubz first: the sword grunt comes down from the tower for them
    for (const g of [b, c]) {
      r.move(g, cols[0]! - 1, 18);
      for (const x of cols) r.passHazard(g, x, 18, x + 1, 18);
      r.move(g, tx + 2 - [b, c].indexOf(g), ty + 2);
    }
    r.gangUp([b, c], swordsman);
    r.move(a, cols[0]! - 1, 18);
    for (const x of cols) r.passHazard(a, x, 18, x + 1, 18);
    r.move(a, tx, ty - 1);
    r.move(a, ...m.at('Q'));
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the secret: whoever is still in the courtyard runs up onto the ramparts to the nook
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret nook open');
    const runner = [d, e].find(g => r.w.get(g, 'grunt'))!;
    r.move(runner, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    // back down through the candlez with the warpstone
    r.move(a, tx, ty + 1);
    r.move(a, cols[cols.length - 1]! + 1, 18);
    for (const x of [...cols].reverse()) r.passHazard(a, x, 18, x - 1, 18);
    r.deliver(a, ...m.at('F'));
  },

  'sweetz-4': r => {
    const m = marks(sweetz4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const layer = r.enemyAt(...m.at('W'));
    const swordsman = r.enemyAt(...m.at('S'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('s'), 'SPY');
    r.pickup(c, ...m.at('k'), 'CLUB');
    r.move(b, ...m.at('z')); // megaphone: a timebomb for later
    // spy gear on the gate: the middle brickz are the plain brown ones
    const [yx, yy] = m.at('Y');
    r.tool(b, yx, yy, () => !!r.w.objectAt(yx, yy, 'brickz')?.revealed.includes(0));
    r.breakBrickz(a, yx, yy);
    // into the hall and over the gumball lane, one gap at a time
    const [, laneY] = m.at('O');
    const crossLane = (g: number, x: number) => {
      r.move(g, x, laneY + 1);
      r.until(
        () => [...r.w.all('ball')].every(ball => ball.state !== 'roll' || ball.x < x - 1 || ball.x > x + 6),
        'a gap in the gumballz',
      );
      r.move(g, x, laneY - 2);
    };
    for (const [g, x] of [
      [b, 31],
      [a, 29],
      [c, 33],
    ] as const) {
      r.move(g, yx + 1, yy);
      crossLane(g, x);
    }
    // the yellow switch turnz the belt's middle arrow towardz the stairz
    r.move(b, ...m.at('y'));
    const [ax, ay] = m.at('⇓');
    r.until(() => r.tile(ax, ay) === 'ARROW2_N', 'belt arrow turned');
    for (const g of [a, b, c]) {
      r.move(g, ax, ay + 1);
      rideArrows(r, g, [ax, ay], [ax, ay - 1]);
      r.move(g, ax - 1 + [a, b, c].indexOf(g), ay - 3);
    }
    // two hold the purple switchez, a slips through the gate and opens the side door
    const [v1, v2] = m.all('vu');
    r.moveAll([
      [b, ...v1!],
      [c, ...v2!],
    ]);
    const [vx, vy] = m.at('V');
    r.until(() => r.tile(vx, vy) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.move(a, vx + 1, vy);
    r.move(a, ...m.at('n'));
    const doors = m.all('G');
    r.until(() => doors.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'side door and shortcut open');
    const [dx, dy] = doors[1]!; // the side door (the other one is the shortcut home)
    r.moveAll([
      [b, dx + 2, dy - 1],
      [c, dx + 2, dy + 1],
    ]);
    // floor 2: through the candlez; the brick layer and the sword grunt behind them
    const [sx, sy] = m.all('▲').find(([, y]) => y === 12)!;
    const rows = [...new Set(m.all('ef').map(p => p[1]))].sort((p, q) => q - p);
    for (const [g, x] of [
      [c, sx - 1],
      [a, sx],
      [b, sx + 1],
    ] as const) {
      r.move(g, sx, sy + 1);
      r.move(g, x, sy - 2);
      throughHazards(r, g, x, rows, -1);
      r.move(g, x, rows[rows.length - 1]! - 2);
    }
    r.gangUp([c, a, b], layer);
    r.gangUp([c, a, b], swordsman);
    // the timebomb for the gold brickz on the stairz to the roof
    r.cmd({ type: 'give', slot: 0, id: a });
    expect(r.grunt(a).tool).toBe('TIMEBOMB');
    const [jx, jy] = m.at('J');
    r.moveAll([
      [a, jx, jy + 2],
      [b, jx - 6, jy + 1],
      [c, jx - 6, jy + 2],
    ]);
    r.until(() => r.w.tick >= r.grunt(a).staminaEnd, 'a to get its breath back');
    r.cmd({ type: 'useTool', ids: [a], x: jx, y: jy + 1 });
    r.until(() => !!r.w.objectAt(jx, jy + 1, 'timebomb'), 'the timebomb set');
    r.move(a, jx - 4, jy + 2);
    r.until(() => r.tile(jx, jy) !== 'BRICKZ', 'the gold brickz blown');
    r.move(a, ...m.at('Q'));
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the secret: c runs down to the room on floor 1
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret room open');
    r.move(c, jx, rows[rows.length - 1]! - 1);
    throughHazards(r, c, jx, [...rows].reverse(), 1);
    r.move(c, sx, sy);
    r.move(c, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    // home with the warpstone: back through the candlez and down the shortcut
    r.move(a, jx, rows[rows.length - 1]! - 1);
    throughHazards(r, a, jx, [...rows].reverse(), 1);
    r.move(a, sx, sy);
    r.deliver(a, ...m.at('F'));
  },
};
