import "./lib/zod-config";
import "@fontsource-variable/inter";
import "@fontsource/instrument-serif";
import "@fontsource-variable/jetbrains-mono";
import "./styles/globals.css";
import { activateLocale, initialLocale } from "@/i18n";

// public/compat.js marca los navegadores no compatibles (10.10): ahí la app no arranca y se
// ve la página de aviso. El resto de la app se carga recién con el idioma activo: sus módulos
// leen los textos al cargarse.
const root = document.getElementById("root");
if (root !== null && !document.documentElement.hasAttribute("data-unsupported")) {
  void activateLocale(initialLocale())
    .catch(() => activateLocale("es"))
    .then(() => import("./boot"))
    .then(({ boot }) => {
      boot(root);
    });
}
