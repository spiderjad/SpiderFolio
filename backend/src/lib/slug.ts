// Slugs de workspace (CLAUDE.md, sección 7.3): sin acentos, minúsculas y guiones; reservados
// y colisiones se resuelven con sufijos -2, -3…
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "api",
  "admin",
  "login",
  "register",
  "settings",
  "www",
  "help",
  "status",
]);

const MAX_LENGTH = 48;

export function slugify(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? "empresa" : slug;
}

/** Primer slug libre para la base: base, base-2, base-3… (nunca uno reservado). */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!RESERVED_SLUGS.has(base) && !taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${String(n)}`;
    const candidate = `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
