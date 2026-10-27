// Sentry del frontend (CLAUDE.md, sección 12A.4): solo si hay VITE_SENTRY_DSN y sin datos
// personales ni contenido. Sin Replay ni trazas. Las URLs viajan sin query ni fragmento (ahí
// van los tokens de verificación y restablecimiento) y los breadcrumbs, sin datos.

export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[url]";
  }
}

/** Sin DSN no se descarga el SDK (import dinámico). */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn === undefined || dsn === "") return;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeSend(event) {
      if (event.request?.url !== undefined) event.request.url = scrubUrl(event.request.url);
      delete event.user;
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Consola y UI pueden traer contenido; navegación y requests, solo la ruta.
      if (breadcrumb.category === "console" || breadcrumb.category?.startsWith("ui.") === true) {
        return null;
      }
      const data = breadcrumb.data as Record<string, unknown> | undefined;
      const scrubbed: Record<string, unknown> = {};
      for (const key of ["url", "from", "to"]) {
        const value = data?.[key];
        if (typeof value === "string") scrubbed[key] = scrubUrl(value);
      }
      if (typeof data?.status_code === "number") scrubbed.status_code = data.status_code;
      if (typeof data?.method === "string") scrubbed.method = data.method;
      const clean = { ...breadcrumb, data: scrubbed };
      delete clean.message;
      return clean;
    },
  });
}
