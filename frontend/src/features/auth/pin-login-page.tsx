// /entrar/:workspaceSlug — ingreso de lectores de planta con usuario + PIN (CLAUDE.md, sección
// 7.6). Pensada para tablets compartidas: teclado numérico grande, el PIN como puntos y ningún
// dato de la persona anterior. El navegador solo recuerda el workspace, nunca el usuario.
import { Delete, LogIn } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { ApiError } from "@/lib/api";
import { readKioskWorkspace } from "@/lib/kiosk";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

const PIN_LENGTH = 6;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** /entrar sin workspace: vuelve al de la última sesión de la tablet o lo pide. */
export function PinEntryRedirect() {
  const t = texts.auth.pin;
  const navigate = useNavigate();
  const remembered = readKioskWorkspace();
  const [slug, setSlug] = useState("");
  if (remembered !== null)
    return <Navigate to={`/entrar/${encodeURIComponent(remembered)}`} replace />;
  return (
    <AuthLayout title={t.title} subtitle={t.workspaceSubtitle}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = slug.trim().toLowerCase();
          if (value !== "") void navigate(`/entrar/${encodeURIComponent(value)}`);
        }}
      >
        <FormField label={t.workspace}>
          {(control) => (
            <Input
              {...control}
              value={slug}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t.workspacePlaceholder}
              onChange={(event) => {
                setSlug(event.target.value);
              }}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" disabled={slug.trim() === ""}>
          {texts.common.continue}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function PinLoginPage() {
  const t = texts.auth.pin;
  const { workspaceSlug = "" } = useParams();
  const { pinLogin } = useAuth();
  const navigate = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);

  const submit = async (value: string) => {
    if (pending || loginName.trim() === "" || value.length !== PIN_LENGTH) return;
    setPending(true);
    setError(null);
    try {
      await pinLogin(workspaceSlug, loginName, value);
      void navigate(`/app/${encodeURIComponent(workspaceSlug)}`, { replace: true });
    } catch (failure) {
      setPin("");
      setPending(false);
      if (failure instanceof ApiError && failure.code === "RATE_LIMITED") setError(t.rateLimited);
      else if (failure instanceof ApiError && failure.code === "INVALID_CREDENTIALS") {
        setError(t.invalid);
      } else setError(texts.errors.generic);
    }
  };

  const press = (digit: string) => {
    if (pending) return;
    setError(null);
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setPin(next);
    // Con los seis dígitos y el usuario escrito, entra sin otro toque.
    if (next.length === PIN_LENGTH && loginName.trim() !== "") void submit(next);
  };

  // Teclado físico (tablets con teclado y pruebas): dígitos, Backspace y Enter.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") setPin((current) => current.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(pin);
  };

  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
        <FormField label={t.loginName}>
          {(control) => (
            <Input
              {...control}
              value={loginName}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-12 text-lg"
              onChange={(event) => {
                setLoginName(event.target.value);
              }}
            />
          )}
        </FormField>

        <div ref={pinRef} className="grid gap-3">
          <p id="pin-label" className="text-sm font-medium">
            {t.pin}
          </p>
          <div
            role="img"
            aria-labelledby="pin-label"
            aria-description={t.digits(pin.length, PIN_LENGTH)}
            className="flex justify-center gap-3"
          >
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className={cn(
                  "size-4 rounded-full border-2 border-primary transition-colors",
                  index < pin.length && "bg-primary",
                )}
              />
            ))}
          </div>
          <span className="sr-only" aria-live="polite">
            {t.digits(pin.length, PIN_LENGTH)}
          </span>
          <div className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-3">
            {KEYS.map((digit) => (
              <Button
                key={digit}
                type="button"
                variant="outline"
                className="h-16 text-2xl font-medium"
                disabled={pending}
                onClick={() => {
                  press(digit);
                }}
              >
                {digit}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              className="h-16"
              disabled={pending || pin === ""}
              aria-label={t.erase}
              onClick={() => {
                setPin((current) => current.slice(0, -1));
              }}
            >
              <Delete className="size-6" strokeWidth={1.75} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-16 text-2xl font-medium"
              disabled={pending}
              onClick={() => {
                press("0");
              }}
            >
              0
            </Button>
            <Button
              type="submit"
              className="h-16"
              disabled={pending || pin.length !== PIN_LENGTH || loginName.trim() === ""}
              aria-label={t.submit}
            >
              <LogIn className="size-6" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}
