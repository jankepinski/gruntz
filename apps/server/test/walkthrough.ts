import {
  GameSession,
  isIdle,
  msToTicks,
  pathPosition,
  spotPosition,
  tileDef,
  type Command,
  type EntityId,
  type Grunt,
  type LevelData,
  type World,
} from '@gruntz/core';

/**
 * Scripted play-through of a quest level, used to prove every shipped level can be won.
 * Each step issues a command and then waits for a condition, so scripts don't depend on
 * exact tick counts.
 */
export class Walkthrough {
  readonly session: GameSession;
  private log: string[] = [];

  constructor(
    readonly level: LevelData,
    seed = 1,
  ) {
    this.session = new GameSession(level, [{ team: 0, name: 'P', alliance: 0 }], seed);
  }

  get w(): World {
    return this.session.world;
  }

  /** Our grunt that started on (or is now standing on) a tile. */
  gruntAt(x: number, y: number): EntityId {
    const g = [...this.w.all('grunt')].find(g => g.team === 0 && g.x === x && g.y === y);
    if (!g) throw new Error(`${this.level.id}: no player grunt at ${x},${y}`);
    return g.id;
  }

  /** Enemy grunt that started on a tile. */
  enemyAt(x: number, y: number): EntityId {
    const g = [...this.w.all('grunt')].find(g => g.team !== 0 && g.x === x && g.y === y);
    if (!g) throw new Error(`${this.level.id}: no enemy at ${x},${y}`);
    return g.id;
  }

  grunt(id: EntityId): Grunt {
    const g = this.w.get(id, 'grunt');
    if (!g) throw new Error(`${this.level.id}: grunt ${id} is gone\n${this.log.slice(-8).join('\n')}`);
    return g;
  }

