// Selector de idioma ES/EN siempre visible (pantallas de auth). Arranca con el del navegador o el
// último elegido (initialLocale); cambiarlo recarga la página, y la API recibe el nuevo idioma en
// Accept-Language: así se guarda al crear la cuenta o la empresa.
import { LOCALE_NAMES, LOCALES, locale, switchLocale, texts } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitch({ className }: { className?: string }) {
  return (
    <div
      role="group"
      aria-label={texts.common.language}
      className={cn("inline-flex rounded-lg border border-border p-0.5", className)}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          title={LOCALE_NAMES[option]}
          aria-label={LOCALE_NAMES[option]}
          aria-pressed={option === locale}
          onClick={() => {
            switchLocale(option);
          }}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            option === locale
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
