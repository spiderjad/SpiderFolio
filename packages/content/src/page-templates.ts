// Plantillas de página: estructura ya armada (títulos, tablas, checklists) con textos de ejemplo en
// gris (marca `muted`) que se reemplazan escribiendo encima. Son modelos orientativos. Hay una
// versión por idioma con los mismos ids; la página nueva toma la del idioma de la empresa.
import type { JSONContent } from "@tiptap/core";
import { pageTemplatesEn } from "./page-templates-en.ts";
import { pageTemplatesEs } from "./page-templates-es.ts";

export const PAGE_TEMPLATE_IDS = [
  "blank",
  "procedure",
  "work-instruction",
  "meeting-minutes",
  "welcome",
] as const;

export interface PageTemplate {
  id: (typeof PAGE_TEMPLATE_IDS)[number];
  /** Nombre por defecto de la página nueva. */
  name: string;
  title: string;
  description: string;
  content: JSONContent;
}

/** Idiomas con plantillas (los de la app; ver docs/spec/i18n.md). */
export type TemplateLocale = "es" | "en";

const BY_LOCALE: Record<TemplateLocale, readonly PageTemplate[]> = {
  es: pageTemplatesEs,
  en: pageTemplatesEn,
};

/** Las plantillas en un idioma (español si no hay versión en ese). */
export function pageTemplates(locale: string): readonly PageTemplate[] {
  return locale === "en" ? BY_LOCALE.en : BY_LOCALE.es;
}
