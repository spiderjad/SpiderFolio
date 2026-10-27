// Nombres de personas: espacios unificados y mayúsculas razonables. Si el nombre viene todo en
// minúsculas o todo en mayúsculas se pone mayúscula inicial a cada palabra (las partículas "de",
// "del", "la"… quedan en minúscula salvo al inicio); si mezcla mayúsculas y minúsculas se respeta
// tal cual. La migración de datos 20261021130000_normalize_person_names aplica la misma regla en SQL:
// si se cambia una, hay que cambiar la otra.

/** Partículas que quedan en minúscula dentro de un nombre (no al inicio). */
export const NAME_PARTICLES: ReadonlySet<string> = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "y",
  "i",
  "da",
  "van",
  "von",
]);

/** Pone en mayúscula la primera letra de cada tramo de letras y números (también tras - ' .). */
function capitalize(word: string): string {
  return word.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_all, before: string, letter: string) => {
    return `${before}${letter.toUpperCase()}`;
  });
}

export function normalizePersonName(input: string): string {
  const spaced = input.trim().replace(/\s+/gu, " ");
  const hasUpper = spaced !== spaced.toLowerCase();
  const hasLower = spaced !== spaced.toUpperCase();
  // Mayúsculas y minúsculas mezcladas: la persona (o su sistema) ya lo escribió como quiere.
  if (hasUpper && hasLower) return spaced;
  return spaced
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && NAME_PARTICLES.has(word) ? word : capitalize(word)))
    .join(" ");
}
