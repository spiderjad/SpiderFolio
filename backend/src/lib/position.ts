// Índices fraccionales (docs/spec/modelo-de-datos.md, Node.position): un texto que ordena a los
// hermanos de una carpeta y permite insertar entre dos sin reescribir a los demás. Dígitos en
// base 62 ordenados por código (la columna usa COLLATE "C"); una clave nunca termina en "0".
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function digitOf(char: string | undefined): number {
  const index = char === undefined ? 0 : DIGITS.indexOf(char);
  if (index < 0) throw new Error(`Posición inválida: ${char ?? ""}`);
  return index;
}

/** Punto medio entre `a` (vacío = el principio) y `b` (null = el final); a < b. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = digitOf(a[0]);
  const digitB = b === null ? BASE : digitOf(b[0]);
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round(0.5 * (digitA + digitB)));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

/** Una posición estrictamente entre `before` y `after` (null = sin vecino de ese lado). */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error("positionBetween: before debe ser menor que after");
  }
  return midpoint(before ?? "", after);
}
