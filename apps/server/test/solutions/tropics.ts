import { isGone } from '@gruntz/core';
import { expect } from 'vitest';
import tropics1 from '../../../../content/src/levels/tropics-1.ts';
import tropics2 from '../../../../content/src/levels/tropics-2.ts';
import tropics3 from '../../../../content/src/levels/tropics-3.ts';
import tropics4 from '../../../../content/src/levels/tropics-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { overToggle, throughHazards } from './helpers.ts';
import { marks } from './marks.ts';

export const TROPICS: Record<string, (r: Walkthrough) => void> = {
  'tropics-1': r => {
    const m = marks(tropics1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const hitter = r.enemyAt(...m.at('H'));
    const clubber = r.enemyAt(...m.at('C'));
    const thrower = r.enemyAt(...m.at('K'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('s'), 'SHOVEL');
    // the secret: c on the jungle terrace, b through the red wormhole beside it
    const [sx, sy] = m.at('S');
    r.moveAll([
      [b, sx, sy + 1],
      [c, 14, 22],
    ]);
    r.move(c, ...m.at('T'));
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(b, sx, sy, ...m.at('L'));
    r.move(b, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.warp(b, ...m.at('O'), ...m.at('l'));
    const [lx, ly] = m.at('l');
    r.move(b, lx - 1, ly - 3); // back out of the clubber's sight until the otherz are over
    // a and c over the toggle bridge
    const toggle = m.all('A');
    const [tx, ty] = toggle[0]!;
    r.moveAll([
      [a, tx - 1, ty],
      [c, tx - 2, ty],
    ]);
    overToggle(r, a, toggle, [tx + toggle.length + 1, ty]);
    r.move(c, tx - 1, ty);
    overToggle(r, c, toggle, [tx + toggle.length, ty]);
    r.moveAll([
      [a, 44, 34],
      [b, 46, 34],
      [c, 45, 35],
    ]);
    r.gangUp([a, b, c], clubber);
    r.pickup(b, ...m.at('j'), 'ROCK'); // rockz lie in the east field
    // up the corridor of geyserz, one row at a time
    const rows = [...new Set(m.all('vVYZU').map(p => p[1]))].sort((p, q) => q - p);
    for (const [g, x] of [
      [a, 34],
      [b, 35],
      [c, 36],
    ] as const) {
      r.move(g, x, 34);
      throughHazards(r, g, x, rows, -1);
      r.move(g, x, 13);
    }
    r.moveAll([
      [a, 33, 9],
      [b, 33, 10],
      [c, 34, 10],
    ]);
    // onto the volcano plateau and its top, where the rock thrower waits
    r.moveAll([
      [a, 47, 7],
      [b, 49, 8],
      [c, 50, 7],
    ]);
    r.gangUp([a, b, c], thrower);
    r.pickup(c, ...m.at('w'), 'WARPSTONE');
    // back to the bank: the blue switch raises the north bridge
    r.moveAll([
      [a, 34, 5],
      [c, 34, 8],
    ]);
    r.move(b, ...m.at('b'));
    const bridge = m.all(':');
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'north bridge up');
    const [nx, ny] = bridge[0]!;
    // the hit-and-run grunt waits over the bridge
    const [wx, wy] = m.at('b');
    for (const [g, x] of [
      [b, nx - 1],
      [a, nx],
    ] as const) {
      r.move(g, wx + 1, wy + 1); // round the blue switch, not over it (it would lower the bridge)
      r.move(g, nx + bridge.length, ny);
      r.move(g, x, ny);
    }
    // rockz catch him as he runz off after each blow; a (and the gauntletz) keep out of it
    r.attack(b, hitter);
    r.move(a, ...m.at('*')); // a bottle of zap cola
    r.move(b, 23, ny + 2);
    r.move(c, wx + 1, wy + 1);
    r.move(c, nx + bridge.length, ny);
    r.move(c, nx - 1, ny);
    r.move(c, 24, ny + 2);
    r.tool(a, 8, 14); // the rock in front of the terrace stairz
    r.move(a, 10, 16);
    r.deliver(c, ...m.at('F'));
  },

  'tropics-2': r => {
    const m = marks(tropics2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const d = r.gruntAt(...m.at('7'));
    const clubber = r.enemyAt(...m.at('C'));
    const defender = r.enemyAt(...m.at('D'));
    const thrower = r.enemyAt(...m.at('K'));
    const [px, py] = m.at('P');
    const coconut = (atLeast: number) => [...r.w.all('ball')].some(ball => ball.state === 'break' && ball.y >= atLeast);
    const [t1, t2] = m.all('t').sort((p, q) => p[0] - q[0]);
    r.pickup(b, ...t1!, 'TOOB');
    r.move(d, ...m.at('y')); // megaphone: brick laying toolz
    r.cmd({ type: 'give', slot: 0, id: d });
    // over the coconut lane on the beach
    r.move(c, px - 2, 40);
    r.crossColumn(c, px, 40, px + 3);
    r.pickup(c, ...t2!, 'TOOB');
    // brick the pad at the top of the lower flight right after a coconut smashes below
    r.moveAll([
      [a, px - 1, py + 3],
      [d, px + 1, py + 3],
    ]);
    r.until(() => coconut(38), 'a coconut to smash on the beach');
    r.move(d, px, py + 1);
    r.move(d, px + 1, py);
    r.tool(d, px, py);
    expect(r.tile(px, py)).toBe('BRICKZ');
    // now only the upper flight has coconutz: a runs up for the gauntletz
    r.move(a, px, py + 1);
    r.move(a, px - 1, py);
    r.move(a, px - 1, 15);
    r.until(() => coconut(py - 2), 'a coconut to smash on the brick');
    r.move(a, px, 14);
    r.move(a, px + 1, 11);
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    // zap cola on the hilltop and a rock by the gap, then through it to the plaza, where a
    // club guard keeps watch
    r.move(a, ...m.all('+')[0]!);
    // back down the coconut stairz right behind a coconut (the next one is far behind)
    r.move(a, px + 1, 11);
    r.until(
      () => [...r.w.all('ball')].some(ball => ball.state === 'roll' && ball.x === px && ball.y >= 13 && ball.y <= 15),
      'a coconut just past the top of the stairz',
    );
    r.move(a, px, 14);
    r.move(a, px + 1, 15);
    r.pickup(d, ...m.at('j'), 'ROCK');
    r.gangUp([a, d], thrower); // the boomerang guard reachez the whole hill
    r.move(a, ...m.at('u')); // a bottle by the gap
    r.moveAll([
      [a, 21, 8],
      [d, 25, 10],
    ]);
    r.attack(d, clubber); // rockz: a (and the gauntletz) keep out of the club's way
    // the swimmers hold the purple switchez out at sea
    r.moveAll([
      [b, ...m.at('v')],
      [c, ...m.at('z')],
    ]);
    const [vx, vy] = m.at('V');
    r.until(() => r.tile(vx, vy) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.move(a, ...m.at('*')); // a keg of zap cola first
    r.gangUp([a, d], defender); // the yard's defender comes at the gate
    r.pickup(d, ...m.at('w'), 'WARPSTONE');
    r.moveAll([
      [a, vx - 2, vy + 2],
      [d, vx, vy + 2],
    ]);
    // the secret: c swims out to the sandbar, b swims back into the A room
    r.move(c, ...m.at('Q'));
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret door open');
    r.move(b, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    r.deliver(d, ...m.at('F'));
  },

  'tropics-3': r => {
    const m = marks(tropics3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const clubber = r.enemyAt(...m.at('C'));
    const bomber = r.enemyAt(...m.at('B'));
    const timeBomber = r.enemyAt(...m.at('T'));
    // a alone over the crumbling causeway to the gauntletz
    const causeway = m.all('c');
    const [cx, cy] = causeway[causeway.length - 1]!;
    r.move(a, cx, cy + 1);
    r.move(a, cx, causeway[0]![1] - 1);
    r.until(() => causeway.every(([x, y]) => r.tile(x, y) === 'DEATH'), 'causeway crumbled');
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    // up onto the west flank, through its rock wall and down the gorge to the giant rock
    const [sx, sy] = m.all('▲')[0]!;
    r.move(a, sx, sy - 1);
    const [rx, ry] = m.all('R')[0]!;
    r.tool(a, rx, ry);
    const [gx, gy] = m.at('G');
    r.moveSafe(a, gx + 2, gy); // (a straight line would be through the lava lake)
    r.tool(a, gx + 1, gy);
    expect([...r.w.all('giantrock')]).toHaveLength(0);
    const [j1, j2] = m.all('j');
    r.moveSafe(b, gx + 3, gy + 1); // over the land bridge, not through the lava river
    r.moveSafe(c, gx + 3, gy - 1);
    r.pickup(b, ...j1!, 'ROCK');
    r.pickup(c, ...j2!, 'ROCK');
    r.gangUp([a, b, c], clubber);
    // a rock at the bomber: he goes off in his niche and takes the gold brickz with him
    r.attack(b, bomber);
    const [yx, yy] = m.at('Y');
    r.until(() => r.tile(yx, yy) !== 'BRICKZ', 'gold brickz blown');
    const [qx, qy] = m.at('q');
    r.moveSafe(b, qx + 2, qy); // b waits in the gorge for the secret
    // up to the ring road; c takes the invulnerability and walks the lane of geyserz
    r.moveAll([
      [a, yx - 1, yy - 3],
      [c, yx + 1, yy - 3],
    ]);
    r.move(c, ...m.at('i'));
    expect(r.grunt(c).powerup).toBe('INVULNERABILITY');
    const [lx, ly] = m.all('◀')[1]!;
    r.move(c, lx + 1, ly);
    r.pickup(c, ...m.at('s'), 'SWORD');
    r.attack(c, timeBomber);
    // a times the geyserz
    const rows = [...new Set(m.all('vVZ').map(p => p[1]))].sort((p, q) => q - p);
    r.move(a, lx + 1, rows[0]! + 1);
    throughHazards(r, a, lx + 1, rows, -1);
    r.move(a, lx - 1, ly);
    const [kx, ky] = m.all('R')[2]!;
    r.tool(a, kx, ky); // the rock at the foot of the summit stairz
    r.move(a, ...m.at('Q'));
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the secret: the pyramid is down, b walks the second causeway and warpz back
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret pyramid down');
    r.move(b, qx, qy);
    r.move(b, qx - 3, qy); // straight over the crumbling tilez
    r.move(b, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.warp(b, ...m.at('O'), ...m.at('l'));
    r.deliver(a, ...m.at('F'));
  },

  'tropics-4': r => {
    const m = marks(tropics4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const hitter = r.enemyAt(...m.at('H'));
    const clubber = r.enemyAt(...m.at('C'));
    const [s1, s2] = m.all('D').map(p => r.enemyAt(...p)) as [number, number];
    const lords = m.all('E').map(p => r.enemyAt(...p));
    const alive = (id: number) => !!r.w.get(id, 'grunt') && !isGone(r.grunt(id));
    /** Touch an enemy with conversion (friendz may be hitting him at the same time). */
    const convert = (g: number, target: number) => {
      r.cmd({ type: 'attack', ids: [g], target });
      r.until(() => !alive(target) || r.grunt(target).team === 0, `#${target} converted`);
    };
    // the gauntletz up on the east plateau
    const [ex, ey] = m.at('▶');
    r.moveAll([
      [a, ex - 1, ey],
      [b, ex - 1, ey + 1],
      [c, ex - 1, ey - 1],
    ]);
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.gangUp([a, b, c], hitter);
    r.move(a, ...m.all('+')[1]!); // zap cola on the plateau
    // the secret: b as a ghost, right past the tiki guardz
    r.move(b, ...m.at('i'));
    expect(r.grunt(b).powerup).toBe('GHOST');
    r.move(b, ...m.at('L'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.move(b, 20, 41);
    // a and c over the bridge that risez and sinkz on its own
    const bridge = m.all('A');
    const [bx, by] = bridge[0]!;
    const [fx, fy] = bridge[bridge.length - 1]!;
    r.move(a, fx, fy + 1);
    overToggle(r, a, bridge, [bx - 1, by - 3]);
    r.move(c, fx, fy + 1);
    overToggle(r, c, bridge, [bx - 2, by - 3]);
    // a opens the rock alcove, c takes the conversion and turns both sentriez
    r.tool(a, ...m.at('Y'));
    const [kx, ky] = m.at('k');
    r.move(a, kx + 1, ky + 1); // out of the doorway
    r.move(c, ...m.at('n'));
    expect(r.grunt(c).powerup).toBe('CONVERSION');
    convert(c, s1);
    r.cmd({ type: 'attack', ids: [s1], target: s2 }); // the new friend swingz at his old mate
    convert(c, s2);
    const friends = () => [a, s1, s2].filter(alive);
    r.move(c, ...m.all('*')[1]!); // conversion eats health (half a minute of it): a bottle
    r.move(c, kx, ky); // and the keg
    r.move(a, ...m.all('+')[0]!);
    // up to the court with the new friendz
    const [cx, cy] = m.all('▲')[1]!; // terrace -> court
    r.moveAll([
      [a, cx, cy - 2],
      ...friends()
        .slice(1)
        .map((f, k) => [f, cx - 1 + 2 * k, cy - 3] as [number, number, number]),
    ]);
    r.gangUp(friends(), clubber);
    // zap cola before the throne: the keg for a, the bottle for a friend
    r.move(a, ...m.at('z'));
    const [helper] = friends().slice(1);
    if (helper !== undefined) r.move(helper, ...m.all('*')[0]!);
    // the red switch: throne stairz open, coconutz smash at the top, the way home shuts
    const [px, py] = m.at('p');
    r.move(a, ...m.at('X'));
    r.until(() => r.tile(px, py) === 'PYRAMID_RED_LO', 'throne stairz open');
    expect(r.tile(bx, by - 2)).toBe('PYRAMID_RED');
    r.moveAll([
      [a, px - 1, py - 3],
      ...friends()
        .slice(1)
        .map((f, k) => [f, px + 1 - k, py - 3 - k] as [number, number, number]),
    ]);
    for (const lord of lords) r.gangUp(friends(), lord);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // back down to the switch, flip the pyramidz back and home over the bridge
    r.move(a, px + 2, py + 2);
    r.move(a, ...m.at('X'));
    r.until(() => r.tile(bx, by - 2) === 'PYRAMID_RED_LO', 'the way home open');
    r.move(a, bx, by - 3);
    overToggle(r, a, bridge, [fx, fy + 1]);
    r.deliver(a, ...m.at('F'));
  },
};
