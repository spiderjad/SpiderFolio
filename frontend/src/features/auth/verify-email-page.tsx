import { CheckCircle2, MailWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { api } from "@/lib/api";
import { takeTokenFromHash } from "./token-from-hash";
import { texts } from "@/i18n";

type State = "verifying" | "done" | "invalid" | "missing";

export function VerifyEmailPage() {
  const t = texts.auth.verify;
  const { status, reloadAccount } = useAuth();
  const [state, setState] = useState<State>("verifying");
  const [resent, setResent] = useState(false);
  // El token es de un solo uso: el efecto no puede correr dos veces (StrictMode).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromHash();
    if (token === null) {
      setState("missing");
      return;
    }
    api("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => {
        setState("done");
      })
      .catch(() => {
        setState("invalid");
      });
  }, []);

  useEffect(() => {
    if (state === "done" && status === "authenticated") void reloadAccount();
  }, [state, status, reloadAccount]);

  const resend = async () => {
    await api("/auth/resend-verification", { method: "POST" });
    setResent(true);
  };

  return (
    <AuthLayout title={t.title}>
      {state === "verifying" && (
        <div className="grid gap-3" aria-busy="true">
          <p className="text-muted-foreground">{t.verifying}</p>
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {state === "done" && (
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-sm" role="status">
            <CheckCircle2 className="size-5 text-success" strokeWidth={1.75} aria-hidden="true" />
            {t.done}
          </p>
          <Button asChild size="lg">
            <Link to={status === "authenticated" ? "/app" : "/login"}>{t.goToApp}</Link>
          </Button>
        </div>
      )}
      {(state === "invalid" || state === "missing") && (
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-sm" role="alert">
            <MailWarning className="size-5 text-warning" strokeWidth={1.75} aria-hidden="true" />
            {state === "invalid" ? t.invalid : t.missing}
          </p>
          {resent ? (
            <FormAlert tone="success">{t.resent}</FormAlert>
          ) : status === "authenticated" ? (
            <Button size="lg" onClick={() => void resend()}>
              {t.resend}
            </Button>
          ) : (
            <Button asChild size="lg" variant="outline">
              <Link to="/login?next=/app">{t.loginToResend}</Link>
            </Button>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
