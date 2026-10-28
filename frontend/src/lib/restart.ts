// Announced server restart (backend/src/plugins/restart.ts): while it is pending, every API response
// carries its time in RESTART_HEADER, and the app shows a notice so people save what they're editing.
// The first response without it after that time means the restart is done.
import { useSyncExternalStore } from "react";

export const RESTART_HEADER = "X-SpiderFolio-Restart-At";

let restartAt: string | null = null;
const listeners = new Set<() => void>();

/** Called with the header of every API response (null if it doesn't carry it). */
export function noteRestart(value: string | null): void {
  if (value === restartAt) return;
  // A response without the header before the announced time (another tab's request in flight,
  // a cached reply) doesn't cancel the notice: only once the time has come.
  if (value === null && restartAt !== null && Date.now() < new Date(restartAt).getTime()) return;
  restartAt = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The announced restart time (ISO), or null. */
export function useRestartAt(): string | null {
  return useSyncExternalStore(subscribe, () => restartAt);
}
