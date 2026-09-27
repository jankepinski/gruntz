import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels.ts';
import { Walkthrough } from './walkthrough.ts';

/**
 * Every quest level ships with a scripted solution: proof that it can be won with the
 * real simulation. A level without a solution fails the last test.
 */
const SOLUTIONS: Record<string, (r: Walkthrough) => void> = {
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

  'rocky-1': r => {
    const a = r.gruntAt(3, 18);
    const b = r.gruntAt(4, 19);
    const wild = [r.enemyAt(18, 14), r.enemyAt(21, 20), r.enemyAt(28, 12)];
    r.pickup(a, 6, 16, 'GAUNTLETZ');
    r.pickup(b, 8, 20, 'GAUNTLETZ');
    r.tool(a, 12, 17);
    r.tool(b, 5, 13);
    r.move(b, 5, 13); // a coin was under the rock
    r.attack(a, wild[0]!);
    r.attack(a, wild[1]!);
    r.move(a, 16, 4);
    r.until(() => r.tile(24, 11) === 'PYRAMID_GREEN_LO', 'gate down');
    r.attack(a, wild[2]!);
    r.tool(a, 29, 5);
    r.pickup(a, 30, 5, 'WARPSTONE');
    r.deliver(a, 30, 17);
  },

  'rocky-2': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 14);
    const [sucker, chaser, guard] = [r.enemyAt(22, 13), r.enemyAt(18, 19), r.enemyAt(30, 8)];
    r.pickup(a, 6, 10, 'SHOVEL');
    r.tool(a, 12, 12); // fill the holes: mounds can be walked on
    r.tool(a, 12, 13);
    r.move(b, 8, 14); // megaphone -> goober straw
    r.cmd({ type: 'give', slot: 0, id: b });
    r.suck(b, 5, 21);
    r.suck(b, 8, 22);
    r.attack(a, sucker!);
    r.attack(a, chaser!);
    r.suck(b, 16, 13);
    r.suck(b, 21, 8);
    const c = r.bake(15, 7);
    r.attack(a, guard!);
    r.moveAll([
      [b, 29, 3],
      [c, 29, 22],
    ]);
    r.until(() => r.tile(33, 12) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.tool(a, 36, 5); // dig the mound...
    r.tool(a, 36, 5); // ...and fill it to reach the warpstone
    r.pickup(a, 36, 5, 'WARPSTONE');
    r.deliver(a, 35, 18);
  },

  'rocky-3': r => {
    const a = r.gruntAt(3, 13);
    const b = r.gruntAt(3, 15);
    const [toyer, thief, glover, smart] = [r.enemyAt(6, 22), r.enemyAt(17, 20), r.enemyAt(24, 20), r.enemyAt(35, 16)];
    r.pickup(a, 5, 9, 'CLUB');
    r.pickup(b, 4, 17, 'CLUB');
    r.gangUp([a, b], toyer!);
    r.pickup(b, 2, 24, 'SQUEAKTOY');
    // Arrowz push you one tile and then you stop (like the original), so walk on after.
    r.moveAll([
      [a, 11, 12],
      [b, 11, 13],
    ]);
    r.gangUp([a, b], thief!);
    r.move(a, 13, 4); // yellow switch flips the two-way arrowz
    r.until(() => r.tile(21, 13) === 'ARROW2_E', 'arrowz flipped');
    r.moveAll([
      [a, 22, 12],
      [b, 22, 14],
    ]);
    r.gangUp([a, b], glover!);
    r.move(a, 24, 8); // orange #1: first gate opens, second shuts
    r.until(() => r.tile(27, 12) === 'PYRAMID_ORANGE_LO' && r.tile(32, 12) === 'PYRAMID_ORANGE', 'first gate open');
    r.moveAll([
      [a, 29, 12],
      [b, 29, 13],
    ]);
    r.move(b, 30, 16); // a bottle of zap cola
    r.move(a, 30, 8); // orange #2: the other way round
    r.until(() => r.tile(32, 12) === 'PYRAMID_ORANGE_LO', 'second gate open');
    r.moveAll([
      [a, 34, 12],
      [b, 34, 13],
    ]);
    r.giveToy(b, smart!); // he plays with the squeak toy while we line up the first blows
    r.gangUp([a, b], smart!);
    r.move(a, 35, 9); // silver switch
    r.pickup(a, 38, 3, 'WARPSTONE');
    r.move(a, 38, 7);
    r.deliver(a, 36, 21);
  },

  'rocky-4': r => {
    const a = r.gruntAt(3, 24);
    const b = r.gruntAt(4, 26);
    const c = r.gruntAt(3, 28);
    const [hitter, breaker, bomber, defender] = [r.enemyAt(29, 21), r.enemyAt(27, 26), r.enemyAt(14, 13), r.enemyAt(42, 25)];
    r.pickup(a, 7, 22, 'GAUNTLETZ');
    r.pickup(b, 9, 27, 'CLUB');
    r.tool(a, 14, 24); // one punch and the giant rock is gone
    r.move(b, 18, 27); // megaphone -> brick layer
    r.cmd({ type: 'give', slot: 0, id: c });
    r.tool(c, 22, 19); // a brick in the boulder lane
    r.gangUp([a, b], hitter!);
    r.gangUp([a, b], breaker!);
    r.pickup(c, 25, 28, 'ROCK');
    r.moveAll([
      [a, 27, 15],
      [b, 28, 15],
      [c, 29, 15],
    ]);
    r.attack(c, bomber!); // rockz from a safe distance
    // over the abyss: one grunt takes the crumbling bridge, the others wait for the moving one
    r.move(a, 10, 10);
    r.move(a, 10, 7);
    for (const g of [b, c]) {
      r.move(g, 20, 10);
      r.until(() => r.tile(20, 8) === 'DBRIDGE_AUTO_LO', 'bridge down');
      r.until(() => r.tile(20, 8) === 'DBRIDGE_AUTO', 'bridge up again');
      r.move(g, 20, 7);
      r.move(g, g === b ? 22 : 23, 4);
    }
    r.move(a, 6, 4); // checkpoint switch wants gauntletz
    r.until(() => r.tile(32, 4) === 'PYRAMID_CHECK_LO', 'checkpoint gate open');
    // the secret: a trigger in the corner opens a red wormhole for a while
    r.move(c, 1, 1);
    r.until(() => r.w.objectAt(14, 3, 'wormhole')?.open === true, 'secret wormhole open');
    r.cmd({ type: 'move', ids: [c], x: 14, y: 3 });
    r.until(() => r.grunt(c).x >= 39 && r.grunt(c).y <= 5 && r.grunt(c).action.kind === 'idle', 'c in the secret room');
    r.move(c, 43, 2);
    expect(r.w.team(0)!.stats.letters).toContain('P');
    r.moveAll([
      [a, 38, 19],
      [b, 42, 19],
    ]);
    r.crossBoulders(a, 38, 20, 21);
    r.crossBoulders(b, 42, 20, 21);
    r.gangUp([a, b], defender!);
    r.pickup(a, 44, 27, 'WARPSTONE');
    r.move(a, 41, 21);
    r.crossBoulders(a, 41, 20, 19);
    r.deliver(a, 40, 11);
  },

  'ice-1': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 14);
    const thrower = r.enemyAt(30, 12);
    r.pickup(a, 5, 10, 'TOOB');
    r.pickup(b, 5, 16, 'TOOB');
    r.moveAll([
      [a, 15, 12],
      [b, 15, 14],
    ]); // swim up to the storm's lane and wait
    r.waitMover('cloud', (p, leg) => leg === 1 && p.y < 10, 'the storm cloud heading north');
    r.moveAll([
      [a, 21, 12],
      [b, 21, 14],
    ]);
    r.moveAll([
      [a, 27, 12],
      [b, 27, 14],
    ]);
    r.pickup(a, 29, 9, 'SHOVEL');
    r.pickup(b, 28, 17, 'CLUB');
    r.attack(b, thrower!);
    r.tool(a, 31, 6);
    r.tool(a, 31, 6);
    r.pickup(a, 31, 6, 'WARPSTONE');
    r.deliver(a, 30, 18);
  },

  'ice-2': r => {
    const a = r.gruntAt(3, 10);
    const b = r.gruntAt(3, 14);
    const wild = r.enemyAt(15, 15);
    r.pickup(a, 5, 8, 'SPRING');
    r.pickup(b, 5, 16, 'CLUB');
    r.move(a, 12, 8); // over the crevasse in one jump
    r.move(a, 13, 4); // blue switch: the bridge comes up
    r.until(() => r.tile(10, 12) === 'DBRIDGE', 'bridge up');
    r.move(b, 13, 12);
    r.attack(b, wild!);
    r.move(a, 17, 12);
    r.move(a, 19, 12); // spikez jumped, spring intact
    expect(r.grunt(a).tool).toBe('SPRING');
    r.waitMover('cloud', (p, leg) => leg === 1 && p.y < 9, 'the storm heading north');
    r.move(a, 25, 12);
    r.move(a, 27, 11); // over the ice hole
    r.pickup(a, 32, 6, 'WARPSTONE');
    r.deliver(a, 31, 17);
  },

  'ice-3': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 16);
    const c = r.gruntAt(3, 14);
    const [north, south, sponge] = [r.enemyAt(16, 6), r.enemyAt(16, 21), r.enemyAt(24, 13)];
    r.pickup(a, 5, 8, 'ROCK');
    r.pickup(b, 5, 20, 'ROCK');
    r.pickup(c, 7, 14, 'BOOMERANG');
    r.gangUp([a, c], north!);
    r.gangUp([b, c], south!);
    r.move(c, 8, 13); // c is hurt: keep it out of the next fight
    r.gangUp([a, b], sponge!);
    r.move(c, 12, 13); // megaphone -> timebomb
    r.cmd({ type: 'give', slot: 0, id: c });
    r.move(c, 26, 13);
    r.cmd({ type: 'useTool', ids: [c], x: 28, y: 13 });
    r.until(() => !!r.w.objectAt(28, 13, 'timebomb'), 'bomb placed');
    r.move(c, 22, 13); // RUN!
    r.until(() => r.tile(30, 13) !== 'GIANT_ROCK', 'the ice block blown up');
    r.move(a, 22, 7); // a bottle of zap cola first
    r.move(a, 33, 8);
    r.pickup(a, 35, 5, 'WARPSTONE');
    r.move(a, 35, 11);
    r.waitMover('cloud', (p, leg) => leg === 1 && p.x < 34, 'the storm drifting west');
    r.move(a, 35, 15);
    r.deliver(a, 34, 21);
  },

  'ice-4': r => {
    const a = r.gruntAt(3, 13);
    const b = r.gruntAt(3, 17);
    const c = r.gruntAt(3, 15);
    const [clubber, guard] = [r.enemyAt(33, 9), r.enemyAt(39, 13)];
    r.pickup(a, 6, 9, 'WINGZ');
    r.pickup(b, 6, 21, 'GAUNTLETZ');
    r.pickup(c, 8, 15, 'SWORD');
    // the secret nook: its switch opens the pyramid for a little while
    r.move(c, 6, 23);
    r.until(() => r.tile(4, 26) === 'PYRAMID_GREEN_LO', 'secret gate open');
    r.move(c, 2, 25);
    r.move(c, 7, 22);
    expect(r.w.team(0)!.stats.letters).toContain('P');
    // fly the crevasse while the storm is away down south
    r.move(a, 11, 5);
    r.waitMover('cloud', (p, leg) => leg === 0 && p.y > 7, 'the storm heading south');
    r.move(a, 26, 5);
    r.move(a, 27, 4);
    r.until(() => r.tile(18, 15) === 'DBRIDGE', 'bridge up');
    // Line up on the bridge's axis: a step off it is a step into the abyss.
    r.moveAll([
      [b, 11, 15],
      [c, 10, 15],
    ]);
    r.waitMover('cloud', (p, leg) => leg === 0 && p.y > 17, 'the storm past the bridge');
    r.cmd({ type: 'move', ids: [b], x: 26, y: 15 });
    r.cmd({ type: 'move', ids: [c], x: 25, y: 15 });
    r.until(() => r.grunt(b).x === 26 && r.grunt(c).x === 25 && r.grunt(c).action.kind === 'idle', 'both across');
    r.move(b, 27, 22); // red switch: gate A down, gate B up
    r.until(() => r.tile(30, 14) === 'PYRAMID_RED_LO', 'outer gate open');
    r.moveAll([
      [a, 32, 14],
      [b, 32, 15],
      [c, 33, 16],
    ]);
    r.gangUp([b, c], clubber!);
    r.move(c, 33, 20); // the inner red switch flips them back
    r.until(() => r.tile(36, 14) === 'PYRAMID_RED_LO', 'inner gate open');
    r.gangUp([b, c], guard!);
    // two layers of brickz: two punches
    r.tool(b, 39, 17, () => r.w.objectAt(39, 17, 'brickz')?.layers.length === 1 && r.grunt(b).action.kind === 'idle');
    r.tool(b, 39, 17, () => !r.w.objectAt(39, 17, 'brickz') && r.grunt(b).action.kind === 'idle');
    r.move(b, 41, 19); // clear the gap
    r.pickup(a, 40, 9, 'WARPSTONE');
    r.deliver(a, 39, 21);
  },

  'tropics-1': r => {
    const a = r.gruntAt(3, 13);
    const b = r.gruntAt(3, 15);
    const [north, south] = [r.enemyAt(31, 10), r.enemyAt(33, 19)];
    r.pickup(a, 6, 10, 'GAUNTLETZ');
    r.pickup(b, 6, 18, 'SHOVEL');
    r.move(a, 10, 8); // bridge switch
    r.until(() => r.tile(13, 14) === 'DBRIDGE', 'bridge up');
    // straight over the bridge: a shortcut across the lava is a shortcut to the afterlife
    r.moveAll([
      [a, 12, 14],
      [b, 11, 14],
    ]);
    r.move(a, 15, 14);
    r.move(a, 16, 13);
    r.move(b, 15, 14);
    r.move(b, 16, 15);
    // geyser by geyser: go right after each eruption
    for (const [gx, stop] of [
      [18, 20],
      [21, 23],
      [24, 26],
    ] as const) {
      r.passHazard(a, gx, 13, stop, 13);
      r.passHazard(b, gx, 15, stop, 15);
    }
    r.gangUp([a, b], north!);
    r.gangUp([a, b], south!);
    r.tool(a, 35, 7); // the giant rock hid the warpstone
    r.pickup(a, 35, 6, 'WARPSTONE');
    r.deliver(a, 34, 20);
  },

  'tropics-2': r => {
    const a = r.gruntAt(3, 9);
    const b = r.gruntAt(3, 11);
    const [hitter, welder] = [r.enemyAt(24, 14), r.enemyAt(30, 8)];
    r.pickup(a, 7, 8, 'GUNHAT');
    r.pickup(b, 5, 15, 'TOOB');
    r.move(b, 18, 18); // swim around the headland and press the switch
    r.until(() => r.tile(13, 9) === 'PYRAMID_GREEN_LO', 'gate open');
    r.move(a, 16, 9);
    r.attack(a, hitter!);
    r.attack(a, welder!); // the gunhat shrugs off welder fireballz
    r.pickup(a, 33, 6, 'WARPSTONE');
    r.deliver(a, 35, 14);
  },

  'tropics-3': r => {
    const a = r.gruntAt(3, 13);
    const [bomberz, bomber] = [r.enemyAt(32, 12), r.enemyAt(34, 19)];
    r.pickup(a, 6, 11, 'GAUNTLETZ');
    r.move(a, 9, 14); // invulnerability!
    expect(r.grunt(a).powerup).toBe('INVULNERABILITY');
    r.move(a, 25, 14); // straight through the erupting field
    r.attack(a, bomber!); // it blows up, we don't
    r.attack(a, bomberz!);
    r.tool(a, 36, 13);
    r.pickup(a, 40, 8, 'WARPSTONE');
    r.deliver(a, 39, 18);
  },

  'tropics-4': r => {
    const a = r.gruntAt(3, 14);
    const b = r.gruntAt(3, 18);
    const [wild1, wild2] = [r.enemyAt(16, 19), r.enemyAt(19, 12)];
    r.pickup(a, 6, 12, 'GAUNTLETZ');
    r.move(b, 10, 16);
    r.move(b, 6, 20); // conversion
    r.move(b, 10, 16);
    r.move(b, 15, 16);
    // hit them once: they join us
    r.cmd({ type: 'attack', ids: [b], target: wild1! });
    r.until(() => r.grunt(wild1!).team === 0, 'first convert');
    r.cmd({ type: 'attack', ids: [b], target: wild2! });
    r.until(() => r.grunt(wild2!).team === 0, 'second convert');
    r.cmd({ type: 'move', ids: [wild2!], x: 17, y: 15 }); // out from under the parrot's lane!
    r.move(b, 20, 17); // a keg of cola against the drain
    r.move(a, 10, 16);
    r.move(a, 15, 16);
    // across the sinking bridge one by one, lined up on its axis
    for (const g of [a, b, wild1!, wild2!]) {
      r.move(g, 26, 16);
      r.until(() => r.tile(28, 16) === 'DBRIDGE_AUTO_LO', 'bridge down');
      r.until(() => r.tile(28, 16) === 'DBRIDGE_AUTO', 'bridge up');
      r.move(g, 31, 16);
      r.move(g, 31, g === a ? 17 : g === b ? 14 : g === wild1 ? 18 : 13);
    }
    r.move(a, 32, 16); // ghost: the guard can't see us
    expect(r.grunt(a).powerup).toBe('GHOST');
    r.moveAll([
      [wild1!, 33, 5],
      [wild2!, 33, 27],
    ]);
    r.until(() => r.tile(38, 15) === 'PYRAMID_MANY_LO', 'purple gate down');
    r.move(a, 40, 15);
    r.pickup(a, 42, 8, 'WARPSTONE');
    r.deliver(a, 41, 22);
  },

  'sweetz-1': r => {
    const a = r.gruntAt(3, 11);
    const b = r.gruntAt(3, 14);
    const gang = [r.enemyAt(26, 11), r.enemyAt(27, 14), r.enemyAt(26, 17)];
    r.pickup(a, 6, 9, 'CLUB');
    r.pickup(b, 6, 16, 'SCROLL');
    r.moveAll([
      [a, 11, 12],
      [b, 11, 14],
    ]);
    for (const [cx, stop] of [
      [13, 15],
      [16, 18],
      [19, 21],
    ] as const) {
      r.passHazard(a, cx, 12, stop, 12);
      r.passHazard(b, cx, 14, stop, 14);
    }
    r.move(a, 23, 7); // well out of the scroll's 9x9 reach, or it freezes too
    r.move(b, 23, 14);
    r.castScroll(b);
    for (const e of gang) expect(r.grunt(e!).frozen).toBe(true);
    for (const e of gang) r.attack(a, e!); // one blow each: they shatter
    r.move(a, 30, 7);
    r.pickup(a, 35, 8, 'WARPSTONE');
    r.deliver(a, 34, 17);
  },

  'sweetz-2': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 15);
    const toyer = r.enemyAt(21, 14);
    const guards = [r.enemyAt(24, 24), r.enemyAt(26, 24), r.enemyAt(28, 24)];
    r.pickup(a, 5, 6, 'WAND');
    r.pickup(b, 5, 20, 'SWORD');
    r.move(a, 13, 8);
    r.move(a, 17, 8); // over the crumbling candy before it gives way
    r.move(b, 8, 22); // yellow switch: arrowz point east now
    r.until(() => r.tile(15, 19) === 'ARROW2_E', 'arrowz flipped');
    r.move(b, 13, 19);
    r.cmd({ type: 'move', ids: [b], x: 14, y: 19 });
    r.until(() => r.grunt(b).x === 17 && r.grunt(b).action.kind === 'idle', 'b pushed across');
    r.attack(b, toyer!);
    r.move(a, 21, 24);
    r.cmd({ type: 'useTool', ids: [a], x: 22, y: 24 }); // rolling ballz!
    r.until(() => guards.every(g => !r.w.get(g!, 'grunt') || r.grunt(g!).action.kind === 'death'), 'the guardz flattened');
    r.until(() => [...r.w.all('ball')].length === 0, 'the ballz gone');
    r.pickup(a, 31, 24, 'WARPSTONE');
    r.deliver(a, 36, 13);
  },

  'sweetz-3': r => {
    const a = r.gruntAt(3, 13);
    r.pickup(a, 6, 13, 'SCROLL');
    r.move(a, 12, 13);
    r.castScroll(a); // the puddlez come back to life
    const squad = [...r.w.all('grunt')].filter(g => g.team === 0 && g.id !== a).map(g => g.id);
    expect(squad.length).toBe(5);
    const medic = squad[0]!;
    r.pickup(medic, 12, 18, 'SCROLL');
    r.move(medic, 12, 16);
    r.moveAll(squad.slice(1).map((id, i) => [id, 10 + i, 14] as [number, number, number]));
    r.castScroll(medic); // everyone but the medic back to full health
    expect(r.grunt(squad[1]!).health).toBe(20);
    r.moveAll([
      [squad[1]!, 24, 4],
      [squad[2]!, 24, 21],
      [squad[3]!, 28, 13],
    ]);
    r.until(() => r.tile(32, 12) === 'PYRAMID_MANY_LO', 'gate down');
    r.move(a, 30, 12);
    r.pickup(a, 36, 6, 'WARPSTONE');
    r.deliver(a, 35, 18);
  },

  'sweetz-4': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 18);
    const [layer, sword] = [r.enemyAt(26, 12), r.enemyAt(27, 5)];
    r.pickup(a, 6, 10, 'GAUNTLETZ');
    r.pickup(b, 6, 19, 'CLUB');
    // ride the upper belt one by one
    for (const g of [a, b]) {
      r.move(g, 9, 8);
      r.cmd({ type: 'move', ids: [g], x: 10, y: 8 });
      r.until(() => r.grunt(g).x === 21 && r.grunt(g).action.kind === 'idle', 'off the belt');
      r.move(g, 22, g === a ? 9 : 7);
    }
    r.gangUp([a, b], layer!);
    r.gangUp([a, b], sword!);
    // punch a hole in whatever got built on the pads
    const wall = [...r.w.all('brickz')].map(s => s.x);
    if (wall.includes(26)) {
      while (r.w.objectAt(26, 14, 'brickz')) {
        const n = r.w.objectAt(26, 14, 'brickz')!.layers.length;
        r.tool(a, 26, 14, () => (r.w.objectAt(26, 14, 'brickz')?.layers.length ?? 0) < n && r.grunt(a).action.kind === 'idle');
      }
    }
    r.move(a, 35, 12); // cola
    r.move(a, 40, 8);
    r.passHazard(a, 40, 7, 40, 6); // right after the candle flares
    expect(r.grunt(a).tool).toBe('WARPSTONE');
    r.passHazard(a, 40, 7, 40, 8);
    r.deliver(a, 40, 21);
  },

  'rollerz-1': r => {
    const a = r.gruntAt(3, 11);
    const b = r.gruntAt(3, 14);
    const chaser = r.enemyAt(28, 6);
    r.pickup(a, 6, 9, 'GAUNTLETZ');
    r.pickup(b, 6, 16, 'CLUB');
    for (const g of [a, b]) {
      const y = g === a ? 12 : 13;
      r.move(g, 11, y);
      for (const lane of [12, 18, 24]) {
        r.crossColumn(g, lane, y, lane + 1);
        if (lane !== 24) r.move(g, lane + 5, y);
      }
    }
    r.gangUp([a, b], chaser!);
    r.move(a, 29, 14); // around the stage, not across it
    r.move(a, 32, 13);
    r.passHazard(a, 32, 12, 32, 11); // in right after the trapdoor shuts
    expect(r.grunt(a).tool).toBe('WARPSTONE');
    r.passHazard(a, 32, 12, 32, 13);
    r.move(a, 32, 16);
    r.waitSpot(34, 19, 2.2);
    r.deliver(a, 35, 19);
  },

  'rollerz-2': r => {
    const a = r.gruntAt(3, 11);
    const b = r.gruntAt(3, 14);
    const clubber = r.enemyAt(18, 20);
    const vault = [r.enemyAt(30, 8), r.enemyAt(33, 14), r.enemyAt(30, 20)];
    r.pickup(a, 6, 9, 'GAUNTLETZ');
    r.pickup(b, 6, 16, 'SPY');
    r.move(b, 12, 9);
    r.cmd({ type: 'useTool', ids: [b], x: 12, y: 9 }); // spy on the spot: the brickz show their colours
    r.until(() => r.w.objectAt(14, 9, 'brickz')!.revealed.includes(0), 'brickz revealed');
    r.tool(a, 14, 9, () => !r.w.objectAt(14, 9, 'brickz') && r.grunt(a).action.kind === 'idle'); // the brown one
    r.move(a, 16, 9);
    r.move(b, 16, 10);
    r.gangUp([a, b], clubber!);
    r.move(b, 18, 4); // megaphone -> timebomb
    r.cmd({ type: 'give', slot: 0, id: b });
    r.move(b, 22, 12);
    r.cmd({ type: 'useTool', ids: [b], x: 23, y: 12 });
    r.until(() => !!r.w.objectAt(23, 12, 'timebomb'), 'bomb placed');
    r.move(b, 18, 12);
    r.move(a, 18, 11);
    r.until(() => !r.w.objectAt(24, 12, 'brickz'), 'gold wall blown open');
    r.move(a, 27, 20); // stopwatch: the vault guardz freeze
    r.until(() => vault.every(e => r.grunt(e!).frozen), 'guardz frozen');
    r.pickup(a, 36, 5, 'WARPSTONE');
    r.deliver(a, 34, 17);
  },

  'rollerz-3': r => {
    const a = r.gruntAt(3, 11);
    r.pickup(a, 6, 10, 'GRAVITYBOOTZ');
    r.move(a, 21, 13); // across the spikez without a scratch
    expect(r.grunt(a).health).toBe(20);
    r.waitSpot(23, 13, 2.5);
    r.move(a, 24, 13); // the safe ring between the circlez
    r.waitSpot(25, 13, 2.2);
    r.pickup(a, 27, 13, 'WARPSTONE');
    r.waitSpot(25, 13, 2.2);
    r.move(a, 24, 13);
    r.waitSpot(23, 13, 2.8);
    r.move(a, 21, 13);
    // around the stage, never through it
    r.move(a, 21, 22);
    r.move(a, 32, 22);
    r.move(a, 33, 13);
    r.deliver(a, 36, 20);
  },

  'rollerz-4': r => {
    const a = r.gruntAt(3, 14);
    const b = r.gruntAt(3, 18);
    const c = r.gruntAt(3, 16);
    const [north, south] = [r.enemyAt(27, 6), r.enemyAt(27, 26)];
    r.pickup(a, 6, 12, 'GAUNTLETZ');
    r.pickup(b, 6, 20, 'CLUB');
    r.pickup(c, 9, 5, 'WINGZ');
    r.move(c, 23, 5); // straight over the drop
    for (const g of [a, b]) {
      r.move(g, 13, 16);
      r.until(() => r.tile(16, 16) === 'DBRIDGE_AUTO_LO', 'bridge down');
      r.until(() => r.tile(16, 16) === 'DBRIDGE_AUTO', 'bridge up');
      r.move(g, 22, 16);
      r.move(g, 23, g === a ? 14 : 18);
    }
    r.gangUp([a, b, c], north!);
    r.gangUp([a, b, c], south!);
    // red switch: the vault opens, the fort gate shuts (the fightz may have flipped it already)
    const flipUntil = (ok: () => boolean) => {
      for (let i = 0; i < 3 && !ok(); i++) {
        r.move(b, 25, 17);
        r.move(b, 25, 16);
      }
      r.until(ok, 'red gatez');
    };
    flipUntil(() => r.tile(34, 8) === 'PYRAMID_RED_LO');
    r.move(a, 40, 8);
    r.passHazard(a, 40, 7, 40, 6);
    expect(r.grunt(a).tool).toBe('WARPSTONE');
    r.passHazard(a, 40, 7, 40, 8);
    r.move(a, 32, 9);
    flipUntil(() => r.tile(34, 23) === 'PYRAMID_RED_LO'); // vault shuts, fort gate opens
    r.move(a, 35, 23);
    r.move(a, 40, 23); // along the top, out of the spotlight's circle
    r.deliver(a, 40, 25);
  },

  'shrunk-1': r => {
    const a = r.gruntAt(3, 10);
    const b = r.gruntAt(3, 13);
    const thief = r.enemyAt(24, 10);
    r.pickup(a, 6, 8, 'GAUNTLETZ');
    r.pickup(b, 6, 16, 'SHOVEL');
    for (const g of [a, b]) {
      r.move(g, 10, 13);
      // the slime just started along the top: take the bottom row east
      r.waitSlime((x, y) => y === 7 && x <= 12, 'slime on the top row');
      r.move(g, 18, 13);
      r.move(g, 19, g === a ? 10 : 12);
    }
    r.gangUp([a, b], thief!);
    // whatever it stole lies where it fell
    for (const p of [...r.w.all('pickup')].filter(p => p.item === 'SHOVEL' || p.item === 'GAUNTLETZ')) {
      if (r.grunt(b).tool !== 'SHOVEL' && p.item === 'SHOVEL') r.pickup(b, p.x, p.y, 'SHOVEL');
    }
    r.tool(b, 32, 8);
    r.tool(b, 32, 8);
    r.pickup(b, 32, 8, 'WARPSTONE');
    r.deliver(b, 32, 19);
  },

  'shrunk-2': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 15);
    r.pickup(a, 6, 10, 'TOOB');
    r.pickup(a, 8, 13, 'SCROLL');
    r.pickup(b, 6, 17, 'TOOB');
    r.moveAll([
      [a, 26, 13],
      [b, 24, 15],
    ]);
    r.castScroll(a); // toyz for everybody over there
    r.until(() => [...r.w.all('grunt')].filter(g => g.team !== 0).every(g => g.action.kind === 'play' || g.action.kind === 'death'), 'guardz playing');
    r.cmd({ type: 'move', ids: [b], x: 19, y: 12 }); // b waits on the soap island, out of range
    r.move(a, 33, 13);
    r.pickup(a, 38, 5, 'WARPSTONE');
    r.move(a, 40, 12);
    r.move(a, 40, 19); // along the edge, around the slime's counter
    r.deliver(a, 39, 20);
  },

  'shrunk-3': r => {
    const a = r.gruntAt(3, 10);
    const b = r.gruntAt(3, 13);
    const sucker = r.enemyAt(9, 8);
    r.pickup(a, 5, 8, 'GAUNTLETZ');
    r.pickup(b, 5, 20, 'GOOBER');
    r.attack(a, sucker!); // it would slurp our goo
    // whatever goo is left in the room (the sucker may have had some, then left its own)
    while (r.w.team(0)!.ovens.every(o => o < 0)) {
      const p = [...r.w.all('puddle')].find(p => p.x < 11 && p.sucking < 0);
      if (!p) throw new Error('shrunk-3: not enough goo');
      r.suck(b, p.x, p.y);
    }
    r.bake(3, 25);
    r.warp(a, 10, 15, 16, 5);
    r.tool(a, 19, 8); // the sugar cube crumbles
    // the secret: a hidden trigger opens a red wormhole for a while
    r.warp(b, 10, 15, 16, 5);
    r.move(b, 13, 12);
    r.until(() => r.w.objectAt(21, 2, 'wormhole')?.open === true, 'secret wormhole open');
    r.warp(b, 21, 2, 38, 5);
    r.move(b, 38, 3);
    expect(r.w.team(0)!.stats.letters).toContain('R');
    r.warp(a, 20, 12, 27, 3); // the blue wormhole takes one grunt only
    r.move(a, 30, 4);
    r.passHazard(a, 30, 5, 30, 6);
    expect(r.grunt(a).tool).toBe('WARPSTONE');
    r.passHazard(a, 30, 7, 30, 8);
    r.warp(a, 32, 11, 27, 18);
    r.move(a, 36, 17);
    r.move(a, 36, 23);
    r.deliver(a, 37, 23);
  },

  'shrunk-4': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 16);
    const c = r.gruntAt(3, 20);
    const [w1, w2, layer] = [r.enemyAt(29, 12), r.enemyAt(29, 20), r.enemyAt(37, 14)];
    r.pickup(a, 5, 8, 'TOOB');
    r.pickup(b, 5, 16, 'GUNHAT');
    r.pickup(c, 5, 24, 'SWORD');
    r.move(a, 23, 4); // swim across
    r.move(a, 24, 4); // drawbridge down
    r.until(() => r.tile(16, 16) === 'BRIDGE', 'bridge up');
    r.moveAll([
      [b, 9, 16],
      [c, 8, 16],
    ]);
    r.cmd({ type: 'move', ids: [b], x: 23, y: 16 });
    r.cmd({ type: 'move', ids: [c], x: 22, y: 16 });
    r.until(() => r.grunt(b).x === 23 && r.grunt(c).x === 22 && r.grunt(c).action.kind === 'idle', 'over the bridge');
    r.attack(b, w1!); // a gunhat turns a deadly fireball into a bad burn
    r.move(b, 24, 14); // a keg of cola between the fightz
    r.attack(b, w2!);
    r.move(c, 33, 14);
    r.attack(c, layer!);
    r.pickup(a, 27, 6, 'GAUNTLETZ');
    for (const y of [15, 16]) {
      while (r.w.objectAt(34, y, 'brickz')) {
        const n = r.w.objectAt(34, y, 'brickz')!.layers.length;
        r.tool(a, 34, y, () => (r.w.objectAt(34, y, 'brickz')?.layers.length ?? 0) < n && r.grunt(a).action.kind === 'idle');
      }
    }
    r.move(a, 40, 9);
    r.move(a, 40, 8);
    r.passHazard(a, 40, 7, 40, 6);
    expect(r.grunt(a).tool).toBe('WARPSTONE');
    r.passHazard(a, 40, 7, 40, 8);
    r.deliver(a, 40, 24);
  },

  'minis-1': r => {
    const a = r.gruntAt(3, 4);
    const b = r.gruntAt(3, 7);
    const chaser = r.enemyAt(34, 20);
    r.pickup(a, 6, 3, 'CLUB');
    r.pickup(b, 6, 9, 'SHOVEL');
    for (const g of [b, a]) {
      const x = g === b ? 20 : 19;
      r.move(g, x, 7);
      r.crossBoulders(g, x, 8, 9);
      r.move(g, x, 12);
      r.crossBoulders(g, x, 13, 14);
      r.move(g, x, 17);
      r.crossBoulders(g, x, 18, 19);
    }
    r.tool(b, 24, 23);
    r.tool(b, 24, 23);
    r.pickup(b, 24, 23, 'WARPSTONE');
    r.move(a, 30, 22);
    r.attack(a, chaser!);
    r.move(b, 30, 23);
    r.move(b, 35, 16);
    r.passHazard(b, 33, 14, 35, 14); // fireworkz: go right after they pop
    r.deliver(b, 35, 13);
  },

  'minis-2': r => {
    const a = r.gruntAt(3, 12);
    const soldiers = [r.enemyAt(19, 12), r.enemyAt(19, 16), r.enemyAt(23, 10), r.enemyAt(23, 18)];
    r.pickup(a, 6, 10, 'GRAVITYBOOTZ');
    r.move(a, 10, 14); // death touch
    expect(r.grunt(a).powerup).toBe('DEATHTOUCH');
    r.move(a, 16, 14);
    for (const s of soldiers) r.attack(a, s!); // one touch each; their spongez can't budge the bootz
    r.move(a, 20, 8); // drawbridge down
    r.until(() => r.tile(26, 14) === 'BRIDGE', 'drawbridge down');
    r.move(a, 23, 14);
    r.passHazard(a, 24, 14, 25, 14);
    r.pickup(a, 30, 14, 'WARPSTONE');
    r.passHazard(a, 24, 14, 23, 14);
    r.move(a, 15, 14);
    r.move(a, 13, 25);
    r.deliver(a, 38, 24);
  },

  'minis-3': r => {
    const a = r.gruntAt(3, 12);
    r.move(a, 11, 5);
    r.move(a, 8, 13); // super speed: thirty secondz on the clock
    expect(r.grunt(a).powerup).toBe('SUPERSPEED');
    r.move(a, 12, 4); // timed switch #1
    r.move(a, 26, 12); // through the gate before it shuts
    r.pickup(a, 28, 12, 'WARPSTONE');
    r.move(a, 28, 20); // timed switch #2
    r.move(a, 34, 5);
    r.deliver(a, 36, 4);
  },

  'minis-4': r => {
    const a = r.gruntAt(3, 18);
    const b = r.gruntAt(3, 24);
    const c = r.gruntAt(3, 21);
    const [swordsman, clubber] = [r.enemyAt(32, 16), r.enemyAt(34, 26)];
    r.pickup(a, 6, 16, 'GAUNTLETZ');
    r.pickup(b, 6, 26, 'CLUB');
    r.pickup(c, 9, 23, 'WINGZ');
    r.move(c, 11, 22);
    r.move(c, 29, 23); // over the lake
    r.move(c, 29, 24); // green gate opens
    r.until(() => r.tile(12, 5) === 'PYRAMID_GREEN_LO', 'gate open');
    for (const g of [a, b]) {
      const y = g === a ? 5 : 6;
      r.move(g, 11, y);
      r.move(g, 17, y);
      for (const lane of [18, 24, 30]) {
        r.crossColumn(g, lane, y, lane + 1);
        if (lane !== 30) r.move(g, lane + 5, y);
      }
    }
    r.gangUp([a, b, c], swordsman!);
    r.gangUp([a, b, c], clubber!);
    r.move(a, 30, 12); // a keg of cola
    r.move(a, 35, 7);
    r.tool(a, 36, 6); // the giant rock guarding the vault
    r.move(a, 38, 6);
    r.passHazard(a, 39, 5, 40, 5);
    r.pickup(a, 41, 5, 'WARPSTONE');
    r.passHazard(a, 39, 5, 38, 5);
    r.move(a, 36, 10);
    r.deliver(a, 39, 23);
  },

  'space-1': r => {
    const a = r.gruntAt(3, 12);
    const b = r.gruntAt(3, 15);
    const chaser = r.enemyAt(24, 4);
    r.pickup(a, 6, 10, 'WINGZ');
    r.pickup(b, 6, 17, 'GAUNTLETZ');
    r.move(a, 14, 22);
    r.move(a, 21, 22); // over the void, onto the switch
    r.until(() => r.tile(17, 20) === 'DBRIDGE', 'bridge down');
    r.move(b, 14, 20);
    r.move(b, 21, 20);
    r.attack(b, chaser!);
    // the warpstone sits inside the UFO's patrol: dash in while it's across the crater
    r.move(b, 24, 10);
    r.waitUfo(29, 10, 5.5);
    r.pickup(b, 29, 10, 'WARPSTONE');
    r.waitUfo(29, 16, 4.5);
    r.move(b, 29, 17);
    r.move(b, 33, 20);
    r.deliver(b, 34, 22);
  },

  'space-2': r => {
    const a = r.gruntAt(4, 12);
    const b = r.gruntAt(4, 15);
    const [chaser, guard] = [r.enemyAt(19, 13), r.enemyAt(31, 17)];
    r.pickup(a, 7, 10, 'GAUNTLETZ');
    r.pickup(b, 7, 17, 'SWORD');
    r.moveAll([
      [a, 11, 13],
      [b, 11, 14],
    ]);
    r.waitUfo(19, 13, 6);
    r.gangUp([a, b], chaser!);
    r.waitUfo(25, 15, 5);
    r.moveAll([
      [a, 26, 16],
      [b, 25, 13],
    ]); // outer airlock door opens
    r.until(() => r.tile(28, 12) === 'PYRAMID_ORANGE_LO', 'outer door open');
    r.moveAll([
      [a, 30, 12],
      [b, 30, 13],
    ]);
    r.gangUp([a, b], guard!);
    r.move(a, 31, 8); // inner door opens, the outer one shuts behind us
    r.until(() => r.tile(34, 12) === 'PYRAMID_ORANGE_LO', 'inner door open');
    r.pickup(a, 38, 8, 'WARPSTONE');
    r.deliver(a, 38, 16);
  },

  'space-3': r => {
    const a = r.gruntAt(3, 11);
    const b = r.gruntAt(3, 17);
    const chaser = r.enemyAt(18, 5);
    r.pickup(a, 6, 9, 'GAUNTLETZ');
    r.pickup(b, 6, 18, 'SWORD');
    // one grunt per crumbling bridge
    r.move(a, 9, 10);
    r.move(a, 14, 10);
    r.move(b, 9, 12);
    r.move(b, 14, 12);
    r.attack(b, chaser!);
    r.tool(a, 20, 9); // the asteroid crumbles
    r.move(b, 16, 12); // bridge up
    r.until(() => r.tile(24, 8) === 'DBRIDGE', 'bridge up');
    r.move(a, 22, 8);
    r.waitUfo(30, 8, 4.5);
    r.move(a, 28, 8);
    r.waitUfo(33, 8, 4.5);
    r.pickup(a, 33, 8, 'WARPSTONE');
    r.waitUfo(31, 13, 4.5);
    r.move(a, 31, 16);
    r.move(a, 31, 20);
    r.deliver(a, 35, 23);
  },

  'space-4': r => {
    const a = r.gruntAt(3, 14);
    const b = r.gruntAt(3, 20);
    const c = r.gruntAt(3, 17);
    const bomber = r.enemyAt(34, 8);
    r.pickup(a, 6, 12, 'GAUNTLETZ');
    r.pickup(b, 6, 22, 'GOOBER');
    r.pickup(c, 8, 17, 'SWORD');
    for (const [x, y] of [
      [3, 28],
      [9, 30],
      [9, 7],
      [4, 5],
    ] as const)
      r.suck(b, x, y);
    const d = r.bake(5, 10);
    // the holderz: two across the crater field between the UFOs' rounds, one near home
    r.move(c, 12, 19);
    for (const [g, x, y] of [
      [b, 27, 30],
      [d, 27, 4],
    ] as const) {
      r.move(g, 11, y < 17 ? 11 : 23);
      r.waitUfo(16, y < 17 ? 10 : 24, 7);
      r.move(g, x, y);
    }
    r.until(() => r.tile(30, 16) === 'PYRAMID_MANY_LO', 'core gate open');
    // the lane between the two UFOs is safe from their beamz, but not from the geyserz
    r.move(a, 11, 17);
    r.passHazard(a, 13, 17, 15, 17);
    r.passHazard(a, 20, 17, 22, 17);
    r.passHazard(a, 27, 17, 29, 17);
    r.move(a, 32, 16);
    r.attack(a, bomber!);
    // the red switch: upper gate opens, lower one shuts
    const flip = (ok: () => boolean) => {
      for (let i = 0; i < 3 && !ok(); i++) {
        r.move(a, 33, 18);
        r.move(a, 33, 17);
      }
      r.until(ok, 'red gatez');
    };
    flip(() => r.tile(37, 10) === 'PYRAMID_RED_LO');
    r.move(a, 39, 10);
    r.tool(a, 41, 8); // the last asteroid
    r.pickup(a, 44, 5, 'WARPSTONE');
    r.move(a, 36, 10);
    flip(() => r.tile(37, 24) === 'PYRAMID_RED_LO');
    r.move(a, 38, 24);
    r.deliver(a, 41, 25);
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
    r.pickup(a, 6, 5, 'YOYO');
    r.pickup(b, 6, 15, 'SQUEAKTOY');
    r.moveAll([
      [a, 13, 9],
      [b, 13, 10],
    ]);
    r.giveToy(b, g2!);
    r.giveToy(a, g1!);
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
