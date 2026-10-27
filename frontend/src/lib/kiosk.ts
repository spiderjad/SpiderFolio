// Tablets compartidas (CLAUDE.md, sección 7.6): el navegador recuerda solo el workspace de la
// última persona que entró con PIN (nunca el usuario), para volver al teclado al cerrar la sesión.
const KEY = "spiderfolio-kiosk-workspace";

export function rememberKioskWorkspace(slug: string): void {
  try {
    window.localStorage.setItem(KEY, slug);
  } catch {
    // Sin almacenamiento (modo privado): al cerrar la sesión se vuelve al inicio normal.
  }
}

export function readKioskWorkspace(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetKioskWorkspace(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nada que borrar.
  }
}

/** Dónde vuelve el navegador al cerrarse una sesión: el teclado de la tablet o el login. */
export function signedOutPath(wasKiosk: boolean, slug: string | null): string {
  return wasKiosk && slug !== null ? `/entrar/${encodeURIComponent(slug)}` : "/login";
}
