// Única fuente de los precios de la web pública (precios de lanzamiento). Los textos de cada idioma
// solo ponen las etiquetas; los importes y su formato salen de aquí.
// España: euros sin IVA. Latinoamérica: dólares estadounidenses.

import type { Locale } from "../i18n/locales.ts";

/** Cómo se cobra: pago único, por año o por día. */
export type Billing = "once" | "year" | "day";

export interface Price {
  /** Euros, sin IVA (España). */
  readonly eur: number;
  /** Dólares estadounidenses (Latinoamérica). */
  readonly usd: number;
  readonly billing: Billing;
  /** Precio mínimo («desde»): el final depende del alcance. */
  readonly from: boolean;
}

export const PRICES = {
  "onedrive-import": { eur: 390, usd: 250, billing: "once", from: false },
  "mcp-connector": { eur: 390, usd: 250, billing: "year", from: false },
  "security-policies": { eur: 490, usd: 320, billing: "year", from: false },
  "audit-rooms": { eur: 490, usd: 320, billing: "year", from: false },
  templates: { eur: 290, usd: 190, billing: "once", from: false },
  enterprise: { eur: 1690, usd: 1090, billing: "year", from: false },
  installation: { eur: 690, usd: 450, billing: "once", from: true },
  support: { eur: 1200, usd: 790, billing: "year", from: true },
  consulting: { eur: 490, usd: 320, billing: "day", from: false },
  "erp-connector": { eur: 4900, usd: 3200, billing: "once", from: true },
} as const satisfies Record<string, Price>;

export type PriceId = keyof typeof PRICES;

/** Plugins sueltos (sin el paquete Enterprise ni los servicios). */
export const PLUGIN_PRICE_IDS = [
  "security-policies",
  "onedrive-import",
  "mcp-connector",
  "templates",
  "audit-rooms",
] as const satisfies readonly PriceId[];

export function isPriceId(id: string): id is PriceId {
  return Object.hasOwn(PRICES, id);
}

/** Precio del plugin más barato, para «desde …». */
export const PLUGIN_FROM: Price = {
  eur: Math.min(...PLUGIN_PRICE_IDS.map((id) => PRICES[id].eur)),
  usd: Math.min(...PLUGIN_PRICE_IDS.map((id) => PRICES[id].usd)),
  billing: "once",
  from: true,
};

/** Espacio sin corte entre el importe y la moneda. */
const NBSP = String.fromCharCode(0xa0);

function group(value: number, separator: string): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Euros con el formato del idioma: es «1.690 €», en «€1,690». */
export function formatEur(value: number, locale: Locale): string {
  return locale === "es" ? `${group(value, ".")}${NBSP}€` : `€${group(value, ",")}`;
}

/** Dólares con el formato del idioma: es «1.090 USD», en «$1,090 USD». */
export function formatUsd(value: number, locale: Locale): string {
  return locale === "es" ? `${group(value, ".")}${NBSP}USD` : `$${group(value, ",")}${NBSP}USD`;
}
