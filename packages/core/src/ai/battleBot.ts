import { itemType, TOOL_INFO, toolValue, type CombatTool, type ItemId } from '../data/items.ts';
import { T } from '../data/tiles.ts';
import { msToTicks } from '../constants.ts';
import { chebyshev, type Point } from '../point.ts';
import type { BotLevel } from '../net/protocol.ts';
import type { Bot } from '../session/session.ts';
import type { Command } from '../sim/commands.ts';
import { combatTool, isGone, isIdle } from '../sim/grunt.ts';
import { Flood, floodOptions } from '../sim/path.ts';
import type { Fort, Grunt, Pickup } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

interface Tuning {
  /** Ticks between decisions (reaction time). */
  think: number;
  /** How many gruntz stay home to defend. */
  defenders: number;
  /** Attack when we have at least this many armed gruntz. */
  attackAt: number;
  /** Chance to use toys on dangerous enemies. */
  toyChance: number;
  /** Build up (gather goo, toolz, gruntz) this long before the first raid. */
  buildUpMs: number;
}

const TUNING: Record<BotLevel, Tuning> = {
  easy: { think: 40, defenders: 1, attackAt: 5, toyChance: 0.2, buildUpMs: 240_000 },
  normal: { think: 20, defenders: 2, attackAt: 4, toyChance: 0.6, buildUpMs: 150_000 },
  hard: { think: 8, defenders: 2, attackAt: 4, toyChance: 1, buildUpMs: 90_000 },
};

/**
 * Battlez computer player. It plays by the same rules as a human: it only sends
 * commands, with a reaction delay that depends on the difficulty.
 */
export class BattleBot implements Bot {
  private readonly tuning: Tuning;
  private nextThink = 0;
  private lastOrder = new Map<number, number>();

  constructor(
    readonly team: number,
    level: BotLevel,
    _world: World,
  ) {
    this.tuning = TUNING[level];
    this.nextThink = this.team * 3;
  }

  update(w: World): Command[] {
    if (w.tick < this.nextThink) return [];
    this.nextThink = w.tick + this.tuning.think;
    const team = w.team(this.team);
    if (!team || team.lost || team.won) return [];
    const out: Command[] = [];
    const mine = [...w.all('grunt')].filter(g => g.team === this.team && !isGone(g));
    const enemies = [...w.all('grunt')].filter(
      g => w.alliance(g.team) !== w.alliance(this.team) && !isGone(g) && g.powerup !== 'GHOST',
    );
    const myFort = [...w.all('fort')].find(f => f.team === this.team);
    const enemyForts = [...w.all('fort')].filter(f => !f.captured && w.alliance(f.team) !== w.alliance(this.team));

    // 1. Bake: drop ready gruntz onto free pads.
    const pads = [...w.all('pad')].filter(p => p.team === this.team && !w.gruntAt(p.x, p.y));
    team.ovens.forEach((bakedAt, oven) => {
      if (bakedAt >= 0 && w.tick >= bakedAt && pads.length > 0) out.push({ type: 'drop', oven, pad: pads.shift()!.id });
    });

    // 2. Hand out grunt machine items.
    team.slots.forEach((item, slot) => {
      if (item == null) return;
      const target = this.pickReceiver(w, mine, item);
      if (target) out.push({ type: 'give', slot, id: target.id });
    });

    // 3. Orders for gruntz that are free.
    const armed = mine.filter(g => g.tool && g.tool !== 'GOOBER' && TOOL_INFO[combatTool(g)].damage >= 4);
    // Raid only after building up, with enough armed gruntz to also leave defenders home.
    const builtUp = w.tick >= msToTicks(this.tuning.buildUpMs) || armed.length >= this.tuning.attackAt + 3;
    const attacking = builtUp && armed.length >= this.tuning.attackAt + (myFort ? this.tuning.defenders : 0);
    let defenders = 0;
    for (const g of mine) {
      if (g.action.kind === 'play' || g.frozen) continue;
      const busy = !isIdle(g) || g.task !== null || g.orders.length > 0;
      const threat = this.nearestEnemy(g, enemies, 3);
      // Dangerous enemy right here: toy it or fight it.
      if (threat && isIdle(g)) {
        if (g.toy && toolValue(combatTool(threat)) > toolValue(combatTool(g)) && w.random() < this.tuning.toyChance) {
          out.push({ type: 'useToy', ids: [g.id], x: threat.x, y: threat.y, target: threat.id });
          continue;
        }
        out.push({ type: 'attack', ids: [g.id], target: threat.id });
        continue;
      }
      if (busy && w.tick - (this.lastOrder.get(g.id) ?? -999) < 120) continue;

      if (g.tool === 'GOOBER') {
        const puddle = this.nearest(
          g,
          [...w.all('puddle')].filter(p => p.sucking < 0),
          20,
        );
        if (puddle) {
          this.order(w, out, g, { type: 'useTool', ids: [g.id], x: puddle.x, y: puddle.y });
          continue;
        }
      }
      if (!g.tool || g.tool === 'GOOBER') {
        const pickup = this.bestToolPickup(w, g);
        if (pickup) {
          this.order(w, out, g, { type: 'move', ids: [g.id], x: pickup.x, y: pickup.y, safe: true });
          continue;
        }
      }
      if (myFort && defenders < this.tuning.defenders) {
        defenders++;
        const intruder = this.nearest(myFort, enemies, 6);
        if (intruder) this.order(w, out, g, { type: 'attack', ids: [g.id], target: intruder.id });
        else if (chebyshev(g, myFort) > 3) this.moveNear(w, out, g, myFort);
        continue;
      }
      if (attacking || !myFort) {
        const enemy = this.nearestEnemy(g, enemies, 10);
        if (enemy && g.tool) {
          this.order(w, out, g, { type: 'attack', ids: [g.id], target: enemy.id });
          continue;
        }
        const fort = this.nearest(g, enemyForts, 999);
        if (fort) {
          this.moveNear(w, out, g, fort);
          continue;
        }
      }
    }
    return out;
  }

