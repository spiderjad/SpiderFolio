// Color de acento por workspace (CLAUDE.md, sección 10.2). Funciones puras, sin Tailwind:
// las usa el backend (validación) y la app, que aplica el resultado con
// document.documentElement.style.setProperty (nunca con <style> en línea, por la CSP).
import { contrastRatio, formatHslToken, hexToRgb, rgbToHsl, type Hsl } from "./color.ts";
import { darkTokens, lightTokens, type HslToken } from "./tokens.ts";

/** Solo #RRGGBB. El backend lo exige antes de guardar Workspace.accentColor. */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Valida y normaliza a minúsculas. Devuelve null si el valor no es un #RRGGBB. */
export function normalizeHex(value: string): string | null {
  return HEX_COLOR_RE.test(value) ? value.toLowerCase() : null;
}

function requireHex(value: string): string {
  const hex = normalizeHex(value);
  if (hex === null) throw new Error("Color inválido: se espera #RRGGBB");
  return hex;
}

const WHITE: HslToken = "0 0% 100%";
const NEAR_BLACK: HslToken = darkTokens.background;

/** Texto sobre un fondo dado: blanco o casi negro, el que tenga más contraste. */
function bestForeground(bg: HslToken): HslToken {
  return contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
}

/** primary-foreground con mejor contraste (blanco o casi negro) para un acento #RRGGBB. */
export function primaryForegroundFor(hex: string): HslToken {
  return bestForeground(formatHslToken(rgbToHsl(hexToRgb(requireHex(hex)))));
}

export type AccentVariables = Readonly<Record<`--${string}`, HslToken>>;

export interface AccentTokens {
  light: AccentVariables;
  dark: AccentVariables;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Oscurece (step < 0) o aclara (step > 0) el texto hasta llegar a AA sobre el fondo. */
function readableOn(bg: HslToken, { h, s, l }: Hsl, step: number): HslToken {
  let token = formatHslToken({ h, s, l });
  for (let light = l; light >= 0 && light <= 100; light += step) {
    token = formatHslToken({ h, s, l: light });
    if (contrastRatio(token, bg) >= 4.5) break;
  }
  return token;
}

/**
 * Variables CSS que reemplazan las del primario para un acento #RRGGBB.
 * En oscuro se aclara, como el token base (58 % → 68 %); los tonos suaves
 * conservan el matiz del acento para que el ítem activo no quede violeta.
 */
export function accentTokens(hex: string): AccentTokens {
  const { h, s, l } = rgbToHsl(hexToRgb(requireHex(hex)));
  const lightPrimary = formatHslToken({ h, s, l });
  const darkPrimary = formatHslToken({ h, s, l: clamp(l + 10, 60, 80) });
  const lightSoft = formatHslToken({ h, s, l: 97 });
  const darkSoft = formatHslToken({ h, s: Math.min(s, 40), l: 16 });
  return {
    light: {
      "--primary": lightPrimary,
      "--primary-foreground": bestForeground(lightPrimary),
      "--primary-soft": lightSoft,
      "--primary-soft-foreground": readableOn(lightSoft, { h, s: Math.min(s, 70), l: 40 }, -2),
      "--ring": lightPrimary,
    },
    dark: {
      "--primary": darkPrimary,
      "--primary-foreground": bestForeground(darkPrimary),
      "--primary-soft": darkSoft,
      "--primary-soft-foreground": readableOn(darkSoft, { h, s: Math.min(s, 90), l: 75 }, 2),
      "--ring": darkPrimary,
    },
  };
}

/**
 * Si el acento usado como texto (enlaces) sobre el fondo claro no llega a AA.
 * La pantalla de configuración lo muestra como advertencia; no bloquea.
 */
export function accentIsLowContrastText(hex: string): boolean {
  const primary = formatHslToken(rgbToHsl(hexToRgb(requireHex(hex))));
  return contrastRatio(primary, lightTokens.background) < 4.5;
}
