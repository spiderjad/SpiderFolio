// Textos de la API, los emails y Bian en el idioma activo (docs/spec/i18n.md). Siempre se importan
// desde acá, nunca de es.ts o en.ts: cada objeto resuelve el idioma de la petición o del job
// (`withLocale`) en el momento de leerlo, así que no se guardan en constantes de módulo.
import type { Catalog } from "./catalog.ts";
import * as en from "./en.ts";
import * as es from "./es.ts";
import { currentLocale, type Locale } from "./locales.ts";

type Texts = { [K in keyof typeof es]: Catalog<(typeof es)[K]> };

const catalogs: Record<Locale, Texts> = { es, en };

function localized<K extends keyof Texts>(key: K): Texts[K] {
  const target = (): object => catalogs[currentLocale()][key];
  return new Proxy({} as Texts[K], {
    get: (_empty, prop) => Reflect.get(target(), prop) as unknown,
    has: (_empty, prop) => Reflect.has(target(), prop),
    ownKeys: () => Reflect.ownKeys(target()),
    getOwnPropertyDescriptor: (_empty, prop) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), prop);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
  });
}

export const errorMessages = localized("errorMessages");
export const specificErrorMessages = localized("specificErrorMessages");
export const emailTexts = localized("emailTexts");
export const roleMessages = localized("roleMessages");
export const departmentMessages = localized("departmentMessages");
export const invitationMessages = localized("invitationMessages");
export const invitationEmailTexts = localized("invitationEmailTexts");
export const mentionEmailTexts = localized("mentionEmailTexts");
export const sharedEmailTexts = localized("sharedEmailTexts");
export const documentNoticeTexts = localized("documentNoticeTexts");
export const emailChangeTexts = localized("emailChangeTexts");
export const exportEmailTexts = localized("exportEmailTexts");
export const memberExportLabels = localized("memberExportLabels");
export const pinMessages = localized("pinMessages");
export const memberMessages = localized("memberMessages");
export const contentMessages = localized("contentMessages");
export const fileMessages = localized("fileMessages");
export const customEmailTexts = localized("customEmailTexts");
export const bianTexts = localized("bianTexts");
export const pluginTexts = localized("pluginTexts");
export const validationMessages = localized("validationMessages");
export const accountMessages = localized("accountMessages");
export const mfaLoginMessages = localized("mfaLoginMessages");
export const mfaMessages = localized("mfaMessages");
export const mfaResetMessages = localized("mfaResetMessages");
export const controlledPdfTexts = localized("controlledPdfTexts");
export const qrTexts = localized("qrTexts");
export const accessExportLabels = localized("accessExportLabels");
export const auditExportLabels = localized("auditExportLabels");
export const readingExportLabels = localized("readingExportLabels");
export const bianAdminTexts = localized("bianAdminTexts");
export const defaultDataTexts = localized("defaultDataTexts");
