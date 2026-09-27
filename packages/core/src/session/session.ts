import { createWorld, type LevelData } from '../map/level.ts';
import type { GameEnd, PlayerInfo } from '../net/protocol.ts';
import { ViewTracker } from '../net/view.ts';
import { applyCommand, type Command } from '../sim/commands.ts';
import { battleRules, questRules } from '../sim/rules.ts';
import { World, type Changes, type WorldSnapshot } from '../sim/world.ts';

/** Anything that plays a team by issuing commands (battle bots). */
export interface Bot {
  readonly team: number;
  update(w: World): Command[];
}

export type BotFactory = (team: number, level: NonNullable<PlayerInfo['bot']>, world: World) => Bot;

export interface CommandResult {
  team: number;
  seq: number;
  tick: number;
  reason: string | null;
}

export interface StepResult {
  /** The tick that was simulated. */
  tick: number;
  changes: Changes;
  results: CommandResult[];
}

export interface RecordedCommand {
  tick: number;
  team: number;
  cmd: Command;
}

/**
 * One running game: the authoritative world, its bots and the command queue. Used by
 * the server (multiplayer) and by the browser's web worker (single player).
 */
export class GameSession {
  world: World;
  readonly replay: RecordedCommand[] = [];
  private queue: { team: number; seq: number; cmd: Command }[] = [];
  private trackers = new Map<number, ViewTracker>();
  private bots: Bot[] = [];
  private ended: GameEnd | null = null;

  constructor(
    readonly level: LevelData,
    readonly players: PlayerInfo[],
    readonly seed: number,
    botFactory?: BotFactory,
  ) {
    this.world = createWorld(level, {
      seed,
      teams: players.map(p => ({ team: p.team, name: p.name, alliance: p.alliance })),
    });
    this.world.rules =
      level.mode === 'quest' ? questRules(0) : battleRules(level.resources ? { resources: level.resources } : {});
    if (botFactory) {
      for (const p of players) if (p.bot) this.bots.push(botFactory(p.team, p.bot, this.world));
    }
  }

  /** Replace the world with a saved one (single player quick load). */
  loadSnapshot(snapshot: WorldSnapshot): void {
    const rules = this.world.rules;
    this.world = World.fromSnapshot(snapshot);
    this.world.rules = rules;
    this.ended = null;
    this.trackers.clear();
    this.queue = [];
  }

  /** Let a bot take over a team (a player left), or give it back (bot = null). */
  setBot(team: number, bot: Bot | null): void {
    this.bots = this.bots.filter(b => b.team !== team);
    if (bot) this.bots.push(bot);
  }

  submit(team: number, cmd: Command, seq = -1): void {
    this.queue.push({ team, seq, cmd });
  }

  step(): StepResult {
    const w = this.world;
    const tick = w.tick;
    const results: CommandResult[] = [];
    if (!this.ended) {
      for (const bot of this.bots) {
        for (const cmd of bot.update(w)) this.queue.push({ team: bot.team, seq: -1, cmd });
      }
      const queue = this.queue;
      this.queue = [];
      for (const q of queue) {
        let reason: string | null;
        try {
          reason = applyCommand(w, q.team, q.cmd);
        } catch (err) {
          reason = 'error';
          console.error('Command failed', q.cmd, err);
        }
        if (reason === null) this.replay.push({ tick, team: q.team, cmd: q.cmd });
        if (q.seq >= 0) results.push({ team: q.team, seq: q.seq, tick, reason });
      }
      w.rules.onTick?.(w);
      w.runTasks();
      this.checkEnd();
    }
    w.tick = tick + 1;
    return { tick, changes: w.takeChanges(), results };
  }

  tracker(viewer: number): ViewTracker {
    let t = this.trackers.get(viewer);
    if (!t) {
      t = new ViewTracker(viewer);
      this.trackers.set(viewer, t);
    }
    return t;
  }

  get end(): GameEnd | null {
    return this.ended;
  }

  private checkEnd(): void {
    const w = this.world;
    if (this.level.mode === 'quest') {
      const team = w.team(0);
      if (team?.won) this.ended = { winner: 0, reason: 'win' };
      else if (team?.lost) this.ended = { winner: null, reason: 'lose' };
      return;
    }
    for (const t of w.all('team')) {
      if (t.won) {
        this.ended = { winner: t.index, reason: 'win' };
        return;
      }
    }
  }
}
