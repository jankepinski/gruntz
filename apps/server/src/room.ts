import { randomInt } from 'node:crypto';
import {
  BattleBot,
  GameSession,
  TICK_MS,
  type BotLevel,
  type ClientMsg,
  type GameServerMsg,
  type LevelData,
  type PlayerInfo,
  type RoomSlot,
  type RoomState,
  type RoomSummary,
  type ServerMsg,
} from '@gruntz/core';
import { LEVELS } from './levels.ts';
import type { Player } from './players.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COUNTDOWN_MS = 3000;
const RECONNECT_GRACE_MS = 60_000;
const HASH_EVERY = 20;
const CHAT_LIMIT = 50;

export function newRoomCode(taken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!taken(code)) return code;
  }
}

/**
 * A room: lobby slots, chat and — once started — the authoritative game. The game
 * loop runs at the fixed 20 Hz tick; every connected player gets deltas filtered for
 * what their team is allowed to see.
 */
export class Room {
  status: RoomState['status'] = 'lobby';
  slots: RoomSlot[] = [];
  chat: RoomState['chat'] = [];
  countdownEnd = 0;
  members = new Map<string, Player>();
  session: GameSession | null = null;
  private teamOf = new Map<string, number>();
  private disconnectedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private acc = 0;
  private last = 0;
  hostId: string;
  level: LevelData;

  constructor(
    readonly code: string,
    public name: string,
    public isPublic: boolean,
    level: LevelData,
    host: Player,
    private onEmpty: (room: Room) => void,
  ) {
    this.level = level;
    this.hostId = host.id;
    this.resetSlots();
  }

