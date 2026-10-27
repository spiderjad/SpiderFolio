// Tokens de color (CLAUDE.md, sección 10.2). Única fuente: el preset los inyecta como
// variables CSS en :root y .dark, y los componentes los usan vía clases de Tailwind.
// Formato "H S% L%" para poder componer hsl(var(--x) / <alpha-value>).

export const colorTokenNames = [
  "background",
  "surface",
  "foreground",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "ring",
  "primary",
  "primary-foreground",
  "primary-soft",
  "primary-soft-foreground",
  "success",
  "success-foreground",
  "success-soft",
  "success-soft-foreground",
  "warning",
  "warning-foreground",
  "warning-soft",
  "warning-soft-foreground",
  "danger",
  "danger-foreground",
  "danger-soft",
  "danger-soft-foreground",
] as const;

export type ColorToken = (typeof colorTokenNames)[number];
export type HslToken = `${number} ${number}% ${number}%`;
export type ThemeTokens = Readonly<Record<ColorToken, HslToken>>;

export const lightTokens: ThemeTokens = {
  background: "0 0% 100%",
  surface: "240 5% 98%",
  foreground: "240 10% 8%",
  muted: "240 5% 96%",
  "muted-foreground": "240 4% 44%",
  border: "240 6% 91%",
  input: "240 6% 88%",
  ring: "262 83% 58%",
  primary: "262 83% 58%",
  "primary-foreground": "0 0% 100%",
  "primary-soft": "262 100% 97%",
  "primary-soft-foreground": "263 70% 45%",
  success: "160 84% 39%",
  "success-foreground": "164 86% 10%",
  "success-soft": "152 76% 95%",
  "success-soft-foreground": "164 86% 22%",
  warning: "38 92% 50%",
  "warning-foreground": "26 90% 12%",
  "warning-soft": "48 100% 94%",
  "warning-soft-foreground": "22 78% 26%",
  danger: "0 72% 51%",
  "danger-foreground": "0 0% 100%",
  "danger-soft": "0 86% 97%",
  "danger-soft-foreground": "0 70% 35%",
};

export const darkTokens: ThemeTokens = {
  background: "240 10% 6%",
  surface: "240 8% 8%",
  foreground: "0 0% 96%",
  muted: "240 6% 12%",
  "muted-foreground": "240 5% 64%",
  border: "240 5% 16%",
  input: "240 5% 20%",
  ring: "263 85% 68%",
  primary: "263 85% 68%",
  "primary-foreground": "240 10% 6%",
  "primary-soft": "263 40% 16%",
  "primary-soft-foreground": "263 90% 80%",
  success: "158 64% 52%",
  "success-foreground": "160 84% 6%",
  "success-soft": "160 40% 12%",
  "success-soft-foreground": "156 72% 67%",
  warning: "38 92% 55%",
  "warning-foreground": "26 90% 10%",
  "warning-soft": "38 50% 14%",
  "warning-soft-foreground": "46 97% 65%",
  danger: "0 84% 60%",
  "danger-foreground": "240 10% 6%",
  "danger-soft": "0 40% 14%",
  "danger-soft-foreground": "0 94% 82%",
};

export const radius = "0.75rem";

// Pares texto/fondo que la interfaz usa y deben cumplir AA (4,5:1), en claro y oscuro.
export const textContrastPairs: readonly (readonly [text: ColorToken, bg: ColorToken])[] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "surface"],
  ["muted-foreground", "muted"],
  ["primary", "background"],
  ["primary-foreground", "primary"],
  ["primary-soft-foreground", "primary-soft"],
  ["success-foreground", "success"],
  ["success-soft-foreground", "success-soft"],
  ["warning-foreground", "warning"],
  ["warning-soft-foreground", "warning-soft"],
  ["danger", "background"],
  ["danger-foreground", "danger"],
  ["danger-soft-foreground", "danger-soft"],
];

// Elementos no textuales (foco) deben llegar a 3:1 contra el fondo (WCAG 1.4.11).
export const uiContrastPairs: readonly (readonly [fg: ColorToken, bg: ColorToken])[] = [
  ["ring", "background"],
  ["ring", "surface"],
];
