import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input, PasswordInput } from "@/components/ui/form";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { safeNext } from "@/lib/utils";
import { applyApiError } from "./form-errors";
import { LoginSchema, type LoginValues } from "./schemas";
import { texts } from "@/i18n";

export function LoginPage() {
  const t = texts.auth.login;
  const { login } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await login(values.email, values.password);
      if ("challenge" in result) {
        setChallenge(result.challenge);
        return;
      }
      void navigate(safeNext(params.get("next")), { replace: true, viewTransition: true });
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, ["email", "password"], {
          INVALID_CREDENTIALS: t.invalid,
        }),
      );
    }
  });

  if (challenge !== null) {
    return (
      <MfaStep
        challenge={challenge}
        onDone={() => {
          void navigate(safeNext(params.get("next")), { replace: true, viewTransition: true });
        }}
        onBack={() => {
          setChallenge(null);
          form.setValue("password", "");
        }}
      />
    );
  }

  return (
    <AuthLayout
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.noAccount}{" "}
          <Link to="/register" viewTransition className="font-medium text-primary hover:underline">
            {t.register}
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
        {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
        <FormField label={texts.common.email} error={errors.email?.message}>
          {(field) => (
            <Input type="email" autoComplete="email" {...field} {...form.register("email")} />
          )}
        </FormField>
        <FormField label={texts.common.password} error={errors.password?.message}>
          {(field) => (
            <PasswordInput
              autoComplete="current-password"
              {...field}
              {...form.register("password")}
            />
          )}
        </FormField>
        <Link
          to="/forgot-password"
          className="-mt-2 justify-self-end text-sm text-primary hover:underline"
        >
          {t.forgot}
        </Link>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {t.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Segundo paso: el código de la app o uno de recuperación, y «Recordar este dispositivo». */
function MfaStep({
  challenge,
  onDone,
  onBack,
}: {
  challenge: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = texts.auth.login.mfa;
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await verifyMfa(challenge, code.trim(), remember);
      onDone();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "INVALID_TOKEN") {
        // El desafío venció: se vuelve a la contraseña.
        onBack();
        return;
      }
      setError(
        failure instanceof ApiError && failure.code === "MFA_INVALID_CODE"
          ? t.invalid
          : errorText(failure),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-5">
        {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
        <FormField label={t.code} hint={t.recoveryHint}>
          {(field) => (
            <Input
              {...field}
              autoFocus
              autoComplete="one-time-code"
              maxLength={20}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={t.remember}
          checked={remember}
          onChange={(event) => {
            setRemember(event.target.checked);
          }}
        />
        <Button type="submit" size="lg" disabled={pending || code.trim().length < 6}>
          {t.submit}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.back}
        </Button>
      </form>
    </AuthLayout>
  );
}
