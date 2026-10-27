// Estado de una lista en la URL (CLAUDE.md, sección 17): filtros, orden y página viajan en la
// URL, así se pueden compartir y sobreviven al recargar. Los datos siempre los pagina el servidor.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

export const PAGE_SIZE = 25;

/** Número de página de un parámetro (1 si falta o no es válido). */
export function readPage(params: URLSearchParams, key = "page"): number {
  const page = Number(params.get(key) ?? "1");
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Valor de un parámetro, limitado a los permitidos (si no, el de por defecto). */
export function readChoice<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return allowed.find((choice) => choice === value) ?? fallback;
}

/**
 * Lee y cambia los parámetros de la URL. Un valor vacío quita el parámetro; cualquier cambio que
 * no sea de la página vuelve a la primera (`pageKey` es el parámetro de página de esa lista).
 */
export function useListParams(pageKey = "page") {
  const [params, setParams] = useSearchParams();
  const patch = useCallback(
    (changes: Record<string, string | number | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          if (!(pageKey in changes)) next.delete(pageKey);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, pageKey],
  );
  return { params, patch };
}

/**
 * Texto de búsqueda de una lista: se escribe sin demora y pasa a la URL (y al servidor) cuando se
 * deja de escribir.
 */
export function useSearchParam(
  key: string,
  current: string,
  patch: (changes: Record<string, string | number | undefined>) => void,
  delayMs = 300,
): [string, (value: string) => void] {
  const [text, setText] = useState(current);
  useEffect(() => {
    if (text.trim() === current) return;
    const timer = setTimeout(() => {
      patch({ [key]: text.trim() });
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
    // patch cambia con cada render de la lista: solo reaccionamos al texto.
  }, [text]);
  return [text, setText];
}
