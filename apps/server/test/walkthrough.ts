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

  /** Standing still with nothing left to do. */
  settled(id: EntityId): boolean {
    const g = this.grunt(id);
    return isIdle(g) && g.orders.length === 0 && !g.task;
  }

  move(id: EntityId, x: number, y: number): void {
    this.cmd({ type: 'move', ids: [id], x, y });
    let lastOrder = this.w.tick;
    this.until(() => {
      const g = this.grunt(id);
      if (g.x === x && g.y === y && this.settled(id)) return true;
      // A toy (or a fight) made the grunt forget where it was going: click again.
      if (this.settled(id) && this.w.tick - lastOrder > 40) {
        this.session.submit(0, { type: 'move', ids: [id], x, y });
        lastOrder = this.w.tick;
      }
      return false;
    }, `#${id} to reach ${x},${y}`);
  }

  /** Walk with safe pathfinding (around holez and abysses, like the QoL setting). */
  moveSafe(id: EntityId, x: number, y: number): void {
    this.cmd({ type: 'move', ids: [id], x, y, safe: true });
    this.until(() => {
      const g = this.grunt(id);
      return g.x === x && g.y === y && this.settled(id);
    }, `#${id} to reach ${x},${y} safely`);
  }

  /** Walk several gruntz to their own tiles at once. */
  moveAll(moves: [EntityId, number, number][]): void {
    for (const [id, x, y] of moves) this.cmd({ type: 'move', ids: [id], x, y });
    let lastOrder = this.w.tick;
    this.until(() => {
      const there = ([id, x, y]: [EntityId, number, number]) =>
        this.grunt(id).x === x && this.grunt(id).y === y && this.settled(id);
      if (moves.every(there)) return true;
      // Anyone who forgot the order (a fight, a toy) gets clicked again.
      if (this.w.tick - lastOrder > 40) {
        for (const m of moves) {
          const [id, x, y] = m;
          if (!there(m) && this.settled(id)) this.session.submit(0, { type: 'move', ids: [id], x, y });
        }
        lastOrder = this.w.tick;
      }
      return false;
    }, 'group move');
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

  /** Break a stack of brickz layer by layer (gauntletz, one layer per blow). */
  breakBrickz(id: EntityId, x: number, y: number): void {
    for (let blows = 0; this.tile(x, y) === 'BRICKZ'; blows++) {
      if (blows > 6) throw new Error(`${this.level.id}: brickz at ${x},${y} won't break`);
      const layers = this.w.objectAt(x, y, 'brickz')?.layers.length ?? 0;
      this.cmd({ type: 'useTool', ids: [id], x, y });
      this.until(
        () => (this.w.objectAt(x, y, 'brickz')?.layers.length ?? 0) < layers && this.settled(id),
        `#${id} to break a layer of brickz at ${x},${y}`,
      );
    }
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
    let lastOrder = this.w.tick;
    this.until(() => {
      const e = this.w.get(target, 'grunt');
      if (e?.action.kind === 'play') return true;
      // A blow interrupts the throw: hand it over again, like a player would.
      if (e && this.grunt(id).toy && this.settled(id) && this.w.tick - lastOrder > 20) {
        this.session.submit(0, { type: 'useToy', ids: [id], x: e.x, y: e.y, target });
        lastOrder = this.w.tick;
      }
      return false;
    }, `#${target} to play with a toy`);
  }

  /**
   * Stand still with toyz until every listed enemy is playing: whoever of ours has a toy
   * throws it at an enemy the moment one steps next to him.
   */
  toyWhenClose(ids: EntityId[], enemies: EntityId[]): void {
    const last = new Map<EntityId, number>();
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
    this.until(
      () => {
        const busy = (e: EntityId) => {
          const g = this.w.get(e, 'grunt');
          return !g || g.action.kind === 'play' || g.action.kind === 'death';
        };
        for (const id of ids) {
          const g = this.w.get(id, 'grunt');
          if (!g?.toy || this.w.tick - (last.get(id) ?? -99) < 10) continue;
          const target = enemies.find(e => !busy(e) && near(g, this.grunt(e)));
          if (target === undefined) continue;
          const t = this.grunt(target);
          this.session.submit(0, { type: 'useToy', ids: [id], x: t.x, y: t.y, target });
          last.set(id, this.w.tick);
        }
        return enemies.every(busy);
      },
      `#${enemies.join(', #')} to play with toyz`,
    );
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
    const dodging = new Map<EntityId, EntityId>(); // grunt -> the timebomb it is getting away from
    this.until(
      () => {
        if (!this.w.get(target, 'grunt')) return true;
        const enemy = this.grunt(target);
        if (enemy.action.kind === 'death') return false;
        // A timebomb set next to one of ours: step well away from it, like a player would.
        const bombs = [...this.w.all('timebomb')];
        const near = (p: { x: number; y: number }, d: number) =>
          bombs.some(b => Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)) <= d);
        for (const [id, bomb] of dodging) if (!this.w.get(bomb, 'timebomb')) dodging.delete(id);
        for (const id of ids) {
          const g = this.w.get(id, 'grunt');
          if (!g || dodging.has(id) || !near(g, 1)) continue;
          const bomb = bombs.find(b => Math.max(Math.abs(b.x - g.x), Math.abs(b.y - g.y)) <= 1)!;
          const spots: [number, number][] = [];
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++) {
              const x = g.x + dx;
              const y = g.y + dy;
              if (!this.w.inBounds(x, y) || near({ x, y }, 1) || this.w.gruntAt(x, y)) continue;
              if (
                this.w.level(x, y) !== this.w.level(g.x, g.y) ||
                /DEATH|HOLE|WATER|CLIFF|NOGO|BRICK|ROCK/.test(this.tile(x, y))
              )
                continue;
              spots.push([x, y]);
            }
          spots.sort((p, q) => Math.hypot(p[0] - g.x, p[1] - g.y) - Math.hypot(q[0] - g.x, q[1] - g.y));
          const spot = spots[0];
          if (!spot) continue;
          this.session.submit(0, { type: 'move', ids: [id], x: spot[0], y: spot[1] });
          dodging.set(id, bomb.id);
        }
        // A toy or a knockback makes a grunt forget the order: click again, like a player.
        const idle = ids.filter(id => this.w.get(id, 'grunt') && this.settled(id) && !dodging.has(id));
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

  /** Stand still until an enemy comes within `range`, then throw at it (bomberz: while far). */
  snipe(id: EntityId, target: EntityId, range = 4): void {
    this.until(() => {
      const e = this.w.get(target, 'grunt');
      const g = this.grunt(id);
      return !e || Math.max(Math.abs(e.x - g.x), Math.abs(e.y - g.y)) <= range;
    }, `#${target} to come within ${range}`);
    this.attack(id, target);
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
