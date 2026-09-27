import { useEffect, useState } from 'preact/hooks';
import { EyeOff, Minimize2, Palette, Vibrate } from 'lucide-preact';
import { thumbnails } from '../render/thumbnails.ts';

/** Curses have no model: a symbol on a dark medallion. */
const CURSE_ICONS: Record<string, typeof EyeOff> = {
  BLACKSCREEN: EyeOff,
  MINICAM: Minimize2,
  RANDOMCOLORZ: Palette,
  SCREENSHAKE: Vibrate,
};

/** Re-render when new 3D thumbnails arrive. */
export function useThumbnails(): void {
  const [, force] = useState(0);
  useEffect(() => thumbnails.subscribe(() => force(n => n + 1)), []);
}

// Temporary emoji icons. They get replaced by item renders made in Blender (assets pipeline).
const ICONS: Record<string, string> = {
  GAUNTLETZ: '🥊',
  SHOVEL: '⛏',
  CLUB: '🏏',
  SWORD: '🗡',
  GLOVEZ: '🥊',
  SPRING: '〰',
  TOOB: '🛟',
  WINGZ: '🪽',
  GRAVITYBOOTZ: '🥾',
  BOOMERANG: '🪃',
  ROCK: '🪨',
  NERFGUN: '🔫',
  GUNHAT: '🪖',
  WELDER: '🔥',
  SHIELD: '🛡',
  BRICK: '🧱',
  TIMEBOMB: '💣',
  BOMB: '💥',
  GOOBER: '🥤',
  SPY: '🥽',
  WAND: '🪄',
  WARPSTONE: '💎',
  BABYWALKER: '🛞',
  BEACHBALL: '🏐',
  BIGWHEEL: '🎡',
  GOKART: '🏎',
  JACKINTHEBOX: '🎁',
  JUMPROPE: '➰',
  POGOSTICK: '🦘',
  SCROLL: '📜',
  SQUEAKTOY: '🐤',
  YOYO: '🪀',
  GHOST: '👻',
  SUPERSPEED: '⚡',
  INVULNERABILITY: '✨',
  CONVERSION: '🪧',
  DEATHTOUCH: '☠',
  ROIDZ: '💊',
  REACTIVEARMOR: '🦾',
  MEGAPHONE: '📣',
  HEALTH1: '🥫',
  HEALTH2: '🍾',
  HEALTH3: '🛢',
  STOPWATCH: '⏱',
  TOYBOX: '🎁',
  COIN: '🪙',
};

export function itemIcon(item: string): string {
  return ICONS[item] ?? '❔';
}

/** Rendered item icon (made in Blender), with the emoji as a fallback. */
export function ItemImg({ item, size = 28 }: { item: string; size?: number }) {
  const id = item === 'TOOBWATER' ? 'TOOB' : item;
  const Curse = CURSE_ICONS[id];
  if (Curse) {
    return (
      <span class="curse-icon" style={{ width: `${size}px`, height: `${size}px` }}>
        <Curse size={Math.round(size * 0.55)} strokeWidth={2.2} />
      </span>
    );
  }
  return (
    <img
      class="item-img"
      src={`/icons/${id}.png`}
      width={size}
      height={size}
      alt={itemIcon(id)}
      draggable={false}
      onError={e => {
        const img = e.currentTarget as HTMLImageElement;
        img.replaceWith(document.createTextNode(itemIcon(id)));
      }}
    />
  );
}
