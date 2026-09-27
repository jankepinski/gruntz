import type { JSX } from 'preact';
import { TILE_DEFS, type LevelObject, type ThemeId, type TileDef } from '@gruntz/core';
import {
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Asterisk,
  ChevronsDown,
  Droplets,
  Flag,
  Gem,
  Hand,
  RefreshCw,
  Repeat,
  Skull,
  Sparkles,
  Timer,
  Triangle,
  Users,
} from 'lucide-preact';
import { lang, t, type Key } from '../i18n/index.ts';
import { thumbnails } from '../render/thumbnails.ts';
export { useThumbnails } from '../ui/icons.tsx';

interface Badge {
  bg: string;
  fg: string;
  icon: JSX.Element;
}

const LIGHT_KINDS = new Set(['white', 'time', 'yellow', 'gem', 'checkpoint']);
const badgeOf = (kind: string): Badge => ({
  bg: kind === 'checkpoint' ? '#f2f2f2' : (SWITCH_COLORS[kind] ?? '#888'),
  fg: LIGHT_KINDS.has(kind) ? '#16181c' : '#fff',
  icon: KIND_ICON[kind]!(),
});

const KIND_ICON: Record<string, () => JSX.Element> = {
  green: () => <Triangle size={13} strokeWidth={2.6} />,
  blue: () => <Droplets size={13} strokeWidth={2.6} />,
  yellow: () => <ArrowLeftRight size={13} strokeWidth={2.6} />,
  white: () => <Repeat size={13} strokeWidth={2.6} />,
  red: () => <Asterisk size={13} strokeWidth={2.8} />,
  once: () => <b class="badge-digit">1</b>,
  many: () => <Users size={13} strokeWidth={2.6} />,
  orange: () => <ArrowUpDown size={13} strokeWidth={2.6} />,
  time: () => <Timer size={13} strokeWidth={2.6} />,
  checkpoint: () => <Flag size={13} strokeWidth={2.6} />,
  secret: () => <Sparkles size={13} strokeWidth={2.6} />,
  gem: () => <Gem size={13} strokeWidth={2.6} />,
};

/**
 * Badges that tell look-alike tiles apart at a glance: what a switch or pyramid kind does
 * (in its colour), arrow directions, and states like "held", "pressed" or "lowered".
 */
export function tileBadges(name: string): { main: Badge | null; extra: JSX.Element[] } {
  const d = TILE_DEFS.find(x => x.name === name);
  const extra: JSX.Element[] = [];
  if (!d) return { main: null, extra };
  const v = d.visual;
  switch (v.kind) {
    case 'switch':
      if (v.hold && v.switchKind !== 'many') extra.push(<Hand size={12} strokeWidth={2.4} />);
      if (v.pressed) extra.push(<ChevronsDown size={12} strokeWidth={2.4} />);
      return { main: badgeOf(v.switchKind), extra };
    case 'pyramid':
      if (v.lowered) extra.push(<ChevronsDown size={12} strokeWidth={2.4} />);
      return { main: badgeOf(v.pyramidKind), extra };
    case 'arrow':
      if (v.twoWay) extra.push(<Repeat size={12} strokeWidth={2.4} />);
      return {
        main: { bg: v.twoWay ? '#3a7ad8' : '#e8c83a', fg: v.twoWay ? '#fff' : '#16181c', icon: <span style={{ display: 'inline-flex', transform: `rotate(${v.dir * 45}deg)` }}><ArrowUp size={13} strokeWidth={2.8} /></span> },
        extra,
      };
    case 'bridge':
      if (v.lowered) extra.push(<ChevronsDown size={12} strokeWidth={2.4} />);
      if (v.auto) extra.push(<RefreshCw size={12} strokeWidth={2.4} />);
      if (v.over === 'death') extra.push(<Skull size={12} strokeWidth={2.4} />);
      return { main: null, extra };
    default:
      return { main: null, extra };
  }
}

/** Palette card picture: the 3D render with its badges on top. */
export function TileCardArt({ name, theme }: { name: string; theme: ThemeId }) {
  const { main, extra } = tileBadges(name);
  return (
    <span class="card-art">
      <TileThumb name={name} theme={theme} size={76} />
      {main && (
        <span class="dock-badge" style={{ background: main.bg, color: main.fg }}>
          {main.icon}
        </span>
      )}
      {extra.length > 0 && <span class="dock-badges">{extra.map(e => <span class="dock-mini">{e}</span>)}</span>}
    </span>
  );
}

/** 3D render of the tile in the world's look (the CSS swatch stands in until it is ready). */
export function TileThumb({ name, theme, size = 44 }: { name: string; theme: ThemeId; size?: number }) {
  const url = thumbnails.tile(theme, name);
  if (!url) return <TileSwatch name={name} size={Math.round(size * 0.7)} />;
  return <img class="thumb" src={url} width={size} height={size} alt="" draggable={false} />;
}

