import { useEffect, useRef, useState } from 'preact/hooks';
import type { BotLevel, RoomState, SlotKind } from '@gruntz/core';
import { localized, t } from '../i18n/index.ts';
import { BATTLE_LEVELS, levelById } from '../game/levels.ts';
import { settings, useStore } from '../game/store.ts';
import { Connection } from '../net/connection.ts';
import type { GameLaunch } from './GameScreen.tsx';

let connection: Connection | null = null;

function getConnection(name: string): Connection {
  if (!connection) {
    connection = new Connection(name);
    if (import.meta.env.DEV) (window as unknown as { __conn: Connection }).__conn = connection;
  }
  return connection;
}

export function MultiplayerScreen({ back, play }: { back: () => void; play: (l: GameLaunch) => void }) {
  const s = useStore(settings);
  const [name, setName] = useState(s.playerName);
  if (!s.playerName) {
    return (
      <div class="panel">
        <h2>{t('mp.title')}</h2>
        <label class="field">
          <span>{t('mp.name')}</span>
          <input value={name} maxLength={16} autoFocus onInput={e => setName((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row">
          <button onClick={back}>{t('menu.back')}</button>
          <button class="primary" disabled={!name.trim()} onClick={() => settings.set({ playerName: name.trim() })}>
            OK
          </button>
        </div>
      </div>
    );
  }
  return <Lobby back={back} play={play} name={s.playerName} />;
}

function Lobby({ back, play, name }: { back: () => void; play: (l: GameLaunch) => void; name: string }) {
  const conn = getConnection(name);
  const st = useStore(conn.state);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const autoJoined = useRef(false);

  useEffect(
    () =>
      conn.onGameStart(msg => {
        play({ kind: 'mp', transport: conn.gameTransport(msg), seed: 0 });
      }),
    [conn, play],
  );

  useEffect(() => {
    if (st.status === 'online' && !autoJoined.current && code.length === 6 && !st.room) {
      autoJoined.current = true;
      conn.send({ t: 'joinRoom', code: code.toUpperCase() });
    }
  }, [st.status]);

  if (st.room) return <RoomView conn={conn} room={st.room} me={st.playerId ?? ''} />;

  return (
    <div class="panel wide">
      <h2>{t('mp.title')}</h2>
      {st.status !== 'online' && <p class="muted">{t('mp.connecting')}</p>}
      {st.error && <p class="error">{st.error}</p>}
      <div class="mp-grid">
        <div>
          <h3>{t('mp.rooms')}</h3>
          <div class="room-list">
            {st.rooms.length === 0 && <p class="muted">{t('mp.noRooms')}</p>}
            {st.rooms.map(r => (
              <div class="room-row">
                <div>
                  <b>{r.name}</b>
                  <span class="muted">
                    {' '}
                    · {levelById(r.levelId) ? localized(levelById(r.levelId)!.name) : r.levelId} ·{' '}
                    {t('mp.players', { n: r.players, max: r.maxPlayers })}
                  </span>
                </div>
                <button disabled={r.status !== 'lobby'} onClick={() => conn.send({ t: 'joinRoom', code: r.code })}>
                  {t('mp.join')}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div class="mp-side">
          <CreateRoom conn={conn} name={name} />
          <h3>{t('mp.joinByCode')}</h3>
          <div class="row left">
            <input
              class="code-input"
              value={code}
              maxLength={6}
              placeholder="ABC123"
              onInput={e => setCode((e.target as HTMLInputElement).value.toUpperCase())}
            />
            <button disabled={code.length !== 6} onClick={() => conn.send({ t: 'joinRoom', code })}>
              {t('mp.join')}
            </button>
          </div>
        </div>
      </div>
      <div class="row">
        <button onClick={back}>{t('menu.back')}</button>
      </div>
    </div>
  );
}

function CreateRoom({ conn, name }: { conn: Connection; name: string }) {
  const [roomName, setRoomName] = useState(`${name}'s room`);
  const [isPublic, setPublic] = useState(true);
  const [levelId, setLevelId] = useState(BATTLE_LEVELS[0]?.id ?? '');
  return (
    <div class="create-room">
      <h3>{t('mp.create')}</h3>
      <label class="field">
        <span>{t('mp.roomName')}</span>
        <input value={roomName} maxLength={32} onInput={e => setRoomName((e.target as HTMLInputElement).value)} />
      </label>
      <select value={levelId} onChange={e => setLevelId((e.target as HTMLSelectElement).value)}>
        {BATTLE_LEVELS.map(l => (
          <option value={l.id}>
            {localized(l.name)} ({l.players ?? 4})
          </option>
        ))}
      </select>
      <div class="row left">
        <label class="toggle">
          <input type="radio" checked={isPublic} onChange={() => setPublic(true)} /> {t('mp.public')}
        </label>
        <label class="toggle">
          <input type="radio" checked={!isPublic} onChange={() => setPublic(false)} /> {t('mp.private')}
        </label>
      </div>
      <button
        class="primary"
        onClick={() => conn.send({ t: 'createRoom', name: roomName || 'Room', levelId, isPublic })}
      >
        {t('mp.create')}
      </button>
    </div>
  );
}

function RoomView({ conn, room, me }: { conn: Connection; room: RoomState; me: string }) {
  const host = room.hostId === me;
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const mySlot = room.slots.find(s => s.playerId === me);
  const level = levelById(room.levelId);
  useEffect(() => {
    if (room.status !== 'countdown') return;
    const id = setInterval(() => tick(n => n + 1), 200);
    return () => clearInterval(id);
  }, [room.status]);
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const setSlot = (slot: number, value: string) => {
    if (value === 'open' || value === 'closed') conn.send({ t: 'setSlot', slot, kind: value as SlotKind });
    else conn.send({ t: 'setSlot', slot, kind: 'bot', bot: value as BotLevel });
  };
  return (
    <div class="panel wide room">
      <div class="room-head">
        <h2>{room.name}</h2>
        <div class="room-code">
          <span class="muted">{t('mp.code')}</span>
          <b>{room.code}</b>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? t('mp.copied') : t('mp.copyLink')}
          </button>
        </div>
      </div>
      <div class="mp-grid">
        <div>
          <h3>{level ? localized(level.name) : room.levelId}</h3>
          {host && room.status === 'lobby' && (
            <select
              value={room.levelId}
              onChange={e => conn.send({ t: 'setLevel', levelId: (e.target as HTMLSelectElement).value })}
            >
              {BATTLE_LEVELS.map(l => (
                <option value={l.id}>
                  {localized(l.name)} ({l.players ?? 4})
                </option>
              ))}
            </select>
          )}
          <div class="slots">
            {room.slots.map((slot, i) => (
              <div class={`slot team-${i}`}>
                <span class="dot" />
                {slot.kind === 'human' ? (
                  <span class="slot-name">
                    {slot.name} {slot.playerId === room.hostId && <span class="badge">{t('mp.host')}</span>}{' '}
                    <span class={slot.ready || slot.playerId === room.hostId ? 'ok' : 'muted'}>
                      {slot.ready || slot.playerId === room.hostId ? '✔' : '…'}
                    </span>
                  </span>
                ) : host && room.status === 'lobby' ? (
                  <select
                    value={slot.kind === 'bot' ? (slot.bot ?? 'normal') : slot.kind}
                    onChange={e => setSlot(i, (e.target as HTMLSelectElement).value)}
                  >
                    <option value="open">{t('mp.open')}</option>
                    <option value="closed">{t('mp.closed')}</option>
                    <option value="easy">
                      {t('menu.bot')} · {t('menu.easy')}
                    </option>
                    <option value="normal">
                      {t('menu.bot')} · {t('menu.normal')}
                    </option>
                    <option value="hard">
                      {t('menu.bot')} · {t('menu.hard')}
                    </option>
                  </select>
                ) : (
                  <span class="muted">
                    {slot.kind === 'bot'
                      ? `${t('menu.bot')} · ${t(`menu.${slot.bot ?? 'normal'}`)}`
                      : t(`mp.${slot.kind === 'closed' ? 'closed' : 'open'}`)}
                  </span>
                )}
                <span class="spacer" />
                {slot.kind !== 'open' && slot.kind !== 'closed' && (
                  <label class="alliance">
                    {t('mp.team')}
                    <select
                      disabled={!host || room.status !== 'lobby'}
                      value={slot.alliance}
                      onChange={e =>
                        conn.send({
                          t: 'setAlliance',
                          slot: i,
                          alliance: Number((e.target as HTMLSelectElement).value),
                        })
                      }
                    >
                      {[0, 1, 2, 3].map(a => (
                        <option value={a}>{a + 1}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ))}
          </div>
          <div class="row left">
            {!host && mySlot && room.status === 'lobby' && (
              <button
                class={mySlot.ready ? 'active' : ''}
                onClick={() => conn.send({ t: 'ready', ready: !mySlot.ready })}
              >
                {mySlot.ready ? t('mp.ready') : t('mp.notReady')}
              </button>
            )}
            {host && room.status === 'lobby' && (
              <button class="primary" onClick={() => conn.send({ t: 'start' })}>
                {t('mp.startGame')}
              </button>
            )}
            {room.status === 'countdown' && room.countdownEnd && (
              <b class="countdown">
                {t('mp.countdown', { n: Math.max(0, Math.ceil((room.countdownEnd - Date.now()) / 1000)) })}
              </b>
            )}
          </div>
        </div>
        <div class="chat">
          <h3>{t('mp.chat')}</h3>
          <div class="chat-log">
            {room.chat.map(m => (
              <div>
                <b>{m.from}:</b> {m.text}
              </div>
            ))}
          </div>
          <form
            class="row left"
            onSubmit={e => {
              e.preventDefault();
              if (text.trim()) conn.send({ t: 'chat', text: text.trim() });
              setText('');
            }}
          >
            <input value={text} maxLength={200} onInput={e => setText((e.target as HTMLInputElement).value)} />
            <button type="submit">{t('mp.send')}</button>
          </form>
        </div>
      </div>
      <div class="row">
        <button onClick={() => conn.send({ t: 'leaveRoom' })}>{t('mp.leave')}</button>
      </div>
    </div>
  );
}
