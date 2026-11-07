// The token names and the values kept for the per-workspace accent math (src/accent.ts): the colors
// the app shows come from spider-ui through tokens.css (tests/preset.test.ts); these reference values
// must still define the same tokens in both themes and keep AA contrast, since the accent is checked
// against them.
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/color.ts";
import { spiderUiAliases } from "../src/tokens-css.ts";
import {
  colorTokenNames,
  darkTokens,
  lightTokens,
  textContrastPairs,
  uiContrastPairs,
} from "../src/tokens.ts";

const themes = { claro: lightTokens, oscuro: darkTokens } as const;

describe("tokens", () => {
  it("los dos temas y los alias de spider-ui definen exactamente los mismos tokens", () => {
    expect(Object.keys(lightTokens).sort()).toEqual([...colorTokenNames].sort());
    expect(Object.keys(darkTokens).sort()).toEqual([...colorTokenNames].sort());
    expect(Object.keys(spiderUiAliases).sort()).toEqual([...colorTokenNames].sort());
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
