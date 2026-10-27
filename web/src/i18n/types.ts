// Tipos compartidos de los textos de la web.

/**
 * La forma de un catálogo de textos sin sus valores literales: cada idioma se declara como
 * `Catalog<typeof es…>`, así que si le falta o le sobra una clave, `npm run typecheck -w web` falla.
 */
export type Catalog<T> = T extends string
  ? string
  : T extends boolean
    ? boolean
    : T extends number
      ? number
      : T extends (...args: infer A) => infer R
        ? (...args: A) => Catalog<R>
        : T extends readonly (infer U)[]
          ? readonly Catalog<U>[]
          : { readonly [K in keyof T]: Catalog<T[K]> };

/** Parte de un texto con enlaces: texto plano o un enlace. */
export type RichPart = string | { readonly text: string; readonly href: string };

/** Párrafo: texto plano o una secuencia de texto y enlaces. */
export type Rich = string | readonly RichPart[];

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly Rich[];
}

export interface LegalPage {
  readonly title: string;
  readonly description: string;
  readonly sections: readonly LegalSection[];
}