/** 3D render of a map object, with a fallback glyph until it is ready. */
export function ObjectThumb({ id, theme, obj, fallback, size = 40 }: { id: string; theme: ThemeId; obj: LevelObject; fallback: preact.ComponentChildren; size?: number }) {
  const url = thumbnails.object(theme, id, obj);
  if (!url) return <span class="object-icon">{fallback}</span>;
  return <img class="thumb" src={url} width={size} height={size} alt="" draggable={false} />;
}

export type TileGroupId = 'terrain' | 'water' | 'hazard' | 'bridge' | 'arrow' | 'switch' | 'pressed' | 'pyramid';

function groupOf(d: TileDef): TileGroupId | null {
  switch (d.visual.kind) {
    case 'ground':
    case 'cliff':
    case 'nogo':
    case 'metal':
    case 'rock':
    case 'mound':
    case 'hole':
    case 'pad':
    case 'crumble':
      return 'terrain';
    case 'water':
    case 'death':
      return 'water';
    case 'spikes':
      return 'hazard';
    case 'bridge':
      return 'bridge';
    case 'arrow':
      return 'arrow';
    case 'switch':
      return d.visual.pressed ? 'pressed' : 'switch';
    case 'pyramid':
      return 'pyramid';
    case 'brickz':
    case 'giantRock':
      return null;
  }
}

export const TILE_GROUPS: { id: TileGroupId; tiles: string[] }[] = (() => {
  const order: TileGroupId[] = ['terrain', 'water', 'hazard', 'bridge', 'arrow', 'switch', 'pressed', 'pyramid'];
  const groups = new Map<TileGroupId, string[]>(order.map(g => [g, []]));
  for (const d of TILE_DEFS) {
    const g = groupOf(d);
    if (g) groups.get(g)!.push(d.name);
  }
  return order.map(id => ({ id, tiles: groups.get(id)! }));
})();

const SWITCH_COLORS: Record<string, string> = {
  green: '#4ac04a',
  blue: '#3a7ad8',
  red: '#d83a3a',
  yellow: '#e8c83a',
  white: '#eeeeee',
  once: '#2a2a2a',
  many: '#9a4ad8',
  orange: '#f08a2a',
  time: '#c0c0c8',
  checkpoint: 'repeating-conic-gradient(#222 0 25%, #eee 0 50%) 50% / 8px 8px',
  secret: '#6a4a8a',
  gem: '#4ad8d8',
};

const ARROW_GLYPH = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Small CSS swatch that reads as the tile at a glance. */
export function TileSwatch({ name, size = 30 }: { name: string; size?: number }) {
  const d = TILE_DEFS.find(x => x.name === name)!;
  const v = d.visual;
  let bg = '#8fbf5a';
  let glyph = '';
  let fg = '#fff';
  let inner: string | null = null;
  switch (v.kind) {
    case 'ground':
      bg = v.alt ? '#7aa84c' : '#8fbf5a';
      break;
    case 'cliff':
      bg = 'linear-gradient(180deg, #9a8a70 0 45%, #6a5a48 45%)';
      break;
    case 'nogo':
      bg = 'repeating-linear-gradient(45deg, #8fbf5a 0 5px, #c85a3a 5px 8px)';
      break;
    case 'metal':
      bg = 'linear-gradient(135deg, #b8bec8, #7a808a)';
      break;
    case 'water':
      bg = '#3a8ad8';
      glyph = '≈';
      break;
    case 'death':
      bg = '#16121e';
      break;
    case 'hole':
      bg = 'radial-gradient(circle, #1e140c 45%, #8fbf5a 48%)';
      break;
    case 'mound':
      bg = 'radial-gradient(circle, #9a7a52 45%, #8fbf5a 48%)';
      break;
    case 'spikes':
      bg = '#9a9a9a';
      glyph = '▲▲';
      fg = '#444';
      break;
    case 'rock':
      bg = v.alt ? 'radial-gradient(circle, #8a7c6c 55%, #8fbf5a 58%)' : 'radial-gradient(circle, #a09888 55%, #8fbf5a 58%)';
      break;
    case 'pad':
      bg = '#b8a482';
      glyph = '▦';
      fg = '#7a684a';
      break;
    case 'crumble':
      bg = 'repeating-linear-gradient(90deg, #a08a6a 0 4px, #7a6a4e 4px 5px)';
      break;
    case 'bridge':
      bg = v.lowered ? (v.over === 'water' ? '#3a8ad8' : '#16121e') : 'repeating-linear-gradient(0deg, #a07040 0 5px, #6a4a2a 5px 6px)';
      if (v.lowered) glyph = '⌄';
      if (v.auto) inner = '#ffd24a';
      break;
    case 'arrow':
      bg = v.twoWay ? '#6a8aa8' : '#8fbf5a';
      glyph = ARROW_GLYPH[v.dir]!;
      break;
    case 'switch':
      bg = '#8fbf5a';
      inner = SWITCH_COLORS[v.switchKind] ?? '#fff';
      if (v.hold) glyph = 'H';
      if (v.pressed) glyph = '▾';
      break;
    case 'pyramid':
      bg = '#8fbf5a';
      glyph = v.lowered ? '△' : '▲';
      fg = (SWITCH_COLORS[v.pyramidKind] ?? '#fff').startsWith('#') ? SWITCH_COLORS[v.pyramidKind]! : '#222';
      break;
    case 'brickz':
      bg = '#a0582a';
      break;
    case 'giantRock':
      bg = '#8a7c6c';
      break;
  }
  return (
    <span class="tile-swatch" style={{ width: size, height: size, background: bg, color: fg }}>
      {inner && <span class="tile-swatch-dot" style={{ background: inner }} />}
      {glyph && <span class="tile-swatch-glyph">{glyph}</span>}
    </span>
  );
}

