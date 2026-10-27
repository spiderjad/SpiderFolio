// Forma de un catálogo de textos: la del de referencia (es.ts), con textos libres en lugar de
// literales. Así cada idioma tiene exactamente las mismas claves y funciones (docs/spec/i18n.md).
export type Catalog<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Catalog<R>
    : T extends readonly (infer U)[]
      ? readonly Catalog<U>[]
      : T extends object
        ? { readonly [K in keyof T]: Catalog<T[K]> }
        : T;
