import { useEffect, useState } from 'preact/hooks';
import type { BotLevel, LevelData, PlayerInfo } from '@gruntz/core';
import { lang, localized, onLangChange, setLang, t, type Key } from '../i18n/index.ts';
import { BATTLE_LEVELS, CAMPAIGN, levelById, questWorlds } from '../game/levels.ts';
import { settings, useStore } from '../game/store.ts';
import { loadProgress, secretUnlocked, worldLetters } from '../game/progress.ts';
import { GameScreen, type GameLaunch } from './GameScreen.tsx';
import { MultiplayerScreen } from './Multiplayer.tsx';
import { EditorScreen } from '../editor/EditorScreen.tsx';
import { EditorModel } from '../editor/model.ts';
import { MenuBackdrop } from './MenuBackdrop.tsx';

/** One editor document for the whole session so leaving the editor keeps the work. */
let editorModel: EditorModel | null = null;
function getEditorModel(id?: string | null): EditorModel {
  if (!editorModel) {
    // ?editor=<level id> opens a shipped level; otherwise the last autosave comes back.
    const level = id ? levelById(id) : undefined;
    editorModel = new EditorModel(level ? structuredClone(level) : undefined);
  }
  return editorModel;
}

type Screen = 'menu' | 'quest' | 'battle' | 'settings' | 'multiplayer' | 'game' | 'editor';

function useLang(): void {
  const [, force] = useState(0);
  useEffect(() => onLangChange(() => force(n => n + 1)), []);
}

export function App() {
  useLang();
  const params = new URLSearchParams(location.search);
  const quick = levelById(params.get('play') ?? '');
  const [screen, setScreen] = useState<Screen>(() => (quick ? 'game' : params.get('room') ? 'multiplayer' : params.has('editor') ? 'editor' : 'menu'));
  const [launch, setLaunch] = useState<GameLaunch | null>(() => (quick ? quickLaunch(quick, Number(params.get('bots') ?? 1)) : null));

  const play = (l: GameLaunch) => {
    setLaunch(l);
    setScreen('game');
  };

  if (screen === 'editor') {
    return <EditorScreen model={getEditorModel(params.get('editor'))} back={() => setScreen('menu')} />;
  }
  if (screen === 'game' && launch) {
    const next = launch.kind === 'sp' && launch.level.mode === 'quest' && !launch.level.secret ? CAMPAIGN[CAMPAIGN.findIndex(l => l.id === launch.level.id) + 1] : undefined;
    return (
      <GameScreen
        launch={launch}
        onExit={() => setScreen(launch.kind === 'mp' ? 'multiplayer' : launch.kind === 'sp' && launch.level.mode === 'quest' ? 'quest' : 'menu')}
        onRestart={() => setLaunch({ ...launch, seed: Date.now() >>> 0 })}
        onNext={next && launch.kind === 'sp' ? () => setLaunch({ ...launch, level: next, seed: Date.now() >>> 0 }) : undefined}
      />
    );
  }
  return (
    <div class="menu-screen">
      <div class="menu-bg" />
      <MenuBackdrop />
      <div class="menu-shade" />
      {screen === 'menu' && <MainMenu go={setScreen} />}
      {screen === 'quest' && <QuestSelect back={() => setScreen('menu')} play={play} />}
      {screen === 'battle' && <BattleSetup back={() => setScreen('menu')} play={play} />}
      {screen === 'settings' && <SettingsScreen back={() => setScreen('menu')} />}
      {screen === 'multiplayer' && <MultiplayerScreen back={() => setScreen('menu')} play={play} />}
    </div>
  );
}

/** Dev shortcut: ?play=<level id>&bots=<n> starts a single player game directly. */
function quickLaunch(level: LevelData, bots: number): GameLaunch {
  const players: PlayerInfo[] = [{ team: 0, name: 'Player', alliance: 0 }];
  if (level.mode === 'battle') {
    for (let i = 1; i <= Math.min(bots, (level.players ?? 4) - 1); i++) {
      players.push({ team: i, name: `Bot ${i}`, alliance: i, bot: 'normal' });
    }
  }
  return { kind: 'sp', level, players, team: 0, seed: 1234 };
}

