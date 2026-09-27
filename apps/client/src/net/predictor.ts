import { moveTicks, predictPath, TICK_MS, type Command, type EntityId, type Grunt, type Point, type World } from '@gruntz/core';

interface Prediction {
  path: Point[];
  /** Local time (ms) the predicted walk starts. */
  startAt: number;
  msPerTile: number;
  /** Server tick estimate when the command was sent; later moves confirm it. */
  sentTick: number;
  from: Point;
  expiresAt: number;
}

/**
 * Client-side prediction for our own gruntz. When we order a move, the grunt starts
 * walking immediately along the path the server will (almost certainly) compute with
 * the same deterministic code. Once the server's move shows up in the replica the
 * prediction is dropped and the renderer smooths the (small) difference away.
 */
export class Predictor {
  private predictions = new Map<EntityId, Prediction>();

  onCommand(world: World, team: number, cmd: Command, serverTick: number, rttMs: number, safe: boolean): void {
    if (cmd.type === 'stop') {
      for (const id of cmd.ids) this.predictions.delete(id);
      return;
    }
    if (cmd.type !== 'move' && cmd.type !== 'attack' && cmd.type !== 'useTool') return;
    if ('queue' in cmd && cmd.queue) return;
    const now = performance.now();
    for (const id of cmd.ids) {
      const g = world.get(id, 'grunt');
      if (!g || g.team !== team || g.ai) continue;
      // Only predict from a standing start (mid-step and busy gruntz resolve on the server).
      if (g.action.kind !== 'idle' && g.action.kind !== 'attackIdle') continue;
      let target: Point;
      if (cmd.type === 'attack') {
        const enemy = world.get(cmd.target, 'grunt');
        if (!enemy) continue;
        target = { x: enemy.x, y: enemy.y };
      } else {
        target = { x: cmd.x, y: cmd.y };
      }
      let path = predictPath(world, g, target, cmd.type === 'move' ? (cmd.safe ?? safe) : false, 64);
      // Tool use / attacks stop next to the target.
      if (cmd.type !== 'move' && path.length > 0) path = path.slice(0, -1);
      if (path.length === 0) continue;
      const msPerTile = moveTicks(g) * TICK_MS;
      this.predictions.set(id, {
        path,
        startAt: now,
        msPerTile,
        sentTick: serverTick,
        from: { x: g.x, y: g.y },
        expiresAt: now + rttMs * 2 + 600,
      });
    }
  }

  /** Predicted tile-space position of a grunt right now, or null if not predicting. */
  position(g: Grunt, renderTick: number): { x: number; y: number } | null {
    const p = this.predictions.get(g.id);
    if (!p) return null;
    const now = performance.now();
    // Confirmed: the server started moving (or doing something else) after our command.
    const confirmed = g.action.start >= p.sentTick - 1 && g.action.kind !== 'idle' && renderTick >= g.action.start;
    if (confirmed || now > p.expiresAt || g.action.kind === 'death') {
      this.predictions.delete(g.id);
      return null;
    }
    const t = (now - p.startAt) / p.msPerTile;
    const i = Math.floor(t);
    const f = t - i;
    const prev = i === 0 ? p.from : p.path[Math.min(i - 1, p.path.length - 1)]!;
    if (i >= p.path.length) return { x: prev.x, y: prev.y };
    const next = p.path[i]!;
    return { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f };
  }

  clear(): void {
    this.predictions.clear();
  }
}
