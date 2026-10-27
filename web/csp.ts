// Fuente única de la CSP de la web pública (CLAUDE.md, sección 12): en el hosting la pone
// public/.htaccess (scripts/check-dist.ts verifica que sea idéntica a esta)
// y la usan los E2E. Sin scripts ni estilos en línea; 'wasm-unsafe-eval' solo para el WebAssembly
// de Pagefind (búsqueda de /docs), que no habilita eval de texto.
export function cspHeader(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
