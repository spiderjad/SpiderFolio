// Idioma activo para los textos de los plugins (docs/spec/plugins.md). Módulo aparte de ui.ts para que
// el index.tsx de un plugin lo importe sin arrastrar las pantallas (y sin ciclos con el registro).
// Enlace vivo: ya vale el idioma elegido cuando se cargan los plugins (main.tsx).
export { locale, type Locale } from "@/i18n";
