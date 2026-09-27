import { useLayoutEffect, useState } from 'preact/hooks';
import { presetGraphics, type Graphics } from '../render/graphics.ts';

/** Minimal observable store for the UI. */
export class Store<S extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: S) {}

  get(): S {
    return this.state;
  }

  set(patch: Partial<S>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<S extends object>(store: Store<S>): S {
  const state = store.get();
  const [, force] = useState(0);
  useLayoutEffect(() => {
    const unsub = store.subscribe(() => force(n => n + 1));
    // The store may have changed between render and subscription.
    if (store.get() !== state) force(n => n + 1);
    return unsub;
  }, [store]);
  return state;
}

// --- settings ------------------------------------------------------------------------

export interface Settings {
  safePath: boolean;
  classicCamera: boolean;
  showLinks: boolean;
  edgeScroll: boolean;
  /** Legacy single quality switch (kept to migrate old saves into `graphics`). */
  quality: 'low' | 'medium' | 'high';
  graphics: Graphics;
  /** Bumped when the graphics defaults change, so old saves can be moved along. */
  graphicsVersion: number;
  playerName: string;
  volumes: { master: number; sfx: number; music: number; voices: number };
}

const SETTINGS_KEY = 'gruntz.settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    safePath: false,
    classicCamera: false,
    showLinks: true,
    edgeScroll: true,
    quality: 'high',
    graphics: presetGraphics('high'),
    graphicsVersion: 3,
    playerName: '',
    volumes: { master: 0.8, sfx: 0.8, music: 0.35, voices: 0.8 },
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // Older saves only had a quality switch: turn it into full graphics options.
      const graphics = saved.graphics
        ? { ...defaults.graphics, ...saved.graphics }
        : presetGraphics(saved.quality ?? 'high');
      graphics.resolution = Math.min(1, graphics.resolution);
      // v3: the medium and high presets grow velvet grass instead of tufts.
      if ((saved.graphicsVersion ?? 1) < 3 && graphics.grass === 'tufts' && graphics.shadows !== 'off')
        graphics.grass = 'velvet';
      return { ...defaults, ...saved, graphics, graphicsVersion: 3 };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export const settings = new Store<Settings>(loadSettings());
settings.subscribe(() => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.get()));
  } catch {
    /* ignore */
  }
});