const WORDS: Record<string, { en: string; pl: string }> = {
  GROUND: { en: 'Ground', pl: 'Ziemia' },
  ALT: { en: '(variant)', pl: '(wariant)' },
  CLIFF: { en: 'Cliff', pl: 'Klif' },
  NOGO: { en: 'No-go', pl: 'Blokada' },
  METAL: { en: 'Metal wall', pl: 'Metalowa ściana' },
  WATER: { en: 'Water', pl: 'Woda' },
  DEATH: { en: 'Abyss', pl: 'Przepaść' },
  HOLE: { en: 'Hole', pl: 'Dziura' },
  MOUND: { en: 'Mound', pl: 'Kopiec' },
  SPIKES: { en: 'Spikez', pl: 'Kolce' },
  ROCK: { en: 'Rock', pl: 'Skała' },
  PAD: { en: 'Brick pad', pl: 'Pad na cegły' },
  CRUMBLE: { en: 'Crumbling', pl: 'Kruszący się' },
  BRIDGE: { en: 'Bridge', pl: 'Most' },
  DBRIDGE: { en: 'Abyss bridge', pl: 'Most nad przepaścią' },
  AUTO: { en: 'toggling', pl: 'cykliczny' },
  LO: { en: '(down)', pl: '(opuszczony)' },
  ARROW: { en: 'Arrow', pl: 'Strzałka' },
  ARROW2: { en: 'Two-way arrow', pl: 'Strzałka przełączana' },
  N: { en: 'north', pl: 'północ' },
  E: { en: 'east', pl: 'wschód' },
  S: { en: 'south', pl: 'południe' },
  W: { en: 'west', pl: 'zachód' },
  SWITCH: { en: 'Switch', pl: 'Przełącznik' },
  G: { en: 'green', pl: 'zielony' },
  B: { en: 'blue', pl: 'niebieski' },
  R: { en: 'red', pl: 'czerwony' },
  Y: { en: 'yellow', pl: 'żółty' },
  ONCE: { en: 'once', pl: 'jednorazowy' },
  MANY: { en: 'multi', pl: 'multi' },
  ORANGE: { en: 'orange', pl: 'pomarańczowy' },
  TIME: { en: 'timed', pl: 'czasowy' },
  CHECK: { en: 'checkpoint', pl: 'checkpoint' },
  SECRET: { en: 'secret', pl: 'sekretny' },
  HOLD: { en: 'hold', pl: 'przytrzymywany' },
  PYRAMID: { en: 'Pyramid', pl: 'Piramida' },
  GREEN: { en: 'green', pl: 'zielona' },
  RED: { en: 'red', pl: 'czerwona' },
  GEM: { en: 'gem', pl: 'klejnot' },
};

/** Readable tile name built from the identifier (SWITCH_G_HOLD → "Switch green hold"). */
export function tileLabel(name: string): string {
  const l = lang();
  const parts = name.split('_');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p === 'W' && parts[0] === 'SWITCH') {
      out.push(l === 'pl' ? 'biały' : 'white');
      continue;
    }
    if (p === 'LO' && parts[0] === 'SWITCH') {
      out.push(l === 'pl' ? '(wciśnięty)' : '(pressed)');
      continue;
    }
    out.push(WORDS[p]?.[l] ?? p.toLowerCase());
  }
  return out.join(' ');
}

export function groupLabel(id: TileGroupId): string {
  return t(`editor.tileGroups.${id}` as Key);
}