function LangSwitch() {
  const current = lang();
  return (
    <div class="lang-switch">
      <button class={current === 'pl' ? 'active' : ''} onClick={() => setLang('pl')}>
        PL
      </button>
      <button class={current === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
        EN
      </button>
    </div>
  );
}

function MainMenu({ go }: { go: (s: Screen) => void }) {
  return (
    <div class="panel main-menu">
      <LangSwitch />
      <h1 class="logo">
        <span>G</span>
        <span>r</span>
        <span>u</span>
        <span>n</span>
        <span>t</span>
        <span>z</span>
      </h1>
      <p class="tagline">{t('subtitle')}</p>
      <div class="menu-buttons">
        <button class="big" onClick={() => go('quest')}>
          {t('menu.quest')}
        </button>
        <button class="big" onClick={() => go('battle')}>
          {t('menu.battle')}
        </button>
        <button class="big" onClick={() => go('multiplayer')}>
          {t('menu.multiplayer')}
        </button>
        <button onClick={() => go('editor')}>{t('menu.editor')}</button>
        <button onClick={() => go('settings')}>{t('menu.settings')}</button>
      </div>
    </div>
  );
}

function QuestSelect({ back, play }: { back: () => void; play: (l: GameLaunch) => void }) {
  const name = settings.get().playerName || 'Player';
  const progress = loadProgress();
  const start = (level: LevelData) =>
    play({ kind: 'sp', level, players: [{ team: 0, name, alliance: 0 }], team: 0, seed: Date.now() >>> 0 });
  // Levels unlock one after another through the whole campaign; a world's secret level
  // opens once all four warp letters were found in that world.
  const unlocked = (level: LevelData, world: LevelData[]) => {
    if (level.secret) return secretUnlocked(progress, world.filter(l => !l.secret).map(l => l.id));
    const i = CAMPAIGN.indexOf(level);
    return i <= 0 || progress.completed.includes(level.id) || progress.completed.includes(CAMPAIGN[i - 1]!.id);
  };
  return (
    <div class="panel wide quest-select">
      <h2>{t('menu.chooseLevel')}</h2>
      {questWorlds().map(({ world, levels }) => {
        const done = levels.filter(l => progress.completed.includes(l.id)).length;
        return (
          <section class={`world-section theme-${levels[0]!.theme}`}>
            <h3>
              <span class="world-no">{world === 0 ? '★' : world}</span>
              {world === 0 ? t('menu.training') : t(`editor.themes.${levels[0]!.theme}` as Key)}
              <span class="muted">
                {' '}
                {done}/{levels.length}
              </span>
            </h3>
            <div class="level-grid">
              {levels.map((l, i) => {
                const isDone = progress.completed.includes(l.id);
                const open = unlocked(l, levels);
                const found = worldLetters(progress, levels.filter(x => !x.secret).map(x => x.id));
                return (
                  <button
                    class={`level-card ${isDone ? 'done' : ''} ${l.secret ? 'secret' : ''}`}
                    disabled={!open}
                    title={open ? '' : l.secret ? t('menu.secretLocked') : t('menu.locked')}
                    onClick={() => start(l)}
                  >
                    <span class="level-num">
                      {l.secret ? `✦ ${t('menu.secret')}` : world === 0 ? t('menu.training') : `${world}-${i + 1}`}
                      {!open && ' 🔒'}
                    </span>
                    <span class="level-name">{open || !l.secret ? localized(l.name) : '? ? ?'}</span>
                    {l.secret && (
                      <span class="warp-letters">
                        {['W', 'A', 'R', 'P'].map(ch => (
                          <b class={found.has(ch) ? 'got' : ''}>{ch}</b>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <button onClick={back}>{t('menu.back')}</button>
    </div>
  );
}

function BattleSetup({ back, play }: { back: () => void; play: (l: GameLaunch) => void }) {
  const [levelId, setLevelId] = useState(BATTLE_LEVELS[0]?.id ?? '');
  const level = BATTLE_LEVELS.find(l => l.id === levelId) ?? BATTLE_LEVELS[0];
  const max = level?.players ?? 4;
  const [bots, setBots] = useState<(BotLevel | 'none')[]>(['normal', 'normal', 'normal']);
  const name = settings.get().playerName || t('menu.you');
  if (!level) return null;
  const start = () => {
    const players: PlayerInfo[] = [{ team: 0, name, alliance: 0 }];
    bots.slice(0, max - 1).forEach((b, i) => {
      if (b !== 'none') players.push({ team: i + 1, name: `Bot ${i + 1}`, alliance: i + 1, bot: b });
    });
    if (players.length < 2) return;
    play({ kind: 'sp', level, players, team: 0, seed: Date.now() >>> 0 });
  };
  return (
    <div class="panel wide">
      <h2>{t('menu.battle')}</h2>
      <h3>{t('menu.chooseMap')}</h3>
      <div class="level-grid">
        {BATTLE_LEVELS.map(l => (
          <button class={`level-card ${l.id === levelId ? 'selected' : ''}`} onClick={() => setLevelId(l.id)}>
            <span class="level-name">{localized(l.name)}</span>
            <span class="level-meta">{t('mp.players', { n: l.players ?? 4, max: l.players ?? 4 })}</span>
          </button>
        ))}
      </div>
      <h3>{t('menu.opponents')}</h3>
      <div class="slots">
        <div class="slot team-0">
          <span class="dot" /> {name}
        </div>
        {bots.slice(0, max - 1).map((b, i) => (
          <div class={`slot team-${i + 1}`}>
            <span class="dot" />
            <select
              value={b}
              onChange={e => {
                const next = bots.slice();
                next[i] = (e.target as HTMLSelectElement).value as BotLevel | 'none';
                setBots(next);
              }}
            >
              <option value="none">{t('menu.none')}</option>
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
          </div>
        ))}
      </div>
      <div class="row">
        <button onClick={back}>{t('menu.back')}</button>
        <button class="primary" onClick={start}>
          {t('menu.start')}
        </button>
      </div>
    </div>
  );
}

function SettingsScreen({ back }: { back: () => void }) {
  const s = useStore(settings);
  const toggle = (key: 'safePath' | 'classicCamera' | 'showLinks' | 'edgeScroll') => (
    <label class="toggle">
      <input type="checkbox" checked={s[key]} onChange={() => settings.set({ [key]: !s[key] })} />
      <span>{t(`settings.${key}`)}</span>
    </label>
  );
  return (
    <div class="panel">
      <h2>{t('settings.title')}</h2>
      <LangSwitch />
      <label class="field">
        <span>{t('mp.name')}</span>
        <input value={s.playerName} maxLength={16} onInput={e => settings.set({ playerName: (e.target as HTMLInputElement).value })} />
      </label>
      {toggle('safePath')}
      {toggle('classicCamera')}
      {toggle('showLinks')}
      {toggle('edgeScroll')}
      <label class="field">
        <span>{t('settings.quality')}</span>
        <select value={s.quality} onChange={e => settings.set({ quality: (e.target as HTMLSelectElement).value as 'low' | 'medium' | 'high' })}>
          <option value="low">{t('settings.low')}</option>
          <option value="medium">{t('settings.medium')}</option>
          <option value="high">{t('settings.high')}</option>
        </select>
      </label>
      {(['master', 'music', 'sfx', 'voices'] as const).map(k => (
        <label class="field slider">
          <span>{t(`settings.${k}`)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volumes[k]}
            onInput={e => settings.set({ volumes: { ...s.volumes, [k]: Number((e.target as HTMLInputElement).value) } })}
          />
        </label>
      ))}
      <button onClick={back}>{t('menu.back')}</button>
    </div>
  );
}
