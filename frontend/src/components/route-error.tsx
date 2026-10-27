// Pantalla de error de ruta, en español. Un chunk que no se puede descargar (típico tras un
// despliegue nuevo: el navegador conserva un índice viejo) se arregla recargando: se hace una sola
// vez, marcada en la URL; si vuelve a fallar, se muestra el error con un botón para reintentar.
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Logo } from "@/components/ui/display";
import { texts } from "@/i18n";

const RELOAD_PARAM = "recargado";
const CHUNK_ERROR =
  /dynamically imported module|importing a module script|error loading dynamically/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR.test(error.message);
}

/** Recarga la página una vez; devuelve false si ya se había recargado. */
export function reloadOnce(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.has(RELOAD_PARAM)) return false;
  url.searchParams.set(RELOAD_PARAM, "1");
  window.location.replace(url.toString());
  return true;
}

/** Quita la marca de la URL una vez que la app cargó bien. */
export function clearReloadMark(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RELOAD_PARAM)) return;
  url.searchParams.delete(RELOAD_PARAM);
  window.history.replaceState(null, "", url.toString());
}

export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  const reloading = chunk && reloadOnce();
  useEffect(() => {
    if (!chunk) console.error(error);
  }, [chunk, error]);
  if (reloading) return null;
  const t = texts.shell.routeError;
  return (
    <div className="flex min-h-dvh flex-col bg-surface px-4 py-6">
      <Logo />
      <main className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={TriangleAlert}
          title={chunk ? t.updatedTitle : t.title}
          action={
            <Button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete(RELOAD_PARAM);
                window.location.replace(url.toString());
              }}
            >
              {t.reload}
            </Button>
          }
        >
          {chunk ? t.updatedText : t.text}
        </EmptyState>
      </main>
    </div>
  );
}
