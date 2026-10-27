// Activación obligatoria: el workspace exige verificación en dos pasos y la persona todavía no la
// tiene. Hasta activarla no ve nada más del workspace (el servidor responde MFA_SETUP_REQUIRED).
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, IconTile } from "@/components/ui/display";
import { RecoveryCodesDialog, SetupDialog } from "./two-factor-section";
import { texts } from "@/i18n";

export function MandatoryTwoFactor({
  workspaceName,
  onLogout,
}: {
  workspaceName: string;
  onLogout: () => void;
}) {
  const t = texts.profile.twoFactor.mandatory;
  const { reloadAccount } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <div className="mx-auto grid w-full max-w-lg py-10">
      <Card className="grid justify-items-center gap-4 p-6 text-center sm:p-8">
        <IconTile icon={ShieldCheck} size="lg" />
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.text(workspaceName)}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              setSetupOpen(true);
            }}
          >
            {t.action}
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            {t.logout}
          </Button>
        </div>
      </Card>
      {setupOpen && (
        <SetupDialog
          onClose={() => {
            setSetupOpen(false);
          }}
          onEnabled={(recoveryCodes) => {
            setSetupOpen(false);
            setCodes(recoveryCodes);
            return Promise.resolve();
          }}
        />
      )}
      {codes !== null && (
        <RecoveryCodesDialog
          codes={codes}
          onClose={() => {
            setCodes(null);
            // Recién al cerrar los códigos se entra: así no se pierden de vista.
            void reloadAccount();
          }}
        />
      )}
    </div>
  );
}
