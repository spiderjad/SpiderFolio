import { describe, expect, it } from "vitest";
import {
  HEX_COLOR_RE,
  accentIsLowContrastText,
  accentTokens,
  normalizeHex,
  primaryForegroundFor,
} from "../src/accent.ts";
import { contrastRatio } from "../src/color.ts";
import { darkTokens } from "../src/tokens.ts";

const WHITE = "0 0% 100%";
const NEAR_BLACK = darkTokens.background;

describe("HEX_COLOR_RE y normalizeHex", () => {
  it.each(["#7C3AED", "#7c3aed", "#000000", "#FFFFFF"])("acepta %s", (value) => {
    expect(HEX_COLOR_RE.test(value)).toBe(true);
  });

  it.each([
    "#fff",
    "7c3aed",
    "#7c3aed0",
    "#7c3aedff",
    "red",
    "#gggggg",
    "",
    "#7c3aed;}body{display:none",
    "#7c3aed\n",
    " #7c3aed",
  ])("rechaza %j", (value) => {
    expect(HEX_COLOR_RE.test(value)).toBe(false);
    expect(normalizeHex(value)).toBeNull();
  });

  it("normaliza a minúsculas", () => {
    expect(normalizeHex("#7C3AED")).toBe("#7c3aed");
  });
});

describe("primaryForegroundFor", () => {
  it.each([
    ["#7c3aed", WHITE], // violeta de la marca
    ["#000000", WHITE],
    ["#1e3a8a", WHITE],
    ["#dc2626", WHITE],
    ["#ffffff", NEAR_BLACK],
    ["#facc15", NEAR_BLACK], // amarillo
    ["#a3e635", NEAR_BLACK], // lima
    ["#22d3ee", NEAR_BLACK], // cian claro
  ])("%s → %s", (hex, expected) => {
    expect(primaryForegroundFor(hex)).toBe(expected);
  });

  it("acepta mayúsculas", () => {
    expect(primaryForegroundFor("#FACC15")).toBe(NEAR_BLACK);
  });

  it("rechaza valores inválidos", () => {
    expect(() => primaryForegroundFor("red")).toThrow();
  });

  it("elige siempre la opción de mayor contraste", () => {
    for (let n = 0; n <= 0xffffff; n += 0x0f0f0f) {
      const hex = `#${n.toString(16).padStart(6, "0")}`;
      const fg = primaryForegroundFor(hex);
      const primary = accentTokens(hex).light["--primary"];
      const other = fg === WHITE ? NEAR_BLACK : WHITE;
      expect(contrastRatio(fg, primary ?? "")).toBeGreaterThanOrEqual(
        contrastRatio(other, primary ?? ""),
      );
    }
  });
});

describe("accentTokens", () => {
  it("devuelve las variables del primario para claro y oscuro", () => {
    const tokens = accentTokens("#7c3aed");
    expect(Object.keys(tokens.light).sort()).toEqual([
      "--primary",
      "--primary-foreground",
      "--primary-soft",
      "--primary-soft-foreground",
      "--ring",
    ]);
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  });

  it("los tonos suaves se leen (AA) en cualquier matiz y saturación", () => {
    for (let h = 0; h < 360; h += 15) {
      for (const s of [20, 60, 100]) {
        for (const l of [30, 50, 70]) {
          const rgb = hslHex(h, s, l);
          const { light, dark } = accentTokens(rgb);
          for (const theme of [light, dark]) {
            const fg = theme["--primary-soft-foreground"] ?? "";
            const bg = theme["--primary-soft"] ?? "";
            expect(contrastRatio(fg, bg), rgb).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("el texto sobre el primario llega a AA en colores habituales de marca", () => {
    for (const hex of ["#7c3aed", "#2563eb", "#059669", "#dc2626", "#0f172a", "#ea580c"]) {
      const { light, dark } = accentTokens(hex);
      for (const theme of [light, dark]) {
        const ratio = contrastRatio(theme["--primary-foreground"] ?? "", theme["--primary"] ?? "");
        expect(ratio, hex).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("accentIsLowContrastText", () => {
  it("avisa con acentos claros y no con el violeta de la marca", () => {
    expect(accentIsLowContrastText("#7c3aed")).toBe(false);
    expect(accentIsLowContrastText("#facc15")).toBe(true);
  });
});

function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