  tile(x: number, y: number): string {
    return tileDef(this.w.tileAt(x, y)).name;
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      const r = this.session.step();
      for (const fx of r.changes.fx) {
        if (fx.type !== 'death') continue;
        const g = fx.id !== undefined ? this.w.get(fx.id, 'grunt') : undefined;
        if (g && g.team === 0) this.log.push(`${r.tick}: #${fx.id} died (${fx.data}) at ${fx.x},${fx.y}`);
      }
      for (const res of r.results) {
        if (!res.reason) continue;
        const who = [...this.w.all('grunt')]
          .map(g => `#${g.id}@${g.x},${g.y} team=${g.team} ai=${g.ai} ${g.action.kind}`)
          .join('; ');
        const deaths = this.log.filter(l => l.includes('died'));
        throw new Error(
          `${this.level.id}: command rejected (${res.reason})\n${this.log.slice(-6).join('\n')}\n${who}\n${deaths.join('\n')}`,
        );
      }
    }
  }

  cmd(c: Command): void {
    const ours = [...this.w.all('grunt')].filter(g => g.team === 0).map(g => `#${g.id}@${g.x},${g.y}:${g.health}`);
    this.log.push(`${this.w.tick}: ${JSON.stringify(c)}   [${ours.join(' ')}]`);
    this.session.submit(0, c, 0);
    this.step();
  }

  until(pred: () => boolean, label: string, maxMs = 60_000): void {
    const max = msToTicks(maxMs);
    for (let i = 0; i < max; i++) {
      if (pred()) return;
      if (this.session.end && this.session.end.winner !== 0)
        throw new Error(`${this.level.id}: lost while waiting for ${label}\n${this.log.slice(-6).join('\n')}`);
      this.step();
    }
    const ours = [...this.w.all('grunt')].map(
      g =>
        `#${g.id}@${g.x},${g.y} team=${g.team} ${g.action.kind} tool=${g.tool} hp=${g.health} task=${JSON.stringify(g.task)} orders=${g.orders.length}`,
    );
    throw new Error(
      `${this.level.id}: timed out waiting for ${label}\n${ours.join('\n')}\n${this.log.slice(-6).join('\n')}`,
    );
  }

  wait(ms: number): void {
    this.step(msToTicks(ms));
  }

  private settled(id: EntityId): boolean {
    const g = this.grunt(id);
    return isIdle(g) && g.orders.length === 0 && !g.task;
  }

  move(id: EntityId, x: number, y: number): void {
    this.cmd({ type: 'move', ids: [id], x, y });
    this.until(() => {
      const g = this.grunt(id);
      return g.x === x && g.y === y && this.settled(id);
    }, `#${id} to reach ${x},${y}`);
  }

  /** Walk several gruntz to their own tiles at once. */
  moveAll(moves: [EntityId, number, number][]): void {
    for (const [id, x, y] of moves) this.cmd({ type: 'move', ids: [id], x, y });
    this.until(
      () => moves.every(([id, x, y]) => this.grunt(id).x === x && this.grunt(id).y === y && this.settled(id)),
      'group move',
    );
  }

  /** Use the grunt's tool on a tile and wait until the tile changes. */
  tool(id: EntityId, x: number, y: number, done?: () => boolean): void {
    const before = this.w.tileAt(x, y);
    this.cmd({ type: 'useTool', ids: [id], x, y });
    this.until(
      done ?? (() => this.w.tileAt(x, y) !== before && this.settled(id)),
      `#${id} to use ${this.grunt(id).tool} on ${x},${y}`,
    );
  }

  /** Suck up a goo puddle with the goober straw. */
  suck(id: EntityId, x: number, y: number): void {
    this.cmd({ type: 'useTool', ids: [id], x, y });
    this.until(() => !this.w.objectAt(x, y, 'puddle') && this.settled(id), `#${id} to suck the puddle at ${x},${y}`);
  }

  /** Wait for a baked grunt and drop it on our pad at x,y. Returns the new grunt. */
  bake(x: number, y: number): EntityId {
    const pad = this.w.objectAt(x, y, 'pad');
    if (!pad) throw new Error(`${this.level.id}: no pad at ${x},${y}`);
    const team = () => this.w.team(0)!;
    this.until(() => team().ovens.some(t => t >= 0 && t <= this.w.tick), 'a grunt to bake');
    const oven = team().ovens.findIndex(t => t >= 0 && t <= this.w.tick);
    this.cmd({ type: 'drop', oven, pad: pad.id });
    this.until(() => !!this.w.gruntAt(x, y) && this.settled(this.w.gruntAt(x, y)!.id), 'the new grunt to land');
    return this.w.gruntAt(x, y)!.id;
  }

  /** Hand our toy to an enemy so it plays instead of fighting. */
  giveToy(id: EntityId, target: EntityId): void {
    const t = this.grunt(target);
    this.cmd({ type: 'useToy', ids: [id], x: t.x, y: t.y, target });
    this.until(() => this.w.get(target, 'grunt')?.action.kind === 'play', `#${target} to play with a toy`);
  }

  /** Read the scroll this grunt carries (use the toy on itself). */
  castScroll(id: EntityId): void {
    const g = this.grunt(id);
    this.cmd({ type: 'useToy', ids: [id], x: g.x, y: g.y, target: id });
    this.until(() => !this.grunt(id).toy && this.grunt(id).action.kind === 'idle', `#${id} to read the scroll`);
  }

  /** Several of our gruntz gang up on one enemy (re-clicking when they lose interest). */
  gangUp(ids: EntityId[], target: EntityId): void {
    this.fight(ids, target);
  }

  private fight(ids: EntityId[], target: EntityId): void {
    // The world may have done the job already (hazards kill enemies too).
    if (!this.w.get(target, 'grunt') || this.grunt(target).action.kind === 'death') return;
    this.cmd({ type: 'attack', ids, target });
    let lastOrder = this.w.tick;
    this.until(
      () => {
        if (!this.w.get(target, 'grunt')) return true;
        const enemy = this.grunt(target);
        if (enemy.action.kind === 'death') return false;
        // A toy or a knockback makes a grunt forget the order: click again, like a player.
        const idle = ids.filter(id => this.w.get(id, 'grunt') && this.settled(id));
        if (idle.length && this.w.tick - lastOrder > 40) {
          this.session.submit(0, { type: 'attack', ids: idle, target });
          lastOrder = this.w.tick;
        }
        return false;
      },
      `#${target} to be defeated`,
      180_000,
    );
  }

  attack(id: EntityId, target: EntityId): void {
    this.fight([id], target);
  }

  pickup(id: EntityId, x: number, y: number, item: string): void {
    this.move(id, x, y);
    const g = this.grunt(id);
    if (g.tool !== item && g.toy !== item && g.powerup !== item)
      throw new Error(`${this.level.id}: #${id} did not pick up ${item} at ${x},${y}`);
  }

  /** Wait for a rolling boulder in row y to pass column x, then walk across to (x, toY). */
  crossBoulders(id: EntityId, x: number, y: number, toY: number): void {
    this.until(
      () => [...this.w.all('ball')].some(b => b.y === y && b.state === 'roll' && b.x < x - 1),
      `a boulder to pass ${x},${y}`,
    );
    this.move(id, x, toY);
  }

  /** Wait until a storm cloud / UFO satisfies a condition (position and leg index). */
  waitMover(kind: 'cloud' | 'ufo', pred: (p: { x: number; y: number }, leg: number) => boolean, label: string): void {
    this.until(() => [...this.w.all(kind)].every(c => pred(pathPosition(c, this.w.tick), c.index)), label);
  }

  /** Wait for the static hazard on (hx, hy) to finish blowing, then walk on. */
  passHazard(id: EntityId, hx: number, hy: number, toX: number, toY: number): void {
    const h = () => [...this.w.all('hazard')].find(e => e.x === hx && e.y === hy);
    if (!h()) throw new Error(`${this.level.id}: no hazard at ${hx},${hy}`);
    this.until(() => h()!.active, `hazard at ${hx},${hy} to blow`);
    this.until(() => !h()!.active, `hazard at ${hx},${hy} to calm down`);
    this.move(id, toX, toY);
  }

  /** Wait for an 8-ball rolling down column x to pass row y, then cross to (toX, y). */
  crossColumn(id: EntityId, x: number, y: number, toX: number): void {
    // passed = beyond the crossing in its own direction of travel
    const passed = (b: { x: number; y: number; dir: number; state: string }) =>
      b.x === x && b.state === 'roll' && (b.dir === 4 ? b.y > y + 1 : b.y < y - 1);
    this.until(() => [...this.w.all('ball')].some(passed), `a ball to pass ${x},${y}`);
    this.move(id, toX, y);
  }

  /** Wait until the spotlight is far from a point. */
  waitSpot(x: number, y: number, dist: number): void {
    this.until(
      () =>
        [...this.w.all('spotlight')].every(s => {
          const p = spotPosition(s, this.w.tick);
          return Math.hypot(p.x - x, p.y - y) > dist;
        }),
      `the spotlight away from ${x},${y}`,
    );
  }

  /** Wait until every slime satisfies a condition on its tile. */
  waitSlime(pred: (x: number, y: number) => boolean, label: string): void {
    this.until(() => [...this.w.all('slime')].every(s => pred(s.x, s.y)), label);
  }

  /** Step into a wormhole and wait to come out at (tx, ty). */
  warp(id: EntityId, x: number, y: number, tx: number, ty: number): void {
    this.cmd({ type: 'move', ids: [id], x, y });
    this.until(() => {
      const g = this.grunt(id);
      return g.x === tx && g.y === ty && this.settled(id);
    }, `#${id} to warp to ${tx},${ty}`);
  }

  /** Wait until every UFO beam is far from a point. */
  waitUfo(x: number, y: number, dist: number): void {
    this.until(
      () =>
        [...this.w.all('ufo')].every(u => {
          const c = pathPosition(u, this.w.tick);
          return Math.hypot(c.x - x, c.y - y) > dist;
        }),
      `the UFO away from ${x},${y}`,
    );
  }

  /** Carry the warpstone to a fort tile and win. */
  deliver(id: EntityId, x: number, y: number): void {
    this.cmd({ type: 'move', ids: [id], x, y });
    this.won();
  }

  won(): void {
    this.until(() => this.session.end?.winner === 0, 'the level to be won');
  }
}
