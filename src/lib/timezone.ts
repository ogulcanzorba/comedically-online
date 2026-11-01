/** IANA-zone conversions with zero date libraries. */

export const COMMON_TIMEZONES = [
  'UTC',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
];

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock date+time in `timeZone` to a UTC ISO string.
 * Returns null on bad input. Ambiguous DST-fall-back hours resolve to the
 * first occurrence; nonexistent spring-forward times drift forward ~1h.
 */
export function localToUtcIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !isValidZone(timeZone)) {
    return null;
  }
  const [Y, M, D] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59) return null;
  const wall = Date.UTC(Y, M - 1, D, h, m);
  let guess = wall - zonedOffsetMs(timeZone, wall);
  for (let i = 0; i < 2; i++) {
    const refined = wall - zonedOffsetMs(timeZone, guess);
    if (refined === guess) break;
    guess = refined;
  }
  return new Date(guess).toISOString();
}

/** Split a UTC instant into wall-clock date+time parts in `timeZone` (edit-form prefill). */
export function utcToZonedInput(utcIso: string, timeZone: string): { date: string; time: string } | null {
  if (!isValidZone(timeZone)) return null;
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return null;
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
