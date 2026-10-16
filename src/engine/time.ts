// Case time is integer minutes since 00:00 of the case date, rendered as UTC so every viewer sees 03:14.

export function caseEpochMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function minuteToMs(date: string, minute: number): number {
  return caseEpochMs(date) + minute * 60_000;
}

export function msToMinute(date: string, ms: number): number {
  return Math.floor((ms - caseEpochMs(date)) / 60_000);
}

export function clockLabel(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function clockLabelSeconds(date: string, ms: number): string {
  const day = 86_400_000;
  const t = (((ms - caseEpochMs(date)) % day) + day) % day;
  const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
  return `${pad(t / 3_600_000)}:${pad((t / 60_000) % 60)}:${pad((t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}

// Durations as PromQL writes them: 30s, 5m, 1h, 2h30m.
export function parseDurationMinutes(text: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text.trim());
  if (!match || text.trim() === '') return null;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60;
}
