import { useLayoutEffect, useState } from 'preact/hooks';

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
  quality: 'low' | 'medium' | 'high';
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
    playerName: '',
    volumes: { master: 0.8, sfx: 0.8, music: 0.35, voices: 0.8 },
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
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
