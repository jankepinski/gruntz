import { en } from './en.ts';
import { pl } from './pl.ts';

export type Lang = 'en' | 'pl';
export type Dict = typeof en;
const dicts: Record<Lang, unknown> = { en, pl };

const STORAGE_KEY = 'gruntz.lang';
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

let current: Lang = detect();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  for (const l of listeners) l();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];
export type Key = Path<Dict>;

function lookup(d: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], d);
  return typeof v === 'string' ? v : undefined;
}

/** Translate a key, with {placeholders}. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let text = lookup(dicts[current], key) ?? lookup(dicts.en, key) ?? key;
  if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

/** Translate an item / tile / AI identifier (e.g. GAUNTLETZ) with a fallback to a nice name. */
export function itemName(id: string): string {
  return (
    lookup(dicts[current], `items.${id}`) ?? lookup(dicts.en, `items.${id}`) ?? id.charAt(0) + id.slice(1).toLowerCase()
  );
}

export function aiName(id: string): string {
  return lookup(dicts[current], `ai.${id}`) ?? lookup(dicts.en, `ai.${id}`) ?? id;
}

export function localized(text: { en: string; pl: string }): string {
  return text[current] ?? text.en;
}
