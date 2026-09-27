import { useState } from 'preact/hooks';
import { Gauge, Monitor, Settings as Cog, Volume2, X } from 'lucide-preact';
import { lang, setLang, t, type Key } from '../i18n/index.ts';
import { settings, useStore } from '../game/store.ts';
import { matchPreset, presetGraphics, RESOLUTIONS, type Graphics } from '../render/graphics.ts';

type Tab = 'general' | 'graphics' | 'audio';

/**
 * Settings: general options, graphics (a preset plus every effect on its own switch, so
 * players can trade looks for speed) and sound. Used from the main menu and during a game.
 */
export function SettingsPanel({ onClose, inGame = false }: { onClose: () => void; inGame?: boolean }) {
  const [tab, setTab] = useState<Tab>(inGame ? 'graphics' : 'general');
  return (
    <div class="panel settings-panel">
      <div class="settings-head">
        <h2>{t('settings.title')}</h2>
        <button class="icon-btn" onClick={onClose} title={t('settings.close')}>
          <X size={18} />
        </button>
      </div>
      <div class="settings-tabs">
        <button class={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
          <Cog size={15} /> {t('settings.general')}
        </button>
        <button class={tab === 'graphics' ? 'active' : ''} onClick={() => setTab('graphics')}>
          <Monitor size={15} /> {t('settings.graphics')}
        </button>
        <button class={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}>
          <Volume2 size={15} /> {t('settings.audio')}
        </button>
      </div>
      <div class="settings-body">
        {tab === 'general' && <GeneralTab inGame={inGame} />}
        {tab === 'graphics' && <GraphicsTab />}
        {tab === 'audio' && <AudioTab />}
      </div>
    </div>
  );
}

function GeneralTab({ inGame }: { inGame: boolean }) {
  const s = useStore(settings);
  const toggle = (key: 'safePath' | 'classicCamera' | 'showLinks' | 'edgeScroll') => (
    <label class="toggle">
      <input type="checkbox" checked={s[key]} onChange={() => settings.set({ [key]: !s[key] })} />
      <span>{t(`settings.${key}`)}</span>
    </label>
  );
  const current = lang();
  return (
    <>
      <div class="setting-row">
        <span>Język / Language</span>
        <div class="segmented">
          <button class={current === 'pl' ? 'active' : ''} onClick={() => setLang('pl')}>
            PL
          </button>
          <button class={current === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
      </div>
      {!inGame && (
        <label class="field">
          <span>{t('mp.name')}</span>
          <input
            value={s.playerName}
            maxLength={16}
            onInput={e => settings.set({ playerName: (e.target as HTMLInputElement).value })}
          />
        </label>
      )}
      {toggle('safePath')}
      {toggle('classicCamera')}
      {toggle('showLinks')}
      {toggle('edgeScroll')}
    </>
  );
}

function GraphicsTab() {
  const s = useStore(settings);
  const g = s.graphics;
  const set = (patch: Partial<Graphics>) => {
    const next = { ...g, ...patch };
    settings.set({ graphics: { ...next, preset: matchPreset(next) } });
  };
  const choose = <T extends string | number>(
    label: Key,
    value: T,
    options: [T, string][],
    onChange: (v: T) => void,
  ) => (
    <div class="setting-row">
      <span>{t(label)}</span>
      <div class="segmented">
        {options.map(([v, text]) => (
          <button class={v === value ? 'active' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  const flag = (key: 'ao' | 'bloom' | 'antialias' | 'grading' | 'fps', label: Key) => (
    <label class="toggle">
      <input type="checkbox" checked={g[key]} onChange={() => set({ [key]: !g[key] })} />
      <span>{t(label)}</span>
    </label>
  );
  return (
    <>
      <div class="setting-row">
        <span>{t('settings.preset')}</span>
        <div class="segmented">
          {(['low', 'medium', 'high'] as const).map(p => (
            <button
              class={g.preset === p ? 'active' : ''}
              onClick={() => settings.set({ graphics: presetGraphics(p, g.fps) })}
            >
              {t(`settings.${p}`)}
            </button>
          ))}
          <button class={g.preset === 'custom' ? 'active' : ''} disabled>
            {t('settings.custom')}
          </button>
        </div>
      </div>
      <p class="muted setting-hint">{t('settings.presetHint')}</p>
      {choose(
        'settings.resolution',
        g.resolution,
        RESOLUTIONS.map(r => [r, r >= 1 ? t('settings.resNative') : `${Math.round(r * 100)}%`] as [number, string]),
        v => set({ resolution: v }),
      )}
      {choose(
        'settings.shadows',
        g.shadows,
        [
          ['off', t('settings.off')],
          ['low', t('settings.shadowsLow')],
          ['high', t('settings.shadowsHigh')],
        ],
        v => set({ shadows: v }),
      )}
      {choose(
        'settings.grass',
        g.grass,
        [
          ['off', t('settings.off')],
          ['tufts', t('settings.grassTufts')],
          ['tuftsShadow', t('settings.grassTuftsShadow')],
          ['velvet', t('settings.grassVelvet')],
        ],
        v => set({ grass: v }),
      )}
      {choose(
        'settings.scenery',
        g.scenery,
        [
          ['reduced', t('settings.sceneryReduced')],
          ['full', t('settings.sceneryFull')],
        ],
        v => set({ scenery: v }),
      )}
      {flag('ao', 'settings.ao')}
      {flag('bloom', 'settings.bloom')}
      {flag('antialias', 'settings.antialias')}
      {flag('grading', 'settings.grading')}
      <div class="setting-sep" />
      <label class="toggle">
        <input type="checkbox" checked={g.fps} onChange={() => settings.set({ graphics: { ...g, fps: !g.fps } })} />
        <span>
          <Gauge size={14} /> {t('settings.fps')}
        </span>
      </label>
    </>
  );
}

function AudioTab() {
  const s = useStore(settings);
  return (
    <>
      {(['master', 'music', 'sfx', 'voices'] as const).map(k => (
        <label class="field slider">
          <span>{t(`settings.${k}`)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volumes[k]}
            onInput={e =>
              settings.set({ volumes: { ...s.volumes, [k]: Number((e.target as HTMLInputElement).value) } })
            }
          />
        </label>
      ))}
    </>
  );
}
