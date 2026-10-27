// Casillas de Términos y Privacidad (obligatoria, con enlaces a la web en pestaña nueva) y de
// novedades por email (opcional). Las dos nacen desmarcadas.
import type { UseFormRegisterReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/form";
import { legalUrl } from "@/lib/web-url";
import { texts } from "@/i18n";

const LINK = "font-medium text-primary hover:underline";

function TermsAcceptLabel() {
  const t = texts.terms.accept;
  return (
    <>
      {t.before}
      <a href={legalUrl.terms} target="_blank" rel="noopener noreferrer" className={LINK}>
        {t.terms}
      </a>
      {t.middle}
      <a href={legalUrl.privacy} target="_blank" rel="noopener noreferrer" className={LINK}>
        {t.privacy}
      </a>
    </>
  );
}

export function TermsFields({
  accept,
  marketing,
  error,
}: {
  accept: UseFormRegisterReturn;
  marketing?: UseFormRegisterReturn;
  error: string | undefined;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Checkbox label={<TermsAcceptLabel />} aria-invalid={error !== undefined} {...accept} />
        {error !== undefined && (
          <p role="alert" className="pl-6 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      {marketing !== undefined && <Checkbox label={texts.terms.marketing} {...marketing} />}
    </div>
  );
}
