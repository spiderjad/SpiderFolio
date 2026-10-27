// Content-Security-Policy de la app (CLAUDE.md, sección 12). Fuente única: la usa el
// servidor de los tests E2E y la va a usar el Caddyfile de producción (sección 15).
//
// script-src es estricto: solo archivos propios, nada en línea ni eval.
// style-src admite 'unsafe-inline' (la sección 12 lo prohíbe solo en scripts): sonner inyecta
// un <style> al cargarse y Radix (Dialog, Sheet, DropdownMenu) inyecta estilos dinámicos para
// bloquear el scroll, que no se pueden autorizar con un hash. El acento por workspace usa
// style.setProperty (CSSOM), que no depende de esta directiva.
//
// El origen de S3 (el de las URLs prefirmadas de subida y descarga) se agrega a connect-src (subir
// y leer texto), img-src (imágenes) y frame-src (vista previa de PDF): el origen exacto de la
// configuración, local o de producción, sin comodines.
export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // El service worker (PWA) y el manifiesto son archivos propios.
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
} as const;

type Directives = Record<string, readonly string[]>;

/**
 * Origen de las URLs prefirmadas según la configuración de S3 (las mismas variables que usa el
 * backend). Con S3_ENDPOINT y estilo de ruta, es el endpoint; con estilo de host virtual (R2), el
 * bucket pasa a ser parte del host. Sin endpoint, el de AWS.
 */
export function storageOriginFromEnv(env: Record<string, string | undefined>): string | null {
  const bucket = env.S3_BUCKET;
  const endpoint = env.S3_ENDPOINT === "" ? undefined : env.S3_ENDPOINT;
  const region = env.S3_REGION;
  if (bucket === undefined || bucket === "") return null;
  if (endpoint === undefined) {
    return region === undefined || region === ""
      ? null
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  }
  const url = new URL(endpoint);
  return env.S3_FORCE_PATH_STYLE === "true" ? url.origin : `${url.protocol}//${bucket}.${url.host}`;
}

/** Las directivas de la política, con el origen de S3 donde hace falta. */
export function cspDirectives(storageOrigin: string | null = null): Directives {
  const base: Directives = CSP_DIRECTIVES;
  if (storageOrigin === null) return base;
  return {
    ...base,
    "img-src": [...CSP_DIRECTIVES["img-src"], storageOrigin],
    "connect-src": [...CSP_DIRECTIVES["connect-src"], storageOrigin],
    "frame-src": [storageOrigin],
  };
}

export function cspHeader(storageOrigin: string | null = null): string {
  return Object.entries(cspDirectives(storageOrigin))
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}
