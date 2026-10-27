// Monta la app real (rutas de src/router.tsx) en memoria, con fetch simulado.
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
// RouterProvider de "react-router" y no de "react-router/dom": en Vitest, /dom resuelve otra copia
// del paquete (con otro contexto) y los hooks no encuentran el router.
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import { routes } from "@/router";

export interface Call {
  path: string;
  /** Query string tal como llegó (con el ?, o vacía). */
  search: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const apiError = (status: number, code: string, message = "", details?: unknown) =>
  json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } });

/** Simula fetch: registra cada llamada y responde con el handler. */
export function mockFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, "http://localhost");
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call: Call = {
      path: url.pathname.replace(/^\/api\/v1/, ""),
      search: url.search,
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return await handler(call);
  });
  return calls;
}

export const account = (
  overrides: {
    emailVerified?: boolean;
    capabilities?: string[];
    base?: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
    email?: string;
    /** Sesión de tablet (usuario + PIN): sin email. */
    kiosk?: { idleSeconds: number; closeAfterConfirm: boolean };
  } = {},
) => ({
  user: {
    id: "u1",
    kind: overrides.kiosk === undefined ? "STANDARD" : "PIN",
    email: overrides.kiosk === undefined ? (overrides.email ?? "ana@empresa.com") : null,
    name: "Ana Ruiz",
    emailVerified: overrides.emailVerified ?? true,
    locale: "es",
    avatarKey: null,
  },
  kiosk: overrides.kiosk ?? null,
  memberships: [
    {
      id: "m1",
      seatType: "FULL",
      workspace: { id: "w1", name: "Empresa", slug: "empresa", accentColor: null, logoKey: null },
      role: { id: "r1", name: "Propietario", base: overrides.base ?? "OWNER" },
      capabilities: overrides.capabilities ?? [],
      departments: [],
    },
  ],
});

export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}