  private order(w: World, out: Command[], g: Grunt, cmd: Command): void {
    this.lastOrder.set(g.id, w.tick);
    out.push(cmd);
  }

  /** Walk onto the ring around a fort (entering an enemy's fort ring captures it). */
  private moveNear(w: World, out: Command[], g: Grunt, fort: Fort): void {
    let best: Point | undefined;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const p = { x: fort.x + dx, y: fort.y + dy };
        if (w.has(p.x, p.y, T.SOLID | T.NOGO | T.WATER | T.DEATH | T.HOLE)) continue;
        const d = chebyshev(g, p);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
    if (!best) return;
    const flood = new Flood(w, best, g.team, floodOptions(w, g, true), g);
    if (!flood.reaches(g)) {
      // Blocked: break through with gauntletz if we can.
      if (g.tool === 'GAUNTLETZ' || g.tool === 'TIMEBOMB') {
        const wall = this.nearestBreakable(w, g);
        if (wall) {
          this.order(w, out, g, { type: 'useTool', ids: [g.id], x: wall.x, y: wall.y });
          return;
        }
      }
      return;
    }
    this.order(w, out, g, { type: 'move', ids: [g.id], x: best.x, y: best.y, safe: true });
  }

  private nearestBreakable(w: World, g: Grunt): Point | undefined {
    let best: Point | undefined;
    let bestD = Infinity;
    for (let y = Math.max(0, g.y - 8); y <= Math.min(w.height - 1, g.y + 8); y++)
      for (let x = Math.max(0, g.x - 8); x <= Math.min(w.width - 1, g.x + 8); x++) {
        if (!w.has(x, y, T.BREAK)) continue;
        const d = chebyshev(g, { x, y });
        if (d < bestD) {
          best = { x, y };
          bestD = d;
        }
      }
    return best;
  }

  private bestToolPickup(w: World, g: Grunt): Pickup | undefined {
    let best: Pickup | undefined;
    let bestScore = -Infinity;
    for (const p of w.all('pickup')) {
      if (p.hidden || (p.availableAt !== undefined && w.tick < p.availableAt)) continue;
      if (p.item === 'TOYBOX' || itemType(p.item) !== 'tool' || p.item === 'WARPSTONE') continue;
      const d = chebyshev(g, p);
      if (d > 25) continue;
      const score = toolValue(p.item as CombatTool) * 10 - d;
      if (score > bestScore) {
        const flood = new Flood(w, p, g.team, floodOptions(w, g, true), g);
        if (!flood.reaches(g)) continue;
        best = p;
        bestScore = score;
      }
    }
    return best;
  }

  private pickReceiver(w: World, mine: Grunt[], item: ItemId | string): Grunt | undefined {
    if (item === 'brown' || item === 'gold' || item === 'red' || item === 'blue' || item === 'black') {
      return mine.find(g => g.tool === 'BRICK' && !g.brickColor);
    }
    const type = itemType(item as ItemId);
    if (type === 'tool') {
      const value = toolValue(item as CombatTool);
      const candidates = mine
        .filter(g => g.tool !== 'WARPSTONE' && g.action.kind !== 'play' && !isGone(g))
        .filter(g => !g.tool || toolValue(combatTool(g)) < value * 0.8)
        .sort((a, b) => toolValue(combatTool(a)) - toolValue(combatTool(b)));
      // Keep one goober straw around to collect goo.
      if (item === 'GOOBER' && mine.some(g => g.tool === 'GOOBER')) return undefined;
      return candidates[0];
    }
    if (type === 'toy') return mine.find(g => !g.toy && !isGone(g));
    if (type === 'powerup') return mine.find(g => !g.powerup && g.tool && !isGone(g));
    void w;
    return undefined;
  }

  private nearestEnemy(g: Grunt, enemies: Grunt[], range: number): Grunt | undefined {
    return this.nearest(g, enemies, range);
  }

  private nearest<P extends Point>(from: Point, list: P[], range: number): P | undefined {
    let best: P | undefined;
    let bestD = range + 1;
    for (const p of list) {
      const d = chebyshev(from, p);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }
}
