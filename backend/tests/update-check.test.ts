// «There's a new version» (modules/updates/update-check.ts): once a day at most, nothing when it's off or
// the version is unknown, and a failed check never shows anything wrong.
import { describe, expect, it, vi } from "vitest";
import { createUpdateChecker, LATEST_RELEASE_URL } from "../src/modules/updates/update-check.ts";

const release = (tag: string) =>
  new Response(
    JSON.stringify({
      tag_name: tag,
      html_url: `https://github.com/spiderjad/SpiderFolio/releases/tag/${tag}`,
    }),
    { status: 200 },
  );

function setup(
  env: { UPDATE_CHECK: boolean; SPIDERFOLIO_VERSION: string },
  answer: () => Response,
) {
  let clock = Date.UTC(2026, 9, 30, 9);
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(answer()),
  );
  const checker = createUpdateChecker(env, { fetcher, now: () => clock });
  return {
    checker,
    fetcher,
    advance: (hours: number) => {
      clock += hours * 3_600_000;
    },
  };
}

describe("aviso de versión nueva", () => {
  it("avisa de una versión más nueva, con el enlace a sus notas", async () => {
    const { checker, fetcher } = setup({ UPDATE_CHECK: true, SPIDERFOLIO_VERSION: "0.5.0" }, () =>
      release("v0.5.1"),
    );
    expect(await checker.notice()).toEqual({
      current: "0.5.0",
      latest: "0.5.1",
      notesUrl: "https://github.com/spiderjad/SpiderFolio/releases/tag/v0.5.1",
    });
    expect(fetcher).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.any(Object));
  });

  it("la misma versión, o una más vieja, no avisa", async () => {
    for (const tag of ["v0.5.0", "v0.4.9"]) {
      const { checker } = setup({ UPDATE_CHECK: true, SPIDERFOLIO_VERSION: "0.5.0" }, () =>
        release(tag),
      );
      expect(await checker.notice()).toBeNull();
    }
  });

  it("pregunta como mucho una vez por día", async () => {
    const { checker, fetcher, advance } = setup(
      { UPDATE_CHECK: true, SPIDERFOLIO_VERSION: "0.5.0" },
      () => release("v0.5.1"),
    );
    await Promise.all([checker.notice(), checker.notice()]);
    advance(23);
    await checker.notice();
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(1);
    await checker.notice();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("con UPDATE_CHECK=false o sin versión conocida no pregunta nada", async () => {
    for (const env of [
      { UPDATE_CHECK: false, SPIDERFOLIO_VERSION: "0.5.0" },
      { UPDATE_CHECK: true, SPIDERFOLIO_VERSION: "dev" },
    ]) {
      const { checker, fetcher } = setup(env, () => release("v9.9.9"));
      expect(await checker.notice()).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("si GitHub falla o responde algo raro no avisa, y reintenta a las 6 horas", async () => {
    let answer = () => new Response("", { status: 503 });
    const { checker, fetcher, advance } = setup(
      { UPDATE_CHECK: true, SPIDERFOLIO_VERSION: "0.5.0" },
      () => answer(),
    );
    expect(await checker.notice()).toBeNull();
    advance(1);
    await checker.notice();
    expect(fetcher).toHaveBeenCalledTimes(1);
    answer = () =>
      new Response(JSON.stringify({ tag_name: "v0.6.0", html_url: "https://evil.example/x" }));
    advance(5);
    expect(await checker.notice()).toBeNull();
    answer = () => release("v0.6.0");
    advance(6);
    expect((await checker.notice())?.latest).toBe("0.6.0");
  });
});
