// Pantallas de auth (10.6): formulario de 400 px a la izquierda con el logo; a la derecha,
// degradado violeta tenue, etiqueta con ícono, título display y tres beneficios con checks.
// En móvil, solo el formulario.
import { Check, FolderCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Eyebrow, Logo } from "@/components/ui/display";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { texts } from "@/i18n";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
        </div>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="page-enter w-full max-w-[400px]">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle !== undefined && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer !== undefined && (
              <div className="mt-8 text-xs text-muted-foreground">{footer}</div>
            )}
          </div>
        </main>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-border bg-surface lg:flex lg:items-center lg:justify-center">
        {/* Degradado violeta tenue (≤ 6 %, 10.1), más intenso arriba y desvanecido hacia abajo. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-radial-[at_85%_0%] from-primary/[0.06] via-primary/[0.02] to-transparent"
        />
        <div className="relative max-w-lg px-12">
          <Eyebrow icon={FolderCheck}>{texts.auth.benefits.eyebrow}</Eyebrow>
          <p className="mt-4 font-display text-5xl leading-[1.05] tracking-tight xl:text-6xl">
            {texts.auth.benefits.title}
          </p>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {texts.auth.benefits.subtitle}
          </p>
          <ul className="mt-10 grid gap-4">
            {texts.auth.benefits.items.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** Mensaje de error o de éxito a nivel formulario. */
export function FormAlert({ tone, children }: { tone: "danger" | "success"; children: ReactNode }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={
        tone === "danger"
          ? "rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground"
          : "rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-soft-foreground"
      }
    >
      {children}
    </p>
  );
}
