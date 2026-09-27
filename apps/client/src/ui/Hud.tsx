import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_HEALTH, stamina, tileDef, type Grunt, type TeamState, type World } from '@gruntz/core';
import type { GameClient } from '../game/GameClient.ts';
import { useStore } from '../game/store.ts';
import { aiName, itemName, localized, t } from '../i18n/index.ts';
import { gruntColor } from '../render/entities.ts';
import { BRICK_COLORS, TEAM_COLORS } from '../render/placeholders.ts';
import { themeColors } from '../render/tileKit.ts';
import { ItemImg, useThumbnails } from './icons.tsx';
import { thumbnails } from '../render/thumbnails.ts';
import { FastForward, Flame, Navigation2, Pause, Play, Radiation, X } from 'lucide-preact';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function Hud({ client }: { client: GameClient }) {
  const ui = useStore(client.ui);
  const w = client.world;
  if (!w || ui.status === 'loading') return <div class="loading">…</div>;
  const team = w.team(ui.team);
  const selected = client.selectedGruntz();
  return (
    <>
      {team && <TeamPanel client={client} team={team} world={w} />}
      <TopRight client={client} />
      {selected.length > 0 && <SelectionPanel client={client} gruntz={selected} />}
      <ModeHint client={client} />
      <FloatingTexts client={client} />
      {ui.connectionProblem && <div class="net-warning">{t('mp.disconnected')}</div>}
      {ui.help && <HelpBox client={client} />}
      {ui.toast && performance.now() - ui.toast.at < 2500 && <div class="toast">{t(`hud.${ui.toast.key}` as never)}</div>}
      {team && <CurseFx client={client} team={team} world={w} />}
      {ui.alert && performance.now() - ui.alert.at < 4000 && <div class="alert-banner">{t('hud.fortUnderAttack')}</div>}
    </>
  );
}

