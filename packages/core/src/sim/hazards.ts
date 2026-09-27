import { T } from '../data/tiles.ts';
import { DIRS, type Dir } from '../point.ts';
import { isGone, kill } from './grunt.ts';
import type { RollingBall } from './types.ts';
import { registerTask, type World } from './world.ts';

const BREAK_TICKS = 10;

/** Rolling balls / 8-ballz: roll straight, squash every grunt they touch. */
export function spawnRollingBall(w: World, x: number, y: number, dir: Dir, rate: number, lifetime = 0, every = 0): RollingBall | undefined {
  if (!w.inBounds(x, y) || w.has(x, y, T.SOLID | T.NOGO)) {
    // A launcher keeps trying while its exit is blocked.
    if (every > 0) w.schedule(every, 'launchBall', 0, undefined, x, y, dir, rate, every);
    return undefined;
  }
  const launcher = every > 0 ? { every, originX: x, originY: y } : {};
  const ball = w.spawn<RollingBall>({
    ...launcher,
    kind: 'ball',
    x,
    y,
    dir,
    rate,
    fromX: x,
    fromY: y,
    start: w.tick,
    expires: lifetime > 0 ? w.tick + lifetime : 0,
    state: 'roll',
  });
  squashAt(w, ball);
  w.schedule(rate, 'ballStep', ball.id, 'roll');
  w.schedule(1, 'ballSquash', ball.id, 'squash');
  return ball;
}

function squashAt(w: World, ball: RollingBall): void {
  const g = w.gruntAt(ball.x, ball.y);
  if (g && !isGone(g)) kill(w, g, 'SQUASH');
}

registerTask('ballStep', (w, id) => {
  const ball = w.get(id, 'ball');
  if (!ball || ball.state !== 'roll') return;
  if (ball.expires > 0 && w.tick >= ball.expires) {
    breakBall(w, ball);
    return;
  }
  const d = DIRS[ball.dir]!;
  const nx = ball.x + d.x;
  const ny = ball.y + d.y;
  if (!w.inBounds(nx, ny) || w.has(nx, ny, T.SOLID | T.NOGO)) {
    breakBall(w, ball);
    return;
  }
  w.edit(ball, { fromX: ball.x, fromY: ball.y, x: nx, y: ny, start: w.tick });
  squashAt(w, ball);
  if (w.has(nx, ny, T.DEATH | T.HOLE | T.WATER)) {
    w.edit(ball, { state: 'fall' });
    w.schedule(BREAK_TICKS, 'ballGone', ball.id, 'roll');
    return;
  }
  w.schedule(ball.rate, 'ballStep', ball.id, 'roll');
});

registerTask('ballSquash', (w, id) => {
  const ball = w.get(id, 'ball');
  if (!ball || ball.state !== 'roll') return;
  squashAt(w, ball);
  w.schedule(2, 'ballSquash', ball.id, 'squash');
});

function breakBall(w: World, ball: RollingBall): void {
  w.edit(ball, { state: 'break', start: w.tick });
  w.fx('ballBreak', ball, ball.id);
  w.onBallBroken(ball);
  w.schedule(BREAK_TICKS, 'ballGone', ball.id, 'roll');
}

registerTask('ballGone', (w, id) => {
  const ball = w.get(id, 'ball');
  if (!ball) return;
  w.destroy(ball);
  if (ball.every && ball.every > 0) {
    w.schedule(ball.every, 'launchBall', 0, undefined, ball.originX ?? ball.x, ball.originY ?? ball.y, ball.dir, ball.rate, ball.every);
  }
});

/** Boulder launchers: the next ball rolls out of the same spot. */
registerTask('launchBall', (w, _id, x: number, y: number, dir: Dir, rate: number, every: number) => {
  spawnRollingBall(w, x, y, dir, rate, 0, every);
});
