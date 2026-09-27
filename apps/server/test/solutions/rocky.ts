import { isGone } from '@gruntz/core';
import { expect } from 'vitest';
import rocky1 from '../../../../content/src/levels/rocky-1.ts';
import rocky2 from '../../../../content/src/levels/rocky-2.ts';
import rocky3 from '../../../../content/src/levels/rocky-3.ts';
import rocky4 from '../../../../content/src/levels/rocky-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { marks } from './marks.ts';

export const ROCKY: Record<string, (r: Walkthrough) => void> = {
  'rocky-1': r => {
    const m = marks(rocky1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    // chasers: the first on mesa A, the second up north
    const enemies = m
      .all('E')
      .sort((p, q) => q[1] - p[1])
      .map(p => r.enemyAt(...p));
    const club = r.enemyAt(...m.at('C'));
    const rocks = r.enemyAt(...m.at('K'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    // the secret: a trigger in the corner opens the red wormhole to the W for a while
    r.move(b, ...m.at('T'));
    const [sx, sy] = m.at('S');
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(b, sx, sy, ...m.at('L'));
    r.move(b, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.warp(b, ...m.at('Z'), ...m.at('l'));
    r.tool(a, 13, 33); // out of the start
    r.attack(a, enemies[0]!); // the chaser on the mesa
    r.move(a, ...m.at('a')); // green switch up on the mesa
    r.pickup(b, ...m.at('s'), 'SHOVEL');
    const gate = m.all('G');
    r.until(() => gate.every(([x, y]) => r.tile(x, y) === 'PYRAMID_GREEN_LO'), 'green gate down');
    r.moveAll([
      [a, 28, 22],
      [b, 30, 22],
    ]);
    r.crossBoulders(a, 28, 20, 18);
    r.crossBoulders(b, 30, 20, 18);
    const [hx, hy] = m.all('o')[1]!;
    r.tool(b, hx, hy); // fill one hole of the trench
    // gruntz walk straight into holez: one by one over the filled one
    for (const [g, dx] of [
      [b, 1],
      [a, -1],
    ] as const) {
      r.move(g, hx, hy + 1);
      r.move(g, hx, hy - 1);
      r.move(g, hx + dx, hy - 3);
    }
    r.moveAll([
      [a, 29, 10],
      [b, 30, 11],
    ]);
    r.gangUp([a, b], enemies[1]!);
    r.move(b, ...m.at('y')); // megaphone: a club comes out of the grunt machine
    r.cmd({ type: 'give', slot: 0, id: b });
    expect(r.grunt(b).tool).toBe('CLUB');
    r.move(a, ...m.at('b')); // blue switch on the ledge raises the bridge
    const bridge = m.all('-');
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'BRIDGE'), 'bridge up');
    // wait out of the rock thrower's reach, then the tougher club grunt goes first
    r.moveAll([
      [a, 11, 3],
      [b, 11, 4],
    ]);
    r.cmd({ type: 'attack', ids: [b], target: rocks });
    r.wait(900);
    r.gangUp([a, b], rocks);
    r.pickup(b, ...m.at('w'), 'WARPSTONE');
    // back over the river and east, where a club grunt keeps watch: a squeak toy under a
    // rock keeps him busy while both sneak past
    r.moveAll([
      [a, 44, 5],
      [b, 40, 4],
    ]);
    const [tx, ty] = m.at('t');
    r.tool(a, tx, ty);
    r.pickup(a, tx, ty, 'SQUEAKTOY');
    r.giveToy(a, club);
    r.moveAll([
      [a, 50, 18],
      [b, 51, 17],
    ]);
    r.crossBoulders(a, 50, 20, 23);
    const bricks = m.all('B');
    const [bx, by] = bricks[1]!;
    r.breakBrickz(a, bx, by);
    r.move(a, 47, 28); // out of the gap
    r.crossBoulders(b, 51, 20, 23);
    r.deliver(b, ...m.at('F'));
  },

  'rocky-2': r => {
    const m = marks(rocky2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const [mega1, mega2] = m.all('y').sort((p, q) => p[0] - q[0]);
    const [summitChaser, terraceChaser] = m.all('E').map(p => r.enemyAt(...p));
    const clubber = r.enemyAt(...m.at('C'));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.move(b, ...mega1!); // megaphone: a goober straw
    r.cmd({ type: 'give', slot: 0, id: b });
    for (const p of m.all('u')) r.suck(b, ...p);
    const c = r.bake(...m.at('p'));
    // the secret switch in the corner opens the A room in the yard
    r.move(b, ...m.at('Q'));
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret door open');
    r.tool(a, 15, 35); // out of the start
    r.move(a, 20, 32);
    r.move(b, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    // boulderz roll down column 27 all the way through the yard
    r.moveAll([
      [a, 25, 33],
      [c, 24, 34],
    ]);
    r.crossColumn(c, 27, 34, 31);
    r.move(c, ...mega2!); // megaphone: brick laying toolz
    r.cmd({ type: 'give', slot: 0, id: c });
    expect(r.grunt(c).tool).toBe('BRICK');
    r.move(c, 28, 31);
    // right after a boulder smashes at the bottom, run up and brick the pad at the top
    r.until(() => [...r.w.all('ball')].some(ball => ball.state === 'break' && ball.y >= 38), 'a boulder to smash');
    r.move(c, 28, 28);
    const [px, py] = m.at('P');
    r.tool(c, px, py);
    expect(r.tile(px, py)).toBe('BRICKZ');
    r.move(c, 31, 25);
    r.move(b, 26, 33);
    for (const g of [a, b]) {
      r.move(g, 27, 30);
      r.move(g, 27, 28);
      r.move(g, g === a ? 25 : 29, 26);
    }
    r.gangUp([a, b, c], terraceChaser!);
    const [kx, ky] = m.at('k');
    r.tool(a, kx, ky);
    r.pickup(a, kx, ky, 'GOKART');
    // west over the boulder lane, between two boulderz
    for (const [g, y] of [
      [b, 21],
      [c, 22],
    ] as const) {
      r.move(g, 29, y);
      r.crossColumn(g, 27, y, 25);
    }
    r.moveAll([
      [b, 12, 19],
      [c, 13, 19],
    ]);
    r.giveToy(a, clubber);
    const [sx, sy] = m.all('▲').find(([x, y]) => y === 13 && x < 20)!; // the west stairz
    r.moveAll([
      [a, 12, 10],
      [b, 13, 10],
      [c, 14, 10],
    ]);
    r.gangUp([a, b, c], summitChaser!);
    r.pickup(b, ...m.at('e'), 'SPY');
    // over the boulder lane on the summit, then into the fortress along the brown brickz
    r.moveAll([
      [a, 25, 11],
      [b, 25, 10],
    ]);
    r.crossColumn(a, 27, 11, 30);
    r.crossColumn(b, 27, 10, 30);
    const [nx, ny] = m
      .all('N')
      .sort((p, q) => p[0] - q[0] || q[1] - p[1])
      .find(([x]) => x === 49)!;
    r.breakBrickz(a, nx, ny);
    r.breakBrickz(a, nx, ny - 1);
    r.tool(a, nx, ny - 2); // one punch and the giant rock is gone
    r.move(a, nx - 2, ny - 2);
    r.pickup(b, ...m.at('w'), 'WARPSTONE');
    // back over the boulder lane and down the west stairz, then two gruntz hold the purple switchez
    r.moveAll([
      [a, 29, 11],
      [b, 29, 10],
    ]);
    r.crossColumn(a, 27, 11, 25);
    r.crossColumn(b, 27, 10, 25);
    r.gangUp([a, c], clubber); // he holds his post at the foot of the west stairz
    r.moveAll([
      [c, sx + 2, sy + 4],
      [a, sx, sy + 3],
      [b, sx + 1, sy + 3],
    ]);
    r.moveAll([
      [a, ...m.at('v')],
      [c, ...m.at('z')],
    ]);
    const [vx, vy] = m.at('V');
    r.until(() => r.tile(vx, vy) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.deliver(b, ...m.at('F'));
  },

  'rocky-3': r => {
    const m = marks(rocky3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const bomber = r.enemyAt(...m.at('B'));
    const defender = r.enemyAt(...m.at('E'));
    const down = (chars: string) => m.all(chars).every(([x, y]) => r.tile(x, y).endsWith('_LO'));
    // the ridge grunt holds the green switch while the valley gruntz leave the start
    r.move(a, ...m.at('H'));
    r.until(() => down('G'), 'green gate down');
    r.moveAll([
      [b, 14, 32],
      [c, 14, 34],
    ]);
    r.move(a, 10, 14);
    // red switchez flip every red pyramid: the valley opens the ridge...
    r.move(b, ...m.at('z'));
    r.until(() => down('X'), 'ridge gate down');
    r.move(a, ...m.at('Z')); // ...and the ridge opens the valley again
    r.until(() => down('x'), 'valley gate down');
    // the secret: a trigger in the valley opens a red wormhole up on the ridge
    r.move(a, 28, 14);
    r.move(c, ...m.at('T'));
    const [sx, sy] = m.at('S');
    r.until(() => r.w.objectAt(sx, sy, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(a, sx, sy, ...m.at('L'));
    r.move(a, ...m.at('W'));
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.warp(a, ...m.at('O'), ...m.at('l'));
    r.pickup(c, ...m.at('k'), 'ROCK');
    r.move(b, ...m.at('y'));
    r.cmd({ type: 'give', slot: 0, id: b });
    expect(r.grunt(b).tool).toBe('GAUNTLETZ');
    r.moveAll([
      [b, 27, 38],
      [c, 28, 30],
    ]);
    r.attack(c, bomber); // a rock from below the butte
    // invisible, one grunt slips past the sword guard and holds the gate open for the other
    r.pickup(c, ...m.at('i'), 'GHOST');
    r.move(c, ...m.at('K'));
    r.until(() => down('V'), 'room 4 gate down');
    r.move(b, 50, 23);
    r.move(c, 49, 23);
    // up the landing to the rampart's east end, down to the north plateau; the ridge grunt too
    r.moveAll([
      [a, 36, 9],
      [b, 54, 9],
      [c, 55, 9],
    ]);
    // the silver gate stays down for a while: all three run through
    r.moveAll([
      [a, 33, 5],
      [b, 26, 5],
      [c, 26, 7],
    ]);
    r.move(a, ...m.at('t'));
    r.until(() => down('U'), 'silver gate down');
    r.gangUp([a, b, c], defender); // all together, or he picks us off one by one
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    r.moveAll([
      [a, 22, 4],
      [b, 22, 7],
    ]);
    r.move(b, ...m.at('u'));
    r.until(() => down('U'), 'silver gate down again');
    r.deliver(a, ...m.at('F'));
  },

  'rocky-4': r => {
    const m = marks(rocky4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const bomber = r.enemyAt(...m.at('B'));
    const thief = r.enemyAt(...m.at('T'));
    const defender = r.enemyAt(...m.at('D'));
    const hitter = r.enemyAt(...m.at('H'));
    const breaker = r.enemyAt(...m.at('C'));
    const toggle = m.all('A');
    const [tx] = toggle[0]!;
    const topY = Math.min(...toggle.map(p => p[1]));
    const bottomY = Math.max(...toggle.map(p => p[1]));
    /** One grunt over the toggle bridge, right after it comes up. */
    const overToggle = (g: number, toY: number) => {
      const up = () => toggle.every(([x, y]) => r.tile(x, y) === 'DBRIDGE_AUTO');
      r.until(() => !up(), 'toggle bridge down');
      r.until(up, 'toggle bridge up');
      r.move(g, tx, toY);
    };
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('s'), 'SHOVEL');
    r.pickup(c, ...m.at('k'), 'ROCK');
    r.moveAll([
      [a, tx, bottomY + 1],
      [b, tx - 1, bottomY + 2],
      [c, tx + 1, bottomY + 2],
    ]);
    overToggle(a, topY - 1);
    r.move(a, tx - 2, topY - 2);
    r.move(b, tx, bottomY + 1);
    overToggle(b, topY - 1);
    r.move(b, tx + 2, topY - 2);
    r.move(c, tx, bottomY + 1);
    overToggle(c, topY - 1);
    // up to the rim; the checkpoint switch wants gauntletz
    r.moveAll([
      [a, 10, 15],
      [b, 12, 15],
      [c, 14, 15],
    ]);
    r.move(a, ...m.at('K'));
    const [yx, yy] = m.at('Y');
    r.until(() => r.tile(yx, yy) === 'PYRAMID_CHECK_LO', 'checkpoint pyramid down');
    r.move(c, 43, 12);
    r.attack(c, bomber); // a rock up at the pillar
    r.move(c, ...m.at('y')); // megaphone: a goober straw
    r.cmd({ type: 'give', slot: 0, id: c });
    for (const p of m.all('u')) r.suck(c, ...p);
    const d = r.bake(...m.at('p'));
    r.pickup(c, ...m.at('L'), 'CLUB'); // the goo is done, a club is more use now
    // empty-handed, the new grunt walks right past the tool thief to the blue switch
    r.move(d, ...m.at('b'));
    const bridge = m.all(':');
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'east bridge up');
    r.gangUp([c, d], thief); // the thief can't steal a club being swung at him
    // up the butte stairz between two boulderz
    const smashed = () => [...r.w.all('ball')].some(ball => ball.state === 'break' && ball.y >= yy);
    for (const [g, x, y] of [
      [a, 31, 10],
      [b, 33, 10],
    ] as const) {
      r.move(g, yx - 1, yy + 2); // wait beside the boulder lane, not across it
      r.until(smashed, 'a boulder to smash');
      r.move(g, x, y);
    }
    const [jx, jy] = m.at('j');
    r.tool(b, jx, jy); // dig the mound...
    r.tool(b, jx, jy); // ...and fill the hole to walk onto the toy
    r.pickup(b, jx, jy, 'JACKINTHEBOX');
    // (he may have chased someone into the boulder lane already)
    if (r.w.get(defender, 'grunt') && !isGone(r.grunt(defender))) r.giveToy(b, defender);
    r.pickup(b, ...m.at('w'), 'WARPSTONE');
    for (const [g, x, y] of [
      [a, 29, 15],
      [b, 30, 16],
    ] as const) {
      r.move(g, yx - 1, yy - 2); // beside the lane at the top of the stairz
      r.until(smashed, 'a boulder to smash');
      r.move(g, x, y);
    }
    // (gruntz walk straight into abysses: first to the bridge head, then over it)
    const [ex] = bridge[0]!;
    r.moveAll([
      [a, ex - 1, 15],
      [c, ex, 15],
      [d, ex + 1, 15],
    ]);
    for (const [g, x] of [
      [a, ex - 1],
      [c, ex],
      [d, ex + 1],
    ] as const) {
      r.move(g, ex, 18);
      r.move(g, ex, 24);
      r.move(g, x, 26);
    }
    r.move(a, ...m.at('*')); // zap cola: the sword guard got a few swings in
    r.move(c, ...m.at('G')); // and a keg for the club
    r.pickup(d, ...m.at('N'), 'SWORD');
    r.gangUp([a, c, d], hitter);
    r.gangUp([a, c, d], breaker);
    // the valley is safe: the carrier takes the crumbling path
    const crumble = m.all('c');
    const [cx] = crumble[0]!;
    r.move(b, cx, Math.min(...crumble.map(p => p[1])) - 1);
    r.move(b, cx, Math.max(...crumble.map(p => p[1])) + 1);
    // the secret switch in the valley corner opens the P room
    r.move(d, ...m.at('Q'));
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret door open');
    r.move(d, ...m.at('P'));
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.moveAll([
      [a, ...m.at('v')],
      [d, ...m.at('z')],
    ]);
    const [vx, vy] = m.at('V');
    r.until(() => r.tile(vx, vy) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.deliver(b, ...m.at('F'));
  },
};