  private resetSlots(): void {
    const n = Math.min(4, this.level.players ?? 4);
    const old = this.slots;
    this.slots = Array.from({ length: n }, (_, i) => old[i] ?? { kind: 'open' as const, alliance: i, ready: false });
    // Humans that no longer fit are dropped back to the lobby list.
    for (const s of old.slice(n))
      if (s.kind === 'human' && s.playerId) this.members.get(s.playerId)?.send({ t: 'room', room: null });
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      name: this.name,
      levelId: this.level.id,
      players: this.slots.filter(s => s.kind === 'human').length,
      maxPlayers: this.slots.filter(s => s.kind !== 'closed').length,
      status: this.status === 'playing' || this.status === 'countdown' ? 'playing' : 'lobby',
    };
  }

  state(): RoomState {
    const s: RoomState = {
      code: this.code,
      name: this.name,
      isPublic: this.isPublic,
      levelId: this.level.id,
      hostId: this.hostId,
      status: this.status,
      slots: this.slots,
      chat: this.chat.slice(-CHAT_LIMIT),
    };
    if (this.status === 'countdown') s.countdownEnd = this.countdownEnd;
    return s;
  }

  broadcast(msg: ServerMsg): void {
    for (const p of this.members.values()) p.send(msg);
  }

  private pushState(): void {
    this.broadcast({ t: 'room', room: this.state() });
  }

  // --- membership --------------------------------------------------------------

  join(p: Player): string | null {
    this.disconnectedAt.delete(p.id);
    if (this.members.has(p.id)) {
      p.roomCode = this.code;
      this.reattach(p);
      return null;
    }
    if (this.status !== 'lobby') return 'in-progress';
    const slot = this.slots.findIndex(s => s.kind === 'open');
    if (slot < 0) return 'room-full';
    this.slots[slot] = {
      kind: 'human',
      playerId: p.id,
      name: p.name,
      alliance: this.slots[slot]!.alliance,
      ready: false,
    };
    this.members.set(p.id, p);
    p.roomCode = this.code;
    this.pushState();
    return null;
  }

  leave(p: Player): void {
    this.members.delete(p.id);
    this.disconnectedAt.delete(p.id);
    if (p.roomCode === this.code) p.roomCode = null;
    const i = this.slots.findIndex(s => s.playerId === p.id);
    if (this.status === 'playing') {
      // Mid-game: a bot takes over the team.
      const team = this.teamOf.get(p.id);
      if (team !== undefined && this.session)
        this.session.setBot(team, new BattleBot(team, 'normal', this.session.world));
      this.teamOf.delete(p.id);
    } else if (i >= 0) {
      this.slots[i] = { kind: 'open', alliance: this.slots[i]!.alliance, ready: false };
    }
    if (this.hostId === p.id) {
      const next = [...this.members.keys()][0];
      if (next) this.hostId = next;
    }
    if (this.members.size === 0) {
      this.stop();
      this.onEmpty(this);
      return;
    }
    this.pushState();
  }

  /** The socket dropped; keep the seat for a while. */
  disconnected(p: Player): void {
    this.disconnectedAt.set(p.id, Date.now());
    if (this.status !== 'playing') {
      // In the lobby there is nothing to protect: free the seat right away.
      this.leave(p);
    }
  }

  /** A player came back (same token): resend room state and, if needed, the game. */
  reattach(p: Player): void {
    this.disconnectedAt.delete(p.id);
    p.send({ t: 'room', room: this.state() });
    const team = this.teamOf.get(p.id);
    if (this.status === 'playing' && this.session && team !== undefined) {
      this.session.setBot(team, null);
      this.sendStart(p, team);
    }
  }

  // --- lobby actions ------------------------------------------------------------

  handle(p: Player, msg: ClientMsg): void {
    const host = p.id === this.hostId;
    switch (msg.t) {
      case 'setSlot': {
        if (!host || this.status !== 'lobby') return;
        const slot = this.slots[msg.slot];
        if (!slot || slot.kind === 'human') return;
        if (msg.kind === 'bot') {
          const b: RoomSlot = {
            kind: 'bot',
            bot: (msg.bot ?? 'normal') as BotLevel,
            name: `Bot ${msg.slot + 1}`,
            alliance: slot.alliance,
            ready: true,
          };
          this.slots[msg.slot] = b;
        } else if (msg.kind === 'open' || msg.kind === 'closed') {
          this.slots[msg.slot] = { kind: msg.kind, alliance: slot.alliance, ready: false };
        }
        this.pushState();
        return;
      }
      case 'setAlliance': {
        if (!host || this.status !== 'lobby') return;
        const slot = this.slots[msg.slot];
        if (slot) slot.alliance = msg.alliance;
        this.pushState();
        return;
      }
      case 'setLevel': {
        if (!host || this.status !== 'lobby') return;
        const level = LEVELS.get(msg.levelId);
        if (!level || level.mode !== 'battle') return;
        this.level = level;
        this.resetSlots();
        for (const s of this.slots) s.ready = s.kind === 'bot';
        this.pushState();
        return;
      }
      case 'ready': {
        const slot = this.slots.find(s => s.playerId === p.id);
        if (slot && this.status === 'lobby') {
          slot.ready = msg.ready;
          this.pushState();
        }
        return;
      }
      case 'start':
        if (host) this.tryStart(p);
        return;
      case 'chat':
        this.chat.push({ from: p.name, text: msg.text, at: Date.now() });
        if (this.chat.length > CHAT_LIMIT * 2) this.chat = this.chat.slice(-CHAT_LIMIT);
        this.broadcast({ t: 'chat', from: p.name, text: msg.text, at: Date.now() });
        return;
      case 'cmd': {
        const team = this.teamOf.get(p.id);
        if (this.status !== 'playing' || !this.session || team === undefined) return;
        if (!p.commandLimiter.take()) {
          p.send({ t: 'reject', seq: msg.seq, reason: 'rate-limit' });
          return;
        }
        this.session.submit(team, msg.c, msg.seq);
        return;
      }
      case 'resync': {
        const team = this.teamOf.get(p.id);
        if (this.session && team !== undefined)
          p.send({ t: 'snapshot', s: this.session.tracker(team).snapshot(this.session.world) });
        return;
      }
    }
  }

  private tryStart(by: Player): void {
    if (this.status !== 'lobby') return;
    const humans = this.slots.filter(s => s.kind === 'human');
    const participants = this.slots.filter(s => s.kind === 'human' || s.kind === 'bot');
    const alliances = new Set(participants.map(s => s.alliance));
    if (participants.length < 2 || alliances.size < 2) {
      by.send({ t: 'error', code: 'need-opponents' });
      return;
    }
    if (humans.some(s => !s.ready && s.playerId !== this.hostId)) {
      by.send({ t: 'error', code: 'not-ready' });
      return;
    }
    this.status = 'countdown';
    this.countdownEnd = Date.now() + COUNTDOWN_MS;
    this.pushState();
    setTimeout(() => {
      if (this.status === 'countdown') this.startGame();
    }, COUNTDOWN_MS);
  }

  private startGame(): void {
    const players: PlayerInfo[] = [];
    this.teamOf.clear();
    this.slots.forEach((s, team) => {
      if (s.kind === 'human' && s.playerId) {
        players.push({ team, name: s.name ?? 'Player', alliance: s.alliance });
        this.teamOf.set(s.playerId, team);
      } else if (s.kind === 'bot') {
        players.push({ team, name: s.name ?? `Bot ${team + 1}`, alliance: s.alliance, bot: s.bot ?? 'normal' });
      }
    });
    this.session = new GameSession(
      this.level,
      players,
      randomInt(1, 2 ** 31),
      (team, level, world) => new BattleBot(team, level, world),
    );
    this.status = 'playing';
    this.pushState();
    for (const p of this.members.values()) {
      const team = this.teamOf.get(p.id);
      this.sendStart(p, team ?? -1);
    }
    this.acc = 0;
    this.last = performance.now();
    this.timer = setInterval(() => this.loop(), TICK_MS / 2);
  }

  private sendStart(p: Player, team: number): void {
    const s = this.session!;
    const tracker = s.tracker(team);
    p.send({
      t: 'start',
      start: {
        level: this.level,
        team,
        players: s.players,
        snapshot: tracker.snapshot(s.world),
        startTime: Date.now(),
      },
    });
  }

  private loop(): void {
    const s = this.session;
    if (!s) return;
    const now = performance.now();
    this.acc = Math.min(this.acc + now - this.last, TICK_MS * 10);
    this.last = now;
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.step(s);
      if (this.status !== 'playing') return;
    }
    // Seats of players who never came back go to bots for good.
    for (const [id, at] of this.disconnectedAt) {
      if (Date.now() - at > RECONNECT_GRACE_MS) {
        const p = this.members.get(id);
        this.disconnectedAt.delete(id);
        if (p) this.leave(p);
      }
    }
  }

  private step(s: GameSession): void {
    const step = s.step();
    const perTeam = new Map<number, GameServerMsg[]>();
    for (const r of step.results) {
      const list = perTeam.get(r.team) ?? [];
      list.push(
        r.reason === null ? { t: 'ack', seq: r.seq, tick: r.tick } : { t: 'reject', seq: r.seq, reason: r.reason },
      );
      perTeam.set(r.team, list);
    }
    // Deltas are computed once per viewing team (players of a team share a view).
    const deltas = new Map<number, GameServerMsg>();
    for (const p of this.members.values()) {
      const team = this.teamOf.get(p.id) ?? -1;
      let delta = deltas.get(team);
      if (!delta) {
        delta = { t: 'delta', d: s.tracker(team).delta(s.world, step.changes, step.tick) };
        deltas.set(team, delta);
      }
      if (this.disconnectedAt.has(p.id)) continue;
      p.send(delta);
      for (const m of perTeam.get(team) ?? []) p.send(m);
      if (step.tick % HASH_EVERY === 0) p.send({ t: 'hash', tick: step.tick, h: s.tracker(team).hash() });
    }
    // Spectator/disconnected views still need to consume changes to stay consistent.
    if (s.end) {
      this.broadcast({ t: 'end', end: s.end });
      this.finish();
    }
  }

  private finish(): void {
    this.stop();
    this.status = 'finished';
    this.pushState();
    setTimeout(() => {
      if (this.status !== 'finished') return;
      this.status = 'lobby';
      this.session = null;
      for (const s of this.slots) s.ready = s.kind === 'bot';
      this.pushState();
    }, 8000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
