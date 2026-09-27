import { expect } from 'vitest';
import minis1 from '../../../../content/src/levels/minis-1.ts';
import minis2 from '../../../../content/src/levels/minis-2.ts';
import minis3 from '../../../../content/src/levels/minis-3.ts';
import minis4 from '../../../../content/src/levels/minis-4.ts';
import type { Walkthrough } from '../walkthrough.ts';
import { crossBallLane, throughHazards } from './helpers.ts';
import { marks } from './marks.ts';

export const MINIS: Record<string, (r: Walkthrough) => void> = {
  'minis-1': r => {
    const m = marks(minis1);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const golfer = r.enemyAt(...m.at('C'));
    const toyer = r.enemyAt(...m.at('T'));
    const soldiers = m.all('K').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('s'), 'SPRING');
    r.pickup(b, ...m.at('k'), 'CLUB');
    r.pickup(c, ...m.at('n'), 'WAND');
    // over the fairway between two golf ballz
    const [, laneY] = m.at('O');
    const bridge = m.all('-');
    const [bx] = bridge[0]!;
    const south = Math.max(...bridge.map(p => p[1]));
    const north = Math.min(...bridge.map(p => p[1]));
    for (const [g, dx] of [
      [a, 0],
      [b, -2],
      [c, 2],
    ] as const)
      crossBallLane(r, g, bx + dx, laneY, laneY + 1, laneY - 1);
    // the secret: a hop from the shore onto the islet and back
    const [wx, wy] = m.at('W');
    r.move(a, wx - 2, wy);
    r.move(a, wx, wy);
    expect(r.w.team(0)!.stats.letters).toContain('W');
    r.move(a, wx - 2, wy);
    // springz over the cups to the switch: the bridge comes up
    r.move(a, ...m.at('x'));
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'BRIDGE'), 'the pond bridge up');
    for (const [g, dx] of [
      [a, -2],
      [b, -3],
      [c, -4],
    ] as const) {
      r.move(g, bx, south + 1);
      r.move(g, bx, north - 1);
      r.move(g, bx + dx, north - 1);
    }
    // (springz land on friendz and the wand's ballz roll over them: clubz for this fight)
    r.pickup(a, ...m.at('q'), 'CLUB');
    r.move(c, bx + 6, north - 1);
    r.gangUp([b, a], golfer);
    r.gangUp([b, a], toyer);
    // through the mortar in front of the corridor: c first, and his rolling ballz flatten
    // the three toy soldierz standing in a row
    const [, ey] = m.all('e')[0]!;
    const gate: [number, number] = [bx + 1, ey]; // the one mortar in front of the corridor's mouth
    r.moveAll([
      [a, bx - 3, ey + 1],
      [b, bx - 4, ey + 1],
    ]);
    r.move(c, gate[0], gate[1] + 1);
    r.passHazard(c, gate[0], gate[1], gate[0], gate[1] - 1);
    r.move(c, gate[0], gate[1] - 3);
    r.cmd({ type: 'useTool', ids: [c], x: gate[0], y: gate[1] - 3 });
    r.until(
      () => soldiers.every(s => !r.w.get(s, 'grunt') || r.grunt(s).action.kind === 'death'),
      'the soldierz flattened',
    );
    r.until(() => [...r.w.all('ball')].length === 0, 'the ballz gone');
    // along the corridor (one tile wide: c goes first) and up the hill
    const [hx, hy] = m.at('▶');
    r.move(c, hx - 2, hy);
    for (const [g, k] of [
      [a, 3],
      [b, 4],
    ] as const) {
      r.move(g, gate[0], gate[1] + 1);
      r.passHazard(g, gate[0], gate[1], gate[0], gate[1] - 1);
      r.move(g, hx - k, hy);
    }
    // the time switch turnz the windmill's arrowz up the stairz for a few secondz
    const [yx, yy] = m.at('y');
    const arrows = m.all('⇓');
    const [ax] = arrows[0]!;
    const bottom = Math.max(...arrows.map(p => p[1]));
    r.move(c, hx + 3, hy + 1);
    r.move(a, hx + 1, hy);
    r.move(a, yx, yy);
    r.until(() => arrows.every(([x, y]) => r.tile(x, y) === 'ARROW2_N'), 'the windmill arrowz up');
    r.move(a, ax, bottom + 1);
    r.cmd({ type: 'move', ids: [a], x: ax, y: bottom });
    r.until(
      () => r.w.level(r.grunt(a).x, r.grunt(a).y) >= 1 && r.grunt(a).y < bottom - 1 && r.settled(a),
      'a carried up the arrowz',
    );
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // down again: the arrowz point down by now and carry a back
    r.until(() => arrows.every(([x, y]) => r.tile(x, y) === 'ARROW2_S'), 'the windmill arrowz down');
    r.cmd({ type: 'move', ids: [a], x: ax, y: bottom + 1 });
    r.until(() => r.grunt(a).y > bottom && r.settled(a), 'a carried down the arrowz');
    r.move(b, gate[0], gate[1] - 1); // b leadz the way back out of the narrow corridor
    r.passHazard(b, gate[0], gate[1], gate[0], gate[1] + 1);
    r.move(b, gate[0] + 2, gate[1] + 1);
    r.move(a, hx - 1, hy);
    r.move(a, gate[0], gate[1] - 2);
    r.move(a, gate[0], gate[1] - 1);
    r.passHazard(a, gate[0], gate[1], gate[0], gate[1] + 1);
    r.move(a, bx, north - 1);
    r.move(a, bx, south + 1);
    crossBallLane(r, a, bx, laneY, laneY - 1, laneY + 1);
    r.deliver(a, ...m.at('F'));
  },

  'minis-2': r => {
    const m = marks(minis2);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const generals = m.all('D').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('b'), 'GRAVITYBOOTZ');
    r.pickup(b, ...m.at('k'), 'CLUB');
    r.pickup(c, ...m.at('K'), 'CLUB');
    // through the fence's gate of mortarz and over the railway
    const [gx, gy] = m.all('e')[1]!;
    const [, laneY] = m.at('O');
    for (const [g, x] of [
      [a, 16],
      [b, 38],
      [c, 42],
    ] as const) {
      r.move(g, gx, gy + 1);
      throughHazards(r, g, gx, [gy], -1);
      crossBallLane(r, g, x, laneY, gy - 1, laneY - 2);
      // a walks the ridge right away: nerf shots can't budge gravity bootz (but they sting)
      if (g === a) {
        r.move(a, ...m.at('x'));
        r.move(a, 24, 16); // and out of their range
      }
    }
    // the switch at the ridge's end raises the drawbridge
    const bridge = m.all(':');
    const [bx] = bridge[0]!;
    const top = Math.min(...bridge.map(p => p[1]));
    const bottom = Math.max(...bridge.map(p => p[1]));
    r.until(() => bridge.every(([x, y]) => r.tile(x, y) === 'DBRIDGE'), 'the drawbridge up');
    for (const [g, dx] of [
      [b, -1],
      [c, 1],
    ] as const) {
      r.move(g, bx, bottom + 1);
      r.move(g, bx, top - 1);
      r.move(g, bx + dx, top - 2);
    }
    r.move(a, bx - 3, top - 2);
    // into the toy fort: the death touch, one general per touch
    // b slips in alone straight to the death touch; one general per touch
    const [sx, sy] = m.all('▲').find(([, y]) => y === top - 3)!;
    r.move(b, sx, sy + 1);
    r.move(b, ...m.at('d'));
    expect(r.grunt(b).powerup).toBe('DEATHTOUCH');
    // (a general always swings first: a keg between the two)
    r.attack(b, generals[0]!);
    r.move(b, ...m.at('H'));
    r.attack(b, generals[1]!);
    for (const g of [c, a]) {
      r.move(g, sx, sy + 1);
      r.move(g, sx - 2 - [c, a].indexOf(g), sy - 2);
    }
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the secret: c through the one-way wormhole to the tower top, and back by the green one
    r.warp(c, ...m.at('U'), ...m.at('u'));
    r.move(c, ...m.at('A'));
    expect(r.w.team(0)!.stats.letters).toContain('A');
    r.warp(c, ...m.at('V'), ...m.at('v'));
    // home with the warpstone
    r.move(a, sx, sy - 1);
    r.move(a, sx, sy + 1);
    r.move(a, bx, top - 1);
    r.move(a, bx, bottom + 1);
    crossBallLane(r, a, bx, laneY, laneY - 2, gy - 1);
    r.move(a, gx, gy - 1);
    throughHazards(r, a, gx, [gy], 1);
    r.deliver(a, ...m.at('F'));
  },

  'minis-3': r => {
    const m = marks(minis3);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const toyer = r.enemyAt(...m.at('T'));
    const guards = m.all('K').map(p => r.enemyAt(...p));
    r.pickup(b, ...m.at('k'), 'CLUB');
    r.pickup(c, ...m.at('c'), 'CLUB');
    r.gangUp([b, c], toyer);
    // superspeed, the time switch, and the whole corridor before its gate shuts
    r.move(a, ...m.at('z'));
    expect(r.grunt(a).powerup).toBe('SUPERSPEED');
    r.move(a, ...m.at('x'));
    const [ex, ey] = m.all('▶')[0]!;
    r.move(a, ex + 1, ey);
    // beyond the gate: the switch opens the tower's green door for the otherz
    r.move(a, ...m.at('b'));
    const [gx, gy] = m.at('G');
    r.until(() => r.tile(gx, gy) === 'PYRAMID_GREEN_LO', 'the green door open');
    for (const [g, dx] of [
      [b, -1],
      [c, 1],
    ] as const) {
      r.move(g, gx, gy + 1);
      r.move(g, gx, gy - 2);
      r.move(g, gx + dx, gy - 3);
    }
    // the club guardz at the gallery stairz
    const [sx, sy] = m.all('▲').find(([x, y]) => x !== gx && y > 5)!;
    r.moveAll([
      [b, sx - 2, sy + 3],
      [c, sx + 2, sy + 3],
      [a, sx, sy + 4],
    ]);
    for (const guard of guards) r.gangUp([b, c, a], guard);
    // up to the gallery, over the pendulum's lane, up to the top
    const [, laneY] = m.at('O');
    const [tx, ty] = m.all('▲').find(([, y]) => y === laneY - 1)!;
    r.move(a, sx, sy + 1);
    r.move(a, sx, sy - 1);
    crossBallLane(r, a, tx, laneY, laneY + 1, ty - 1);
    r.move(a, ...m.at('Q'));
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the secret nook in the square
    const [qx, qy] = m.at('q');
    r.until(() => r.tile(qx, qy).endsWith('_LO'), 'secret nook open');
    r.move(
      [c, b].find(g => r.w.get(g, 'grunt'))!,
      ...m.at('L'),
    );
    expect(r.w.team(0)!.stats.letters).toContain('R');
    // home: over the lane, down to the base, out of the green door, to the fort
    r.move(a, tx, ty - 1);
    crossBallLane(r, a, tx, laneY, ty - 1, laneY + 1);
    r.move(a, sx, sy - 1);
    r.move(a, sx, sy + 1);
    r.move(a, gx, gy - 2);
    r.move(a, gx, gy + 1);
    r.deliver(a, ...m.at('F'));
  },

  'minis-4': r => {
    const m = marks(minis4);
    const a = r.gruntAt(...m.at('1'));
    const b = r.gruntAt(...m.at('2'));
    const c = r.gruntAt(...m.at('3'));
    const chaser = r.enemyAt(...m.at('C'));
    const guards = m.all('DE').map(p => r.enemyAt(...p));
    r.pickup(a, ...m.at('g'), 'GAUNTLETZ');
    r.pickup(b, ...m.at('k'), 'CLUB');
    // the secret first: c flies out to the platform in the chasm and back
    r.pickup(c, ...m.at('n'), 'WINGZ');
    const [lx, ly] = m.at('L');
    const edge = Math.min(...m.all('_').map(p => p[0])) - 1;
    r.move(c, edge, ly);
    r.move(c, lx, ly);
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.move(c, edge, ly);
    r.pickup(c, ...m.at('K'), 'CLUB');
    // up the stairz at the foot; the chaser on the first ring
    const [fx, fy] = m.all('▲').find(([, y]) => y > 30)!;
    for (const [g, dx] of [
      [b, -1],
      [c, 0],
      [a, 1],
    ] as const) {
      r.move(g, fx, fy + 1);
      r.move(g, fx, fy - 1);
      r.move(g, fx + dx, fy - 2);
    }
    // west along the ring, over the train's track, through the mortarz, up to ring 2
    const [, laneY] = m.at('O');
    const mortars = m.all('e');
    const [mx, my] = mortars[2]!;
    const [sx, sy] = m.at('▶');
    for (const g of [b, c, a]) {
      r.move(g, mx, laneY + 2);
      crossBallLane(r, g, mx, laneY, laneY + 1, laneY - 1);
      // off the landing for the next one (and out of the club guard's reach)
      const [wx, wy] = (
        [
          [14, laneY - 1],
          [15, laneY - 2],
          [14, laneY - 3],
        ] as const
      )[[b, c, a].indexOf(g)]!;
      r.move(g, wx, wy);
    }
    r.gangUp([b, c, a], chaser); // the club guard by the mortarz
    for (const g of [b, c, a]) {
      r.move(g, mx, my + 1);
      throughHazards(r, g, mx, [my], -1);
      r.move(g, sx - 1, sy);
      r.move(g, sx + 2, sy - 1 - [b, c, a].indexOf(g));
    }
    // north on ring 2, over the second train's lane, past the sword guardz
    const [px] = m.at('P');
    const [rx, ry] = m.at('▼');
    const row = ry - 2;
    for (const [g, dy] of [
      [b, -1],
      [c, 1],
    ] as const) {
      r.move(g, px - 2, row);
      r.crossColumn(g, px, row, px + 1);
      r.move(g, px + 1, row + dy); // two tilez from the first guard: he only swings at the next tile
    }
    // (a and the gauntletz keep out of the first fight: the rock on the summit needz them)
    r.move(a, px - 2, row);
    const fighters = () => [b, c].filter(g => r.w.get(g, 'grunt'));
    r.gangUp(fighters(), guards[0]!);
    const hurt = fighters().sort((p, q) => r.grunt(p).health - r.grunt(q).health)[0]!;
    r.move(hurt, ...m.all('*').find(([, y]) => y < 12)!); // a bottle between the two
    r.crossColumn(a, px, row, px + 1);
    r.gangUp([...fighters(), a], guards[1]!);
    // a punches the giant rock off the top of the summit stairz
    r.move(a, rx, ry - 1);
    r.move(a, rx, ry);
    r.tool(a, rx, ry + 1);
    expect([...r.w.all('giantrock')]).toHaveLength(0);
    r.pickup(a, ...m.at('w'), 'WARPSTONE');
    // the tunnel down to the foot, and the fort
    r.warp(a, ...m.at('U'), ...m.at('u'));
    r.deliver(a, ...m.at('F'));
  },
};
