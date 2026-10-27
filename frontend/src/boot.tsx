// Arranque de la app, cargado por main.tsx una vez elegido el idioma.
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { reloadOnce } from "@/components/route-error";
import { createQueryClient } from "@/lib/query-client";
import { initSentry } from "@/lib/sentry";
import { watchSystemTheme } from "@/lib/theme";
import { createRouter } from "./router";

export function boot(root: HTMLElement) {
  // Vite avisa cuando no puede descargar un chunk (despliegue nuevo): se recarga una sola vez.
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnce()) event.preventDefault();
  });
  void initSentry();
  // Service worker mínimo para poder instalar la app (solo en producción: en desarrollo molestaría).
  // Acá la página ya cargó: se registra directamente.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
  watchSystemTheme();
  const queryClient = createQueryClient();
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createRouter()} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
