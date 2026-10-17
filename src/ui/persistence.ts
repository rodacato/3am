import type { Snapshot } from 'xstate';
import type { Board, Postmortem } from '../engine/board';

export const STORAGE_KEY = '3am';
export const STORAGE_VERSION = 1;

export type Preferences = { locale: string | null; sound: boolean; tourSeen?: boolean };

export type CaseSession = {
  seed: number;
  machine: Snapshot<unknown> | null;
  board: Board;
  postmortem: Postmortem;
  statusDraft: string;
};

export type CaseProgress = { completed: boolean; runs: number; bestMitigationMin: number | null };

export type Stored = {
  version: typeof STORAGE_VERSION;
  preferences: Preferences;
  progress: Record<string, CaseProgress>;
  sessions: Record<string, CaseSession>;
};

export const EMPTY: Stored = { version: STORAGE_VERSION, preferences: { locale: null, sound: false }, progress: {}, sessions: {} };

// One entry per shape change: migrations[n] upgrades version n to n + 1.
const migrations: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrate(raw: unknown): Stored {
  if (!raw || typeof raw !== 'object') return structuredClone(EMPTY);
  let data = raw as Record<string, unknown>;
  let version = typeof data.version === 'number' ? data.version : 0;
  if (version > STORAGE_VERSION) return structuredClone(EMPTY);
  while (version < STORAGE_VERSION) {
    const step = migrations[version];
    if (!step) return structuredClone(EMPTY);
    data = step(data);
    version += 1;
  }
  return { ...structuredClone(EMPTY), ...(data as Partial<Stored>), version: STORAGE_VERSION };
}

export function load(): Stored {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return migrate(text ? JSON.parse(text) : null);
  } catch {
    return structuredClone(EMPTY);
  }
}

export function save(data: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be full or blocked in an iframe; the course still runs, it just forgets.
  }
}

export function clearAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above: nothing to clear if storage is unavailable.
  }
}
