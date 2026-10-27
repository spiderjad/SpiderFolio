// English catalog: same shape as the Spanish reference (checked by the type).
import type { es } from "../es/index.ts";
import type { Catalog } from "../types.ts";
import { oss } from "./oss.ts";
import { pages } from "./pages.ts";
import { site } from "./site.ts";

export const en: Catalog<typeof es> = { ...site, ...pages, oss };