function TeamPanel({ client, team, world }: { client: GameClient; team: TeamState; world: World }) {
  const [confirm, setConfirm] = useState(false);
  const mode = client.ui.get().mode;
  const quest = world.mode === 'quest';
  return (
    <div class="hud-panel team-panel">
      <div class="goo">
        <span class="label">{t('hud.gooWell')}</span>
        <div class="goo-well">
          <div class="goo-fill" style={{ height: `${Math.min(100, (team.goo / 4) * 100)}%`, background: hex(TEAM_COLORS[team.index] ?? 0x999999) }} />
        </div>
      </div>
      <div class="ovens">
        <span class="label">{t('hud.ovens')}</span>
        <div class="oven-row">
          {team.ovens.map((o, i) => {
            const ready = o >= 0 && world.tick >= o;
            const baking = o >= 0 && !ready;
            return (
              <button
                class={`oven ${ready ? 'ready' : ''} ${baking ? 'baking' : ''} ${mode.kind === 'drop' && mode.oven === i ? 'active' : ''}`}
                disabled={!ready}
                title={ready ? t('hud.dropHint') : ''}
                onClick={() => client.setMode({ kind: 'drop', oven: i })}
              >
                {ready ? <GruntFace theme={world.theme} team={team.index} size={34} /> : baking ? <Flame size={18} strokeWidth={2} /> : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div class="machine">
        <span class="label">{t('hud.machine')}</span>
        <div class="slot-row">
          {Array.from({ length: Math.max(4, team.slots.length) }, (_, i) => {
            const item = team.slots[i] ?? null;
            const active = mode.kind === 'give' && mode.slot === i;
            return (
              <button
                class={`slot-btn ${active ? 'active' : ''}`}
                disabled={!item}
                title={item ? `${itemName(item)} — ${t('hud.giveHint')}` : ''}
                onClick={() => item && client.setMode({ kind: 'give', slot: i })}
              >
                {item ? <ItemIcon item={item} /> : null}
              </button>
            );
          })}
        </div>
      </div>
      {quest && (
        <div class="destruct">
          {confirm ? (
            <div class="confirm">
              <span>{t('hud.destructConfirm')}</span>
              <button
                class="danger"
                onClick={() => {
                  client.send({ type: 'destruct' });
                  setConfirm(false);
                }}
              >
                OK
              </button>
              <button class="icon-btn" onClick={() => setConfirm(false)}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <button class="destruct-btn" onClick={() => setConfirm(true)} title={t('hud.destruct')}>
              <Radiation size={20} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Rendered portrait of a grunt in its colours. */
function GruntFace({ theme, team, ai, size }: { theme: World['theme']; team: number; ai?: string | undefined; size: number }) {
  useThumbnails();
  const url = thumbnails.portrait(theme, team, ai);
  return url ? <img class="face-img" src={url} width={size} height={size} alt="" draggable={false} /> : null;
}

function ItemIcon({ item }: { item: string }) {
  if (item in BRICK_COLORS) return <span class="brick-icon" style={{ background: hex(BRICK_COLORS[item]!) }} />;
  return <ItemImg item={item} size={32} />;
}

function TopRight({ client }: { client: GameClient }) {
  const ui = client.ui.get();
  return (
    <div class="hud-panel top-right">
      <Minimap client={client} />
      <div class="top-right-row">
        <button class="compass icon-btn" title="Home" onClick={() => client.renderer.rig.resetRotation()}>
          <span style={{ transform: `rotate(${(-client.renderer.rig.heading * 180) / Math.PI}deg)` }}>
            <Navigation2 size={16} strokeWidth={2.2} />
          </span>
        </button>
        {client.singlePlayer ? (
          <>
            <button class={`icon-btn ${ui.paused ? 'active' : ''}`} onClick={() => client.togglePause()} title="P">
              {ui.paused ? <Play size={16} strokeWidth={2.2} /> : <Pause size={16} strokeWidth={2.2} />}
            </button>
            <button class={`icon-btn ${ui.speed >= 2 ? 'active' : ''}`} onClick={() => client.setSpeed(ui.speed >= 2 ? 1 : 2)} title="+/-">
              <FastForward size={16} strokeWidth={2.2} />
              <small>{ui.speed}×</small>
            </button>
          </>
        ) : (
          <span class="ping">{ui.ping} ms</span>
        )}
      </div>
    </div>
  );
}

function Minimap({ client }: { client: GameClient }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = client.world;
      const canvas = ref.current;
      if (!w || !canvas) return;
      const size = 168;
      const scale = size / Math.max(w.width, w.height);
      canvas.width = Math.ceil(w.width * scale);
      canvas.height = Math.ceil(w.height * scale);
      const g = canvas.getContext('2d')!;
      // Terrain in the world's own colours, markers in fixed ones.
      const pal = themeColors(w.theme);
      const themed: Record<string, string> = {
        ground: hex(pal.ground),
        nogo: hex(pal.ground),
        cliff: hex(pal.cliff),
        water: hex(pal.water),
        death: hex(pal.abyss),
        rock: hex(pal.rock),
        giantRock: hex(pal.rock),
      };
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x < w.width; x++) {
          const v = tileDef(w.tileAt(x, y)).visual;
          g.fillStyle = themed[v.kind] ?? MINIMAP_COLORS[v.kind] ?? '#9a8a6a';
          if (v.kind === 'pyramid' && v.lowered) g.fillStyle = '#b8a888';
          g.fillRect(x * scale, y * scale, scale + 0.5, scale + 0.5);
        }
      for (const f of w.all('fort')) {
        g.fillStyle = hex(TEAM_COLORS[f.team] ?? 0xffffff);
        g.fillRect((f.x - 1) * scale, (f.y - 1) * scale, 3 * scale, 3 * scale);
      }
      for (const gr of w.all('grunt')) {
        if (gr.action.kind === 'death') continue;
        g.fillStyle = hex(gruntColor(gr));
        g.beginPath();
        g.arc((gr.x + 0.5) * scale, (gr.y + 0.5) * scale, Math.max(1.6, scale * 0.6), 0, Math.PI * 2);
        g.fill();
      }
      // Camera footprint.
      const rig = client.renderer.rig;
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1;
      const half = rig.distance * 0.35;
      g.strokeRect((rig.target.x - half * 1.4) * scale, (rig.target.y - half) * scale, half * 2.8 * scale, half * 2 * scale);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [client]);
  const onClick = (e: MouseEvent) => {
    const w = client.world;
    const canvas = ref.current;
    if (!w || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w.width;
    const y = ((e.clientY - r.top) / r.height) * w.height;
    if (e.button === 2) {
      const ids = client.selectedGruntz().map(g => g.id);
      if (ids.length) client.send({ type: 'move', ids, x: Math.floor(x), y: Math.floor(y) });
    } else client.renderer.rig.panTo(x, y);
  };
  return <canvas ref={ref} class="minimap" onPointerDown={onClick} onContextMenu={e => e.preventDefault()} />;
}

const MINIMAP_COLORS: Record<string, string> = {
  ground: '#b89a6a',
  cliff: '#6a4a34',
  nogo: '#b89a6a',
  metal: '#7a8494',
  water: '#3a8ac8',
  death: '#1a1010',
  hole: '#2a1a10',
  mound: '#8a6a4a',
  spikes: '#b0b4bc',
  rock: '#8a7a6a',
  pad: '#9aa4b4',
  brickz: '#9a5a36',
  crumble: '#8a7050',
  bridge: '#9a6a3a',
  arrow: '#e8c83a',
  switch: '#e8e8e8',
  pyramid: '#d8d0c0',
};

function SelectionPanel({ client, gruntz }: { client: GameClient; gruntz: Grunt[] }) {
  const w = client.world!;
  const g = gruntz[0]!;
  if (gruntz.length > 1) {
    return (
      <div class="hud-panel selection multi">
        <span class="label">{t('hud.selected', { n: gruntz.length })}</span>
        <div class="portraits">
          {gruntz.slice(0, 24).map(gr => (
            <button class="mini-portrait" style={{ background: hex(gruntColor(gr)) }} onClick={() => client.select([gr.id])}>
              <span class="mini-hp" style={{ width: `${(gr.health / MAX_HEALTH) * 100}%` }} />
              {gr.tool ? <ItemImg item={gr.tool} size={22} /> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const st = stamina(w, g);
  const mine = g.team === client.ui.get().team && !g.ai;
  return (
    <div class="hud-panel selection">
      <div class="portrait" style={{ '--team': hex(gruntColor(g)) }}>
        <GruntFace theme={w.theme} team={g.team} ai={g.ai ?? undefined} size={64} />
      </div>
      <div class="info">
        <div class="name">{g.ai ? aiName(g.ai) : `Grunt #${g.id}`}</div>
        <Bar label={t('hud.health')} value={g.health / MAX_HEALTH} color={g.health > 12 ? '#9edc88' : g.health > 6 ? '#f2d47e' : '#f28a78'} text={`${g.health}/${MAX_HEALTH}`} />
        <Bar label={t('hud.stamina')} value={st / 20} color="#9cc8ff" />
        {g.flying && <Bar label="✈" value={g.flight / 20} color="#d0d0d8" />}
        {g.orders.length > 0 && <div class="orders">{t('hud.orders', { n: g.orders.length })}</div>}
      </div>
      <div class="equipment">
        <EquipSlot label={t('hud.tool')} item={g.tool} empty={t('hud.noTool')} hotkey={mine ? 'T' : undefined} onClick={mine && g.tool ? () => client.setMode({ kind: 'tool' }) : undefined} />
        <EquipSlot label={t('hud.toy')} item={g.toy} empty={t('hud.noToy')} hotkey={mine ? 'Y' : undefined} onClick={mine && g.toy ? () => client.setMode({ kind: 'toy' }) : undefined} />
        {g.powerup && <EquipSlot label={t('hud.powerup')} item={g.powerup} empty="" timer={Math.max(0, Math.ceil((g.powerupEnd - w.tick) / 20))} />}
      </div>
    </div>
  );
}

function Bar({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  return (
    <div class="bar">
      <span class="bar-label">{label}</span>
      <div class="bar-track">
        <div class="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
        {text && <span class="bar-text">{text}</span>}
      </div>
    </div>
  );
}

function EquipSlot({
  label,
  item,
  empty,
  hotkey,
  onClick,
  timer,
}: {
  label: string;
  item: string | null;
  empty: string;
  hotkey?: string | undefined;
  onClick?: (() => void) | undefined;
  timer?: number;
}) {
  const shown = item === 'TOOBWATER' ? 'TOOB' : item;
  return (
    <button class="equip" disabled={!onClick} onClick={onClick} title={shown ? itemName(shown) : empty}>
      <span class="equip-label">{label}</span>
      <span class="equip-icon">{shown ? <ItemImg item={shown} size={34} /> : '—'}</span>
      <span class="equip-name">{shown ? itemName(shown) : empty}</span>
      {hotkey && shown && <kbd>{hotkey}</kbd>}
      {timer !== undefined && <span class="timer">{timer}s</span>}
    </button>
  );
}

function HelpBox({ client }: { client: GameClient }) {
  const help = client.ui.get().help!;
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') client.ui.set({ help: null });
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [client]);
  return (
    <div class="help-box" onClick={() => client.ui.set({ help: null })}>
      <div class="help-title">📖 {t('hud.helpTitle')}</div>
      <p>{localized(help)}</p>
      <button class="primary">{t('hud.close')}</button>
    </div>
  );
}

/** Battlez curses picked up by an opponent mess with our view for a while. */
function CurseFx({ client, team, world }: { client: GameClient; team: TeamState; world: World }) {
  const active = team.curse && world.tick < team.curseEnd ? team.curse : null;
  useEffect(() => {
    const canvas = client.renderer.canvas;
    canvas.classList.remove('curse-colors', 'curse-mini');
    if (active === 'RANDOMCOLORZ') canvas.classList.add('curse-colors');
    if (active === 'MINICAM') canvas.classList.add('curse-mini');
    if (active !== 'SCREENSHAKE') return;
    const id = setInterval(() => client.renderer.rig.addShake(0.35), 200);
    return () => clearInterval(id);
  }, [active, client]);
  if (active === 'BLACKSCREEN') return <div class="curse-dark" />;
  return null;
}

function ModeHint({ client }: { client: GameClient }) {
  const mode = client.ui.get().mode;
  const text =
    mode.kind === 'tool'
      ? t('hud.toolMode')
      : mode.kind === 'toy'
        ? t('hud.toyMode')
        : mode.kind === 'give'
          ? t('hud.giveHint')
          : mode.kind === 'drop'
            ? t('hud.dropHint')
            : null;
  if (!text) return null;
  return <div class="mode-hint">{text}</div>;
}

/** Damage numbers etc., positioned every frame without re-rendering Preact. */
function FloatingTexts({ client }: { client: GameClient }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const pool: HTMLDivElement[] = [];
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = ref.current;
      if (!root) return;
      const fx = client.renderer.effects;
      const now = fx.now();
      fx.texts.forEach((txt, i) => {
        let el = pool[i];
        if (!el) {
          el = document.createElement('div');
          el.className = 'float-text';
          root.appendChild(el);
          pool[i] = el;
        }
        const age = now - txt.born;
        const p = client.renderer.toScreen(txt.x, txt.y + age * 0.8, txt.z);
        el.textContent = txt.text;
        el.style.color = txt.color;
        el.style.opacity = String(Math.max(0, 1 - age));
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        el.style.display = p.visible ? 'block' : 'none';
      });
      for (let i = fx.texts.length; i < pool.length; i++) pool[i]!.style.display = 'none';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [client]);
  return <div class="float-layer" ref={ref} />;
}
