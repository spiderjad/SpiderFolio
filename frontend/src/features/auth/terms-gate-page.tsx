// Pantalla que frena la app cuando cambió la versión vigente de los Términos y la Política de
// privacidad: hay que aceptar la nueva (queda la evidencia en el servidor) o cerrar sesión.
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { applyApiError } from "./form-errors";
import { AcceptTermsSchema, type AcceptTermsValues } from "./schemas";
import { TermsFields } from "./terms-fields";
import { texts } from "@/i18n";

export function TermsGatePage() {
  const t = texts.terms.gate;
  const { acceptTerms, logout } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AcceptTermsValues>({
    resolver: zodResolver(AcceptTermsSchema),
    defaultValues: { acceptTerms: false },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async () => {
    setFormError(null);
    try {
      await acceptTerms();
    } catch (error) {
      setFormError(applyApiError(error, form.setError, []));
    }
  });

  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
        {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
        <TermsFields accept={form.register("acceptTerms")} error={errors.acceptTerms?.message} />
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t.submitting : t.submit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void logout();
          }}
        >
          {texts.common.logout}
        </Button>
      </form>
    </AuthLayout>
  );
}
