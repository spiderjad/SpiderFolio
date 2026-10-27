// Idioma de la app. El catálogo activo se elige al arrancar, antes de cargar el resto de la app
// (main.tsx), así que los módulos pueden leer `texts` incluso fuera de los componentes. Cambiar de
// idioma recarga la página. Para sumar un idioma (ej. pt-BR): su carpeta con la misma forma que
// es/, su entrada en LOCALES, LOCALE_NAMES y `loaders`, y en el backend (src/i18n/locales.ts).
import { es } from "./es";

/** Mismo tipo que el catálogo de referencia (es/), pero con textos libres en lugar de literales. */
export type Catalog<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Catalog<R>
    : T extends readonly (infer U)[]
      ? readonly Catalog<U>[]
      : T extends object
        ? { readonly [K in keyof T]: Catalog<T[K]> }
        : T;

export type Messages = Catalog<typeof es>;

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Cada idioma con su propio nombre (así se encuentra aunque la app esté en otro). */
export const LOCALE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

const loaders: Record<Locale, () => Promise<Messages>> = {
  es: () => Promise.resolve(es),
  en: () => import("./en").then((module) => module.en),
};

const STORAGE_KEY = "spiderfolio.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// Enlaces vivos (ES modules): quien importa `texts` o `locale` ve siempre el idioma activo.
export let texts: Messages = es;
export let locale: Locale = "es";

/**
 * El idioma con el que arranca la app: el último que usó la persona en este navegador (no es un
 * dato sensible; ver lib/theme.ts) o, si no hay, el del navegador.
 */
export function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Sin acceso al almacenamiento: se sigue con el navegador.
  }
  for (const language of navigator.languages) {
    const base = language.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "es";
}

export async function activateLocale(next: Locale): Promise<void> {
  texts = await loaders[next]();
  locale = next;
  document.documentElement.lang = next;
}

/**
 * Pasa al idioma que corresponde (el de la persona o el de su empresa). Si cambia, lo recuerda y
 * recarga: los textos se leen al cargar los módulos.
 */
export function switchLocale(next: Locale): void {
  if (next === locale) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    return;
  }
  window.location.reload();
}
