import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { applyApiError } from "./form-errors";
import { TermsFields } from "./terms-fields";
import { RegisterSchema, type RegisterValues } from "./schemas";
import { texts } from "@/i18n";

export function RegisterPage() {
  const t = texts.auth.register;
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      companyName: "",
      acceptTerms: false,
      marketingOptIn: false,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const account = await register({ ...values, acceptTerms: true });
      const slug = account.memberships[0]?.workspace.slug;
      void navigate(slug === undefined ? "/app" : `/app/${slug}`, {
        replace: true,
        viewTransition: true,
      });
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, ["name", "email", "password", "companyName"]),
      );
    }
  });

  return (
    <AuthLayout
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <>
          {t.hasAccount}{" "}
          <Link to="/login" viewTransition className="font-medium text-primary hover:underline">
            {t.login}
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5">
        {formError !== null && <FormAlert tone="danger">{formError}</FormAlert>}
        <FormField label={texts.common.name} error={errors.name?.message}>
          {(field) => <Input autoComplete="name" {...field} {...form.register("name")} />}
        </FormField>
        <FormField label={texts.common.email} error={errors.email?.message}>
          {(field) => (
            <Input type="email" autoComplete="email" {...field} {...form.register("email")} />
          )}
        </FormField>
        <FormField label={texts.common.company} error={errors.companyName?.message}>
          {(field) => (
            <Input autoComplete="organization" {...field} {...form.register("companyName")} />
          )}
        </FormField>
        <FormField
          label={texts.common.password}
          error={errors.password?.message}
          hint={t.passwordHint}
        >
          {(field) => (
            <PasswordInput autoComplete="new-password" {...field} {...form.register("password")} />
          )}
        </FormField>
        <TermsFields
          accept={form.register("acceptTerms")}
          marketing={form.register("marketingOptIn")}
          error={errors.acceptTerms?.message}
        />
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {t.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
