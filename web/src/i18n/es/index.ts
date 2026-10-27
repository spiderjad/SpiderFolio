// Catálogo de referencia de la web: los demás idiomas tienen exactamente esta forma.
import { oss } from "./oss.ts";
import { pages } from "./pages.ts";
import { site } from "./site.ts";

export const es = { ...site, ...pages, oss };
