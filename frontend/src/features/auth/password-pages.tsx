// Recuperar contraseña (pide el email) y restablecerla (con el token del enlace).
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { api, ApiError } from "@/lib/api";
import { applyApiError } from "./form-errors";
import { ForgotSchema, ResetSchema, type ForgotValues, type ResetValues } from "./schemas";
import { takeTokenFromHash } from "./token-from-hash";
import { texts } from "@/i18n";

const backToLogin = (
  <Link to="/login" viewTransition className="font-medium text-primary hover:underline">
    {texts.common.backToLogin}
  </Link>
);

export function ForgotPasswordPage() {
  const t = texts.auth.forgot;
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ForgotValues>({
    resolver: zodResolver(ForgotSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", body: values });
      setSent(true);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ["email"]));
    }
  });

  return (
    <AuthLayout title={t.title} subtitle={t.subtitle} footer={backToLogin}>
      {sent ? (
        <FormAlert tone="success">{t.sent}</FormAlert>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
          {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
          <FormField label={texts.common.email} error={errors.email?.message}>
            {(field) => (
              <Input type="email" autoComplete="email" {...field} {...form.register("email")} />
            )}
          </FormField>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {t.submit}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const t = texts.auth.reset;
  // Se toma una sola vez del fragmento y se borra de la URL.
  const token = useRef<string | null | undefined>(undefined);
  token.current ??= takeTokenFromHash();
  const [state, setState] = useState<"form" | "done" | "invalid">(
    token.current === null ? "invalid" : "form",
  );
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetValues>({
    resolver: zodResolver(ResetSchema),
    defaultValues: { password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: { token: token.current, password: values.password },
      });
      setState("done");
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_TOKEN") setState("invalid");
      else setFormError(applyApiError(error, form.setError, ["password"]));
    }
  });

  return (
    <AuthLayout title={t.title} footer={backToLogin}>
      {state === "done" && <FormAlert tone="success">{t.done}</FormAlert>}
      {state === "invalid" && (
        <div className="grid gap-4">
          <FormAlert tone="danger">{t.invalid}</FormAlert>
          <Button asChild size="lg" variant="outline">
            <Link to="/forgot-password">{t.requestNew}</Link>
          </Button>
        </div>
      )}
      {state === "form" && (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
          {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
          <FormField
            label={t.newPassword}
            error={errors.password?.message}
            hint={texts.auth.register.passwordHint}
          >
            {(field) => (
              <PasswordInput
                autoComplete="new-password"
                {...field}
                {...form.register("password")}
              />
            )}
          </FormField>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {t.submit}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
