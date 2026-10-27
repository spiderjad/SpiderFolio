// Escribe tokens.css desde src/tokens.ts: npm run tokens:css -w @spiderfolio/tailwind-preset
import { writeFileSync } from "node:fs";
import { buildTokensCss } from "../src/tokens-css.ts";

const target = new URL("../tokens.css", import.meta.url);
writeFileSync(target, buildTokensCss());
console.log("tokens.css actualizado");
