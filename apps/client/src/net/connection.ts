import { Packr } from 'msgpackr';
import type { ClientMsg, GameClientMsg, GameServerMsg, LobbyServerMsg, ServerMsg } from '@gruntz/core';
import { Store } from '../game/store.ts';
import type { GameTransport } from './transport.ts';

const packr = new Packr({ useRecords: false, mapsAsObjects: true });
const TOKEN_KEY = 'gruntz.token';
const GAME_TYPES = new Set(['start', 'delta', 'hash', 'ack', 'reject', 'snapshot', 'end', 'pong']);

export interface ConnectionState {
  status: 'connecting' | 'online' | 'offline';
  playerId: string | null;
  name: string;
  rooms: import('@gruntz/core').RoomSummary[];
  room: import('@gruntz/core').RoomState | null;
  error: string | null;
}

/**
 * The one WebSocket to the server. Lobby messages update `state`; game messages go to
 * the active game transport. Reconnects automatically and resumes with the saved token.
 */
export class Connection {
  readonly state = new Store<ConnectionState>({
    status: 'connecting',
    playerId: null,
    name: '',
    rooms: [],
    room: null,
    error: null,
  });
  private ws: WebSocket | null = null;
  private gameListeners = new Set<(msg: GameServerMsg) => void>();
  private startListeners = new Set<(msg: GameServerMsg) => void>();
  private retry = 0;
  private closed = false;
  private queue: ClientMsg[] = [];

  constructor(private name: string) {
    this.connect();
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private connect(): void {
    this.state.set({ status: 'connecting' });
    const ws = new WebSocket(this.url());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      let token: string | undefined;
      try {
        token = sessionStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        /* ignore */
      }
      this.raw({ t: 'hello', name: this.name, ...(token ? { token } : {}) });
      for (const m of this.queue.splice(0)) this.raw(m);
    };
    ws.onmessage = e => {
      const msg = packr.unpack(new Uint8Array(e.data as ArrayBuffer)) as ServerMsg;
      this.receive(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      this.state.set({ status: 'offline' });
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private receive(msg: ServerMsg): void {
    if (GAME_TYPES.has(msg.t)) {
      const game = msg as GameServerMsg;
      if (game.t === 'start') for (const l of this.startListeners) l(game);
      for (const l of this.gameListeners) l(game);
      return;
    }
    const lobby = msg as LobbyServerMsg;
    switch (lobby.t) {
      case 'welcome':
        try {
          sessionStorage.setItem(TOKEN_KEY, lobby.token);
        } catch {
          /* ignore */
        }
        this.state.set({ status: 'online', playerId: lobby.playerId, name: lobby.name, error: null });
        break;
      case 'rooms':
        this.state.set({ rooms: lobby.rooms });
        break;
      case 'room':
        this.state.set({ room: lobby.room });
        break;
      case 'chat': {
        const room = this.state.get().room;
        if (room)
          this.state.set({
            room: { ...room, chat: [...room.chat, { from: lobby.from, text: lobby.text, at: lobby.at }] },
          });
        break;
      }
      case 'error':
        this.state.set({ error: lobby.code });
        break;
    }
  }

  private raw(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(packr.pack(msg));
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.raw(msg);
    else if (msg.t !== 'cmd' && msg.t !== 'ping') this.queue.push(msg);
  }

  /** Called when the server starts a game for us. */
  onGameStart(fn: (msg: GameServerMsg) => void): () => void {
    this.startListeners.add(fn);
    return () => this.startListeners.delete(fn);
  }

  /** A GameTransport view of this connection for the game client. */
  gameTransport(first: GameServerMsg): GameTransport {
    const listeners = new Set<(msg: GameServerMsg) => void>();
    const forward = (m: GameServerMsg) => {
      for (const l of listeners) l(m);
    };
    this.gameListeners.add(forward);
    let replayed = false;
    return {
      send: (msg: GameClientMsg) => this.send(msg),
      onMessage: fn => {
        listeners.add(fn);
        if (!replayed) {
          replayed = true;
          queueMicrotask(() => fn(first));
        }
        return () => listeners.delete(fn);
      },
      close: () => {
        this.gameListeners.delete(forward);
        listeners.clear();
      },
    };
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
