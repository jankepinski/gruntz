import { pathPosition } from '@gruntz/core';
import type { Walkthrough } from '../walkthrough.ts';

/** Wait until every storm cloud is at least `dist` tiles from a point. */
export function cloudsAway(r: Walkthrough, x: number, y: number, dist: number, label: string): void {
  r.until(
    () =>
      [...r.w.all('cloud')].every(c => {
        const p = pathPosition(c, r.w.tick);
        return Math.hypot(p.x - x, p.y - y) > dist;
      }),
    label,
  );
}

/** Walk one grunt over a toggle bridge right after it comes up. */
export function overToggle(r: Walkthrough, g: number, tiles: [number, number][], to: [number, number]): void {
  const up = () => tiles.every(([x, y]) => r.tile(x, y).endsWith('_AUTO'));
  r.until(() => !up(), 'toggle bridge down');
  r.until(up, 'toggle bridge up');
  r.move(g, ...to);
}

/**
 * Walk up a column through rows of static hazards (geyserz, candles...): before each row, wait
 * for it to go off and calm down, then cross it.
 */
export function throughHazards(r: Walkthrough, g: number, x: number, rows: number[], dir: 1 | -1): void {
  for (const y of rows) {
    r.move(g, x, y - dir);
    r.passHazard(g, x, y, x, y + dir);
  }
}

/** Step onto an arrow and let the arrowz carry the grunt until it comes to rest at `end`. */
export function rideArrows(r: Walkthrough, g: number, onto: [number, number], end: [number, number]): void {
  r.cmd({ type: 'move', ids: [g], x: onto[0], y: onto[1] });
  r.until(() => {
    const e = r.grunt(g);
    return e.x === end[0] && e.y === end[1] && e.action.kind === 'idle' && !e.task;
  }, `#${g} to ride the arrowz to ${end[0]},${end[1]}`);
}

/**
 * Cross a lane of rolling ballz (a row the ballz roll along, west or east): wait on one side
 * until no ball is coming within a few tilez, then walk straight over to the other side.
 */
export function crossBallLane(r: Walkthrough, g: number, x: number, laneY: number, fromY: number, toY: number): void {
  r.move(g, x, fromY);
  r.until(
    () =>
      [...r.w.all('ball')].every(ball => {
        if (ball.state !== 'roll' || ball.y !== laneY) return true;
        const ahead = ball.dir === 6 ? ball.x - x : x - ball.x; // tilez before it reaches x
        return ahead < -1 || ahead > 7;
      }),
    'a gap in the ballz',
  );
  r.move(g, x, toY);
}
