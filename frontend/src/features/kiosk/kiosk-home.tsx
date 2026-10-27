// Inicio de quien entra con usuario + PIN en una tablet: una vista simple. Los documentos
// que le toca leer llegan con "Mis documentos" (Módulo 6); mientras tanto explica qué va a ver.
import { BookOpenCheck } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Card, EmptyState } from "@/components/ui/display";
import { SwitchUserButton } from "./kiosk-session";
import { texts } from "@/i18n";

export function KioskHome() {
  const t = texts.kiosk.home;
  const { account } = useAuth();
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.greeting(account?.user.name ?? "")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <SwitchUserButton />
      </div>
      <Card>
        <EmptyState icon={BookOpenCheck} title={t.empty.title}>
          {t.empty.text}
        </EmptyState>
      </Card>
    </div>
  );
}
