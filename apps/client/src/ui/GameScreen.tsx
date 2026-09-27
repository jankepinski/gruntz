import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameEnd, Grunt, LevelData, PlayerInfo } from '@gruntz/core';
import { GameClient } from '../game/GameClient.ts';
import { useStore } from '../game/store.ts';
import { WorkerTransport } from '../net/workerTransport.ts';
import type { GameTransport } from '../net/transport.ts';
import { t } from '../i18n/index.ts';
import { Hud } from './Hud.tsx';
import { markCompleted } from '../game/progress.ts';

export type GameLaunch =
  | { kind: 'sp'; level: LevelData; players: PlayerInfo[]; team: number; seed: number; /** Started from the level editor. */ test?: boolean }
  | { kind: 'mp'; transport: GameTransport; seed: number };

export function GameScreen({
  launch,
  onExit,
  onRestart,
  onNext,
}: {
  launch: GameLaunch;
  onExit: () => void;
  onRestart: () => void;
  onNext?: (() => void) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [client, setClient] = useState<GameClient | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; grunt: Grunt } | null>(null);
  const [end, setEnd] = useState<GameEnd | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const transport =
      launch.kind === 'sp'
        ? new WorkerTransport({ t: 'init', level: launch.level, players: launch.players, seed: launch.seed, team: launch.team })
        : launch.transport;
    const c = new GameClient(canvas, transport, {
      singlePlayer: launch.kind === 'sp',
      onEnd: e => {
        if (launch.kind === 'sp' && !launch.test && launch.level.mode === 'quest' && e.winner === launch.team) {
          markCompleted(launch.level.id, c.world?.team(launch.team)?.stats.letters ?? '');
        }
        window.setTimeout(() => setEnd(e), 2500);
      },
    });
    c.input.onContextMenu = (x, y, grunt) => setMenu({ x, y, grunt });
    if (import.meta.env.DEV) (window as unknown as { __gruntz: GameClient }).__gruntz = c;
    setClient(c);
    setEnd(null);
    const resize = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      c.renderer.resize(r.width, r.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, [launch]);

  return (
    <div class="game-screen" ref={wrapRef}>
      <canvas ref={canvasRef} class="game-canvas" tabIndex={0} />
      {client && <Hud client={client} />}
      {client && <DragBox client={client} />}
      {client && menu && <ContextMenu client={client} menu={menu} close={() => setMenu(null)} />}
      {client && <PauseOverlay client={client} onExit={onExit} onRestart={launch.kind === 'sp' ? onRestart : undefined} />}
      {client && end && (
        <EndScreen client={client} end={end} onExit={onExit} onRestart={launch.kind === 'sp' ? onRestart : undefined} onNext={end.winner === client.ui.get().team ? onNext : undefined} />
      )}
    </div>
  );
}

function DragBox({ client }: { client: GameClient }) {
  const [, force] = useState(0);
  useEffect(() => {
    client.input.onDragChange = () => force(n => n + 1);
    return () => (client.input.onDragChange = undefined);
  }, [client]);
  const r = client.input.dragRect;
  if (!r) return null;
  const x = Math.min(r.x0, r.x1);
  const y = Math.min(r.y0, r.y1);
  return <div class="drag-box" style={{ left: x, top: y, width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0) }} />;
}

function ContextMenu({ client, menu, close }: { client: GameClient; menu: { x: number; y: number; grunt: Grunt }; close: () => void }) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.context-menu')) close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [close]);
  const g = client.world?.get(menu.grunt.id, 'grunt') ?? menu.grunt;
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <div class="context-menu" style={{ left: menu.x, top: menu.y }}>
      <button disabled={!g.tool} onClick={act(() => client.setMode({ kind: 'tool' }))}>
        <kbd>T</kbd> {t('hud.tool')}
      </button>
      <button disabled={!g.toy} onClick={act(() => client.setMode({ kind: 'toy' }))}>
        <kbd>Y</kbd> {t('hud.toy')}
      </button>
      <button onClick={act(() => client.send({ type: 'stop', ids: client.ui.get().selection }))}>
        <kbd>X</kbd> Stop
      </button>
    </div>
  );
}

function PauseOverlay({ client, onExit, onRestart }: { client: GameClient; onExit: () => void; onRestart?: (() => void) | undefined }) {
  const ui = useStore(client.ui);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F10' || (e.code === 'Escape' && client.ui.get().selection.length === 0 && client.ui.get().mode.kind === 'normal')) {
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);
  if (!open && !(ui.paused && client.singlePlayer)) return null;
  if (!open) return <div class="paused-banner">{t('hud.paused')}</div>;
  return (
    <div class="overlay">
      <div class="panel">
        <h2>{t('hud.paused')}</h2>
        <button onClick={() => setOpen(false)}>{t('menu.resume')}</button>
        {onRestart && <button onClick={onRestart}>{t('menu.restart')}</button>}
        <button onClick={onExit}>{t('menu.quit')}</button>
      </div>
    </div>
  );
}

function EndScreen({
  client,
  end,
  onExit,
  onRestart,
  onNext,
}: {
  client: GameClient;
  end: GameEnd;
  onExit: () => void;
  onRestart?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}) {
  const ui = client.ui.get();
  const team = client.world?.team(ui.team);
  const won = end.winner === ui.team;
  const winnerName = ui.start?.players.find(p => p.team === end.winner)?.name ?? '';
  const stats = team?.stats;
  return (
    <div class="overlay">
      <div class={`panel end ${won ? 'won' : 'lost'}`}>
        <h2>{won ? t('hud.victory') : end.winner !== null && ui.start && ui.start.players.length > 1 ? t('hud.winner', { name: winnerName }) : t('hud.defeat')}</h2>
        {stats && (
          <div class="stats">
            <div>
              <span>{t('stats.kills')}</span>
              <b>{stats.kills}</b>
            </div>
            <div>
              <span>{t('stats.deaths')}</span>
              <b>{stats.deaths}</b>
            </div>
            <div>
              <span>{t('stats.toolz')}</span>
              <b>{stats.toolz}</b>
            </div>
            <div>
              <span>{t('stats.toyz')}</span>
              <b>{stats.toyz}</b>
            </div>
            <div>
              <span>{t('stats.coins')}</span>
              <b>{stats.coins}</b>
            </div>
            <div>
              <span>{t('stats.secrets')}</span>
              <b>{stats.secrets}</b>
            </div>
            {stats.letters && (
              <div class="letters-row">
                <span>{t('stats.letters')}</span>
                <span class="warp-letters">
                  {['W', 'A', 'R', 'P'].map(ch => (
                    <b class={stats.letters.includes(ch) ? 'got' : ''}>{ch}</b>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
        <div class="row">
          {onRestart && <button onClick={onRestart}>{t('menu.restart')}</button>}
          <button class={onNext ? '' : 'primary'} onClick={onExit}>
            {t('menu.quit')}
          </button>
          {onNext && (
            <button class="primary" onClick={onNext}>
              {t('menu.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
