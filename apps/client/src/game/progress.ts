const KEY = 'gruntz.progress';

export interface Progress {
  completed: string[];
  /** Secret letters (W, A, R, P) found per level, kept at their best. */
  letters: Record<string, string>;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      return { completed: p.completed ?? [], letters: p.letters ?? {} };
    }
  } catch {
    /* ignore */
  }
  return { completed: [], letters: {} };
}

export function markCompleted(levelId: string, letters = ''): void {
  const p = loadProgress();
  if (!p.completed.includes(levelId)) p.completed.push(levelId);
  const had = new Set(p.letters[levelId] ?? '');
  for (const l of letters) had.add(l);
  p.letters[levelId] = [...had].sort().join('');
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Letters found across a world's levels. */
export function worldLetters(progress: Progress, levelIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of levelIds) for (const l of progress.letters[id] ?? '') out.add(l);
  return out;
}

/** A world's secret level opens once all four warp letters were found in it. */
export function secretUnlocked(progress: Progress, levelIds: string[]): boolean {
  const found = worldLetters(progress, levelIds);
  return ['W', 'A', 'R', 'P'].every(l => found.has(l));
}
