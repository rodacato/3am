import type { CaseProgress } from './persistence';

export type CaseState = 'closed' | 'open' | 'locked';
export type ShelfEntry = { id: string; number: number; state: CaseState };

const completed = (progress: Record<string, CaseProgress>, id: string | undefined) => id !== undefined && progress[id]?.completed === true;

// Cases open in order: the first is always open, each later one once the one before it is closed.
export function caseShelf(ids: readonly string[], progress: Record<string, CaseProgress>): ShelfEntry[] {
  return ids.map((id, i) => ({
    id,
    number: i + 1,
    state: completed(progress, id) ? 'closed' : i === 0 || completed(progress, ids[i - 1]) ? 'open' : 'locked',
  }));
}

export function isUnlocked(ids: readonly string[], progress: Record<string, CaseProgress>, id: string): boolean {
  return caseShelf(ids, progress).some((e) => e.id === id && e.state !== 'locked');
}

// The case the reader chose, if it is still open to them; otherwise the first one they have not closed.
export function currentCase(ids: readonly string[], progress: Record<string, CaseProgress>, chosen: string | undefined): string {
  if (chosen !== undefined && isUnlocked(ids, progress, chosen)) return chosen;
  const shelf = caseShelf(ids, progress);
  return (shelf.find((e) => e.state === 'open') ?? shelf[shelf.length - 1])?.id ?? '';
}

export function nextCase(ids: readonly string[], id: string): string | null {
  const i = ids.indexOf(id);
  return i >= 0 && i + 1 < ids.length ? (ids[i + 1] as string) : null;
}
