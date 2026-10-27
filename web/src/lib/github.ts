// Estrellas del repositorio en GitHub, leídas al compilar la web (sin llamadas desde el navegador: la
// CSP no las admite y no hace falta). Si no se puede leer (sin red, límite de la API), no se muestra.
import { SITE } from "../config/site.ts";

let cached: Promise<number | null> | undefined;

export function githubStars(): Promise<number | null> {
  cached ??= (async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${SITE.githubOrg}/${SITE.githubRepo}`,
        {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "spiderfolio-web" },
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as { stargazers_count?: unknown };
      return typeof body.stargazers_count === "number" ? body.stargazers_count : null;
    } catch {
      return null;
    }
  })();
  return cached;
}

/** 1234 → «1,2 k» / «1.2k». */
export function formatStars(count: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    count,
  );
}
