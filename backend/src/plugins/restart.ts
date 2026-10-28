// Orderly restart of the API and the worker to load newly installed plugins (docs/spec/plugins.md
// «Reiniciar ahora»). The plan lives in a file in the plugins folder both processes share (the plugins
// volume in Docker), so it needs no table and no queue: each process checks it every few seconds and,
// once the announced time comes, closes in order and exits with RESTART_EXIT_CODE. Whatever supervises
// it (Docker's restart policy, the dev watcher) starts it again. A process ignores plans made before it
// started, so it never restarts twice for the same one.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const RESTART_FILE = ".restart.json";
/** Response header with the announced time (ISO); the app reads it (frontend/src/lib/restart.ts). */
export const RESTART_HEADER = "X-SpiderFolio-Restart-At";
/** EX_TEMPFAIL: «exited to be started again» (the dev watcher restarts on it). */
export const RESTART_EXIT_CODE = 75;
/** Notice users get before the restart, to save what they are editing. */
export const RESTART_NOTICE_MS = 60_000;
const CHECK_EVERY_MS = 2_000;

const PlanSchema = z.object({
  requestedAt: z.iso.datetime(),
  restartAt: z.iso.datetime(),
});
export type RestartPlan = z.infer<typeof PlanSchema>;

export function readRestartPlan(dir: string): RestartPlan | null {
  try {
    return PlanSchema.parse(JSON.parse(readFileSync(join(dir, RESTART_FILE), "utf8")));
  } catch {
    return null;
  }
}

/** Writes the plan atomically (temporary file + rename): a process never reads half of it. */
export function scheduleRestart(dir: string, now: Date = new Date()): RestartPlan {
  const plan: RestartPlan = {
    requestedAt: now.toISOString(),
    restartAt: new Date(now.getTime() + RESTART_NOTICE_MS).toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, `.restart-${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(plan));
  renameSync(temporary, join(dir, RESTART_FILE));
  return plan;
}

export interface RestartWatch {
  /** The plan this process will follow (made after it started), or null. */
  pending(): RestartPlan | null;
  stop(): void;
}

/** Follows the plan: `onRestart` runs once, when the announced time comes. */
export function watchRestart(input: {
  dir: string;
  startedAt?: Date;
  now?: () => Date;
  onRestart: () => void;
}): RestartWatch {
  const startedAt = (input.startedAt ?? new Date()).getTime();
  const now = input.now ?? (() => new Date());
  let pending: RestartPlan | null = null;
  let fired = false;
  const check = () => {
    const plan = readRestartPlan(input.dir);
    pending = plan !== null && new Date(plan.requestedAt).getTime() > startedAt ? plan : null;
    if (pending !== null && !fired && now().getTime() >= new Date(pending.restartAt).getTime()) {
      fired = true;
      input.onRestart();
    }
  };
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  timer.unref();
  return {
    pending: () => pending,
    stop: () => {
      clearInterval(timer);
    },
  };
}
