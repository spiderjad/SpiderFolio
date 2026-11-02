// Expiry rules without the database (docs/spec/seguridad-salud.md, «Motor de vencimientos»): days
// between company days, the state of an expiry and which notice thresholds a day reaches.

/** Days from `today` to `dueOn` (both «YYYY-MM-DD» company days): negative once it's past. */
export function daysUntil(today: string, dueOn: string): number {
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${dueOn}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export type ExpiryState = "valid" | "due_soon" | "expired";

/** Expired the day after `dueOn`; due soon from the largest threshold (it expires at the day's end). */
export function expiryState(
  today: string,
  dueOn: string,
  noticeDays: readonly number[],
): ExpiryState {
  const left = daysUntil(today, dueOn);
  if (left < 0) return "expired";
  return left <= Math.max(0, ...noticeDays) ? "due_soon" : "valid";
}

/**
 * The thresholds reached with `left` days to go that weren't notified yet. One notice covers all of
 * them (an expiry created already expired, or a missed day, gives a single notice): `notify` says
 * whether to send it and `sent` is the new list of notified thresholds.
 */
export function noticeFor(
  left: number,
  noticeDays: readonly number[],
  alreadySent: readonly number[],
): { notify: boolean; sent: number[] } {
  const reached = noticeDays.filter((days) => left <= days);
  const pending = reached.filter((days) => !alreadySent.includes(days));
  return {
    notify: pending.length > 0,
    sent: [...new Set([...alreadySent, ...reached])].sort((a, b) => b - a),
  };
}

/** Notice days: whole days from 0 to 365, without repeats, largest first. */
export function cleanNoticeDays(days: readonly number[]): number[] {
  return [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 365))].sort(
    (a, b) => b - a,
  );
}
