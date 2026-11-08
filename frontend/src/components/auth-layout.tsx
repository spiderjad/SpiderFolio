// Access screens (docs/spec/diseno.md 10.6) on spider-ui's auth-*: the dark animated background, the white
// card with the logo, the title and the form, and the language switch in the card. They look the same in
// light and dark (spider-ui's rule), so the light theme is forced while one is open: whatever isn't an
// auth-* piece inside the card keeps its contrast on white. The shared components (Button, Input,
// FormField…) draw themselves with auth-* inside it (components/ui/surface.tsx).
import { useEffect, type ReactNode } from "react";
import { Logo } from "@/components/ui/display";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { AuthSurface, useAuthSurface } from "@/components/ui/surface";

/** While an access screen is open, the page is light; on leaving, the person's theme comes back. */
function useForcedLight() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const theme = root.getAttribute("data-theme");
    root.classList.remove("dark");
    root.setAttribute("data-theme", "light");
    return () => {
      root.classList.toggle("dark", wasDark);
      if (theme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", theme);
    };
  }, []);
}

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
  useForcedLight();
  return (
    <AuthSurface>
      <div className="auth-page">
        <div className="auth-bg" aria-hidden="true">
          <div className="auth-blob auth-blob--violeta" />
          <div className="auth-blob auth-blob--ambar" />
          <div className="auth-blob auth-blob--oscuro" />
          <div className="auth-blob auth-blob--rosa" />
        </div>
        <main className="auth-card">
          <LanguageSwitch className="absolute right-4 top-4" />
          <header className="auth-header">
            <span className="flex justify-center">
              <Logo />
            </span>
            <h1 className="auth-title">{title}</h1>
            {subtitle !== undefined && <p className="auth-subtitle">{subtitle}</p>}
          </header>
          {children}
          {footer !== undefined && <div className="auth-alt mt-6">{footer}</div>}
        </main>
      </div>
    </AuthSurface>
  );
}

/** A message for the whole form, error or success. */
export function FormAlert({ tone, children }: { tone: "danger" | "success"; children: ReactNode }) {
  const auth = useAuthSurface();
  const className = auth
    ? tone === "danger"
      ? "auth-banner mb-0"
      : "auth-banner auth-banner--success mb-0"
    : `v-banner v-banner--${tone}`;
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={className}>
      {children}
    </p>
  );
}
