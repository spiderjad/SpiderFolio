import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/color.ts";
import {
  colorTokenNames,
  darkTokens,
  lightTokens,
  textContrastPairs,
  uiContrastPairs,
} from "../src/tokens.ts";

const themes = { claro: lightTokens, oscuro: darkTokens } as const;

describe("tokens", () => {
  it("los dos temas definen exactamente los mismos tokens", () => {
    expect(Object.keys(lightTokens).sort()).toEqual([...colorTokenNames].sort());
    expect(Object.keys(darkTokens).sort()).toEqual([...colorTokenNames].sort());
  });

  for (const [theme, tokens] of Object.entries(themes)) {
    it.each(textContrastPairs)(`texto AA en ${theme}: %s sobre %s`, (text, bg) => {
      expect(contrastRatio(tokens[text], tokens[bg])).toBeGreaterThanOrEqual(4.5);
    });

    it.each(uiContrastPairs)(`foco ≥ 3:1 en ${theme}: %s sobre %s`, (fg, bg) => {
      expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(3);
    });
  }
});
