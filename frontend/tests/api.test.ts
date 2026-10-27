// Cliente HTTP: token en memoria, un solo refresh compartido, un reintento, Web Locks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, setAccessToken } from "@/auth/token-store";
import { api, ApiError, onSessionExpired, refreshAccessToken } from "@/lib/api";
import { apiError, json, mockFetch } from "./helpers";

beforeEach(() => {
  setAccessToken("viejo");
});

afterEach(() => {
  setAccessToken(null);
});

describe("api", () => {
  it("manda el access token y devuelve el JSON", async () => {
    const calls = mockFetch(() => json(200, { ok: true }));
    await expect(api("/w/empresa/overview")).resolves.toEqual({ ok: true });
    expect(calls[0]?.headers.authorization).toBe("Bearer viejo");
  });

  it("ante 401 UNAUTHENTICATED refresca una vez y reintenta con el token nuevo", async () => {
    const calls = mockFetch((call) => {
      if (call.path === "/auth/refresh") return json(200, { accessToken: "nuevo" });
      return call.headers.authorization === "Bearer nuevo"
        ? json(200, { ok: true })
        : apiError(401, "UNAUTHENTICATED");
    });
    await expect(api("/w/empresa/overview")).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual([
      "/w/empresa/overview",
      "/auth/refresh",
      "/w/empresa/overview",
    ]);
    expect(getAccessToken()).toBe("nuevo");
  });

  it("el refresh lleva X-Requested-With y requests simultáneos comparten uno solo", async () => {
    const calls = mockFetch(async (call) => {
      if (call.path === "/auth/refresh") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(200, { accessToken: "nuevo" });
      }
      return call.headers.authorization === "Bearer nuevo"
        ? json(200, {})
        : apiError(401, "UNAUTHENTICATED");
    });
    await Promise.all([api("/a"), api("/b"), api("/c")]);
    const refreshes = calls.filter((c) => c.path === "/auth/refresh");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.headers["x-requested-with"]).toBe("spiderfolio");
  });

  it("si el refresh falla, no reintenta, borra el token y avisa que la sesión venció", async () => {
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    const calls = mockFetch((call) =>
      call.path === "/auth/refresh"
        ? apiError(401, "UNAUTHENTICATED")
        : apiError(401, "UNAUTHENTICATED"),
    );
    await expect(api("/w/empresa/overview")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(calls).toHaveLength(2);
    expect(getAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    stop();
  });

  it("nunca refresca ante INVALID_CREDENTIALS", async () => {
    const calls = mockFetch(() =>
      apiError(401, "INVALID_CREDENTIALS", "Email o contraseña incorrectos."),
    );
    await expect(api("/auth/change-password", { method: "POST", body: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(calls.map((c) => c.path)).toEqual(["/auth/change-password"]);
  });

  it("tampoco refresca en el propio login", async () => {
    const calls = mockFetch(() => apiError(401, "UNAUTHENTICATED"));
    await expect(api("/auth/login", { method: "POST", body: {} })).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("coordina el refresh entre pestañas con navigator.locks", async () => {
    const request = vi.fn((_name: string, run: () => Promise<boolean>) => run());
    // Hereda de navigator (un spread perdería su prototipo) y solo reemplaza locks.
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator) as Navigator, { locks: { request } }),
    );
    mockFetch(() => json(200, { accessToken: "nuevo" }));
    await expect(refreshAccessToken()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith("spiderfolio-refresh", expect.any(Function));
  });

  it("nunca guarda el token en localStorage ni sessionStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockFetch((call) =>
      call.path === "/auth/refresh" ? json(200, { accessToken: "nuevo" }) : json(200, {}),
    );
    await refreshAccessToken();
    await api("/w/empresa/overview");
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
