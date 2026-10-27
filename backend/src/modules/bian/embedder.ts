// Interfaz de embeddings para la búsqueda híbrida de Bian. Hoy no hay ninguna implementación (solo
// texto completo): el código que la necesite recibe `Embedder | null` y sigue sin vectores.
//
// Pendiente (docs/plans/asistente-ia.md): evaluar Voyage AI por API o un modelo multilingüe local en
// el worker; la implementación elegida se aprueba junto con pgvector (extensión y cambio de imagen).

export interface Embedder {
  readonly id: string;
  /** Largo de cada vector; fija el tipo de la columna `vector(N)` cuando se apruebe pgvector. */
  readonly dimensions: number;
  /** Un vector por texto, en el mismo orden. Los de consulta y los de documento pueden diferir. */
  embed(texts: readonly string[], kind: "document" | "query"): Promise<number[][]>;
}

/** El embedder del entorno; null mientras no se apruebe ninguno. */
export function embedderFromEnv(): Embedder | null {
  return null;
}
