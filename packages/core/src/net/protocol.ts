import type { Command } from '../sim/commands.ts';
import type { LevelData } from '../map/level.ts';
import type { Delta, ViewSnapshot } from './view.ts';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface PlayerInfo {
  team: number;
  name: string;
  alliance: number;
  bot?: BotLevel;
}

export interface GameStart {
  level: LevelData;
  /** Our team (-1 = spectator). */
  team: number;
  players: PlayerInfo[];
  snapshot: ViewSnapshot;
  /** Server time (ms) at which tick 0 started, in the server's clock. */
  startTime: number;
}

export interface GameEnd {
  winner: number | null;
  reason: 'win' | 'lose' | 'abort';
}

/** Messages about a running game, shared by the WebSocket and Web Worker transports. */
export type GameServerMsg =
  | { t: 'start'; start: GameStart }
  | { t: 'delta'; d: Delta }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'ack'; seq: number; tick: number }
  | { t: 'reject'; seq: number; reason: string }
  | { t: 'snapshot'; s: ViewSnapshot }
  | { t: 'end'; end: GameEnd }
  | { t: 'pong'; c: number; s: number };

export type GameClientMsg =
  | { t: 'cmd'; seq: number; c: Command }
  | { t: 'resync' }
  | { t: 'ping'; c: number };

// --- lobby (WebSocket only) -------------------------------------------------------------

export interface RoomSummary {
  code: string;
  name: string;
  levelId: string;
  players: number;
  maxPlayers: number;
  status: 'lobby' | 'playing';
}

export type SlotKind = 'open' | 'closed' | 'human' | 'bot';

export interface RoomSlot {
  kind: SlotKind;
  /** Player id for human slots. */
  playerId?: string;
  name?: string;
  bot?: BotLevel;
  alliance: number;
  ready: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  isPublic: boolean;
  levelId: string;
  hostId: string;
  status: 'lobby' | 'countdown' | 'playing' | 'finished';
  countdownEnd?: number;
  slots: RoomSlot[];
  chat: { from: string; text: string; at: number }[];
}

export type LobbyServerMsg =
  | { t: 'welcome'; playerId: string; token: string; name: string }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'room'; room: RoomState | null }
  | { t: 'chat'; from: string; text: string; at: number }
  | { t: 'error'; code: string };

export type LobbyClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'listRooms' }
  | { t: 'createRoom'; name: string; levelId: string; isPublic: boolean }
  | { t: 'joinRoom'; code: string }
  | { t: 'leaveRoom' }
  | { t: 'setSlot'; slot: number; kind: SlotKind; bot?: BotLevel }
  | { t: 'setAlliance'; slot: number; alliance: number }
  | { t: 'setLevel'; levelId: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'chat'; text: string };

export type ServerMsg = GameServerMsg | LobbyServerMsg;
export type ClientMsg = GameClientMsg | LobbyClientMsg;
