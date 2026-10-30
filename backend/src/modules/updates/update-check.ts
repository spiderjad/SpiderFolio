// «There's a new version of SpiderFolio» (Administration, owner only): at most once a day the server asks
// GitHub for the latest release of the core and compares it with its own version (SPIDERFOLIO_VERSION,
// set in the image). A plain GET that sends nothing about the installation; UPDATE_CHECK=false turns it
// off. Kept in memory: a restart only means asking again.
import { compareVersions } from "@spiderfolio/plugin-sdk";

export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/spiderjad/SpiderFolio/releases/latest";
const CHECK_EVERY_MS = 24 * 3600_000;
/** After a failed check (no internet, GitHub down), try again sooner. */
const RETRY_AFTER_MS = 6 * 3600_000;
const TIMEOUT_MS = 5000;
const VERSION = /^\d+\.\d+\.\d+$/u;

export interface UpdateNotice {
  current: string;
  latest: string;
  /** The release notes on GitHub. */
  notesUrl: string;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function createUpdateChecker(
  env: { UPDATE_CHECK: boolean; SPIDERFOLIO_VERSION: string },
  options: { fetcher?: Fetcher; now?: () => number } = {},
) {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  let checkedAt: number | null = null;
  let retryAt = 0;
  let latest: { version: string; notesUrl: string } | null = null;
  let pending: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const response = await fetcher(LATEST_RELEASE_URL, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `SpiderFolio/${env.SPIDERFOLIO_VERSION}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
      const tag = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/u, "") : "";
      const url = typeof body.html_url === "string" ? body.html_url : "";
      if (!VERSION.test(tag) || !url.startsWith("https://github.com/")) {
        throw new Error("Respuesta inesperada");
      }
      latest = { version: tag, notesUrl: url };
      checkedAt = now();
    } catch {
      retryAt = now() + RETRY_AFTER_MS;
    }
  }

  return {
    /** The newer version, if there is one; null if not, if unknown or if checking is off. */
    async notice(): Promise<UpdateNotice | null> {
      const current = env.SPIDERFOLIO_VERSION;
      if (!env.UPDATE_CHECK || !VERSION.test(current)) return null;
      const stale = checkedAt === null || now() - checkedAt >= CHECK_EVERY_MS;
      if (stale && now() >= retryAt) {
        pending ??= refresh().finally(() => {
          pending = null;
        });
        await pending;
      }
      if (latest === null || compareVersions(latest.version, current) <= 0) return null;
      return { current, latest: latest.version, notesUrl: latest.notesUrl };
    },
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
