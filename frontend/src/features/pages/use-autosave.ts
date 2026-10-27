// Autoguardado de una página con control de conflictos (revisión optimista). Cada cambio del
// editor arma un guardado a los 1,5 s; hay uno en vuelo a la vez, y si el texto cambió mientras
// tanto se guarda otra vez. Un 409 significa que otra persona guardó antes: se detiene y se ofrece
// elegir (ver lo último, copiar lo propio o sobrescribir). Sin red se reintenta solo.
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { pagesApi, type WithoutAccess } from "@/features/files/api";
import { ApiError, NetworkError } from "@/lib/api";

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";

const DEBOUNCE_MS = 1500;
const RETRY_MS = [4000, 8000, 16000, 30000];

export function useAutosave({
  slug,
  pageId,
  editor,
  initialRevision,
  onWithoutAccess,
}: {
  slug: string;
  pageId: string;
  editor: Editor | null;
  initialRevision: number;
  /** Personas mencionadas que no ven la página (no recibieron el aviso). */
  onWithoutAccess?: (people: WithoutAccess) => void;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const revision = useRef(initialRevision);
  const changes = useRef(0); // cuántos cambios hubo (para saber si cambió algo durante un guardado)
  const inFlight = useRef(false);
  const blocked = useRef(false); // conflicto: no se guarda hasta que la persona elija
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRef = useRef<SaveState>("saved");
  const onWithoutAccessRef = useRef(onWithoutAccess);
  onWithoutAccessRef.current = onWithoutAccess;

  const show = useCallback((next: SaveState, text: string | null = null) => {
    stateRef.current = next;
    setState(next);
    setMessage(text);
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    if (editor === null || editor.isDestroyed || blocked.current) return;
    if (inFlight.current) return;
    clearTimeout(timer.current);
    const sentAt = changes.current;
    inFlight.current = true;
    show("saving");
    try {
      const result = await pagesApi.save(slug, pageId, {
        baseRevision: revision.current,
        content: editor.getJSON(),
      });
      revision.current = result.revision;
      retries.current = 0;
      if (result.withoutAccess.length > 0) onWithoutAccessRef.current?.(result.withoutAccess);
      inFlight.current = false;
      if (changes.current !== sentAt) {
        // Se siguió escribiendo mientras se guardaba.
        show("dirty");
        void flush();
      } else {
        show("saved");
      }
    } catch (error) {
      inFlight.current = false;
      if (error instanceof NetworkError) {
        show("offline");
        const wait = RETRY_MS[Math.min(retries.current, RETRY_MS.length - 1)] ?? 30000;
        retries.current += 1;
        timer.current = setTimeout(() => {
          void flush();
        }, wait);
      } else if (error instanceof ApiError && error.status === 409) {
        blocked.current = true;
        show("conflict");
      } else {
        show("error", error instanceof ApiError ? error.message : null);
      }
    }
  }, [editor, pageId, show, slug]);

  // Cada cambio del texto arma un guardado.
  useEffect(() => {
    if (editor === null) return;
    const onUpdate = () => {
      changes.current += 1;
      if (blocked.current) return;
      show("dirty");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, flush, show]);

  // Al volver la red, al ocultar la pestaña y al salir se guarda lo pendiente.
  useEffect(() => {
    const pending = () => stateRef.current === "dirty" || stateRef.current === "offline";
    const onOnline = () => {
      if (pending()) void flush();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && pending()) void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (stateRef.current !== "saved") event.preventDefault();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Al cambiar de pantalla: lo último que se escribió no se pierde.
      clearTimeout(timer.current);
      if (stateRef.current === "dirty") void flush();
    };
  }, [flush]);

  /** Descarta lo propio y se queda con lo último que guardó la otra persona. */
  const reloadLatest = useCallback(async () => {
    if (editor === null) return;
    const { page } = await pagesApi.get(slug, pageId);
    editor.commands.setContent(page.content as Record<string, unknown>, { emitUpdate: false });
    revision.current = page.revision;
    blocked.current = false;
    show("saved");
  }, [editor, pageId, show, slug]);

  /** Guarda lo propio encima de lo último (pisa lo de la otra persona: es una decisión explícita). */
  const overwrite = useCallback(async () => {
    const { page } = await pagesApi.get(slug, pageId);
    revision.current = page.revision;
    blocked.current = false;
    await flush();
  }, [flush, pageId, slug]);

  return { state, message, flush, reloadLatest, overwrite };
}
