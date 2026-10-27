// Seguridad › Email: remitente de email propio por empresa (SMTP). El servidor valida todo y
// cifra la contraseña; esta pantalla no la vuelve a mostrar nunca. Para activar hay que enviar
// antes un email de prueba con la configuración guardada.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Banner, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, PasswordInput } from "@/components/ui/form";
import { adminApi, adminKeys, type EmailSettings, type SmtpSecurity } from "../api";
import { adminErrorText } from "../admin-utils";
import { smtpPortChoices, smtpSecurityChoices } from "../choices";
import { texts } from "@/i18n";

type Config = NonNullable<EmailSettings["config"]>;

export function EmailTab() {
  const t = texts.admin.security.email;
  const { workspaceSlug = "" } = useParams();
  const settings = useQuery({
    queryKey: adminKeys.email(workspaceSlug),
    queryFn: () => adminApi.emailSettings(workspaceSlug),
  });
  const data = settings.data;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <MailCheck
            className="size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 break-words">
            <CardTitle className="text-base">{t.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.text}</p>
          </div>
        </div>
        {data === undefined ? (
          <Skeleton className="mt-5 h-40 w-full max-w-xl" />
        ) : !data.available ? (
          <div className="mt-5">
            <Banner>{t.unavailable}</Banner>
          </div>
        ) : (
          <EmailForm
            key={
              data.config === null ? "new" : `${data.config.status}-${data.config.testedAt ?? ""}`
            }
            slug={workspaceSlug}
            config={data.config}
          />
        )}
      </Card>
      <DnsGuide />
      {data?.included === true && data.available && <DomainCard slug={workspaceSlug} data={data} />}
    </div>
  );
}

function EmailForm({ slug, config }: { slug: string; config: Config | null }) {
  const t = texts.admin.security.email;
  const queryClient = useQueryClient();
  const portSource = useStaticSource("smtp-port", smtpPortChoices);
  const securitySource = useStaticSource("smtp-security", smtpSecurityChoices);
  const [fromName, setFromName] = useState(config?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(config?.fromEmail ?? "");
  const [replyTo, setReplyTo] = useState(config?.replyTo ?? "");
  const [smtpHost, setSmtpHost] = useState(config?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(config?.smtpPort ?? 587));
  const [smtpSecurity, setSmtpSecurity] = useState<SmtpSecurity>(
    config?.smtpSecurity ?? "STARTTLS",
  );
  const [smtpUser, setSmtpUser] = useState(config?.smtpUser ?? "");
  const [smtpPass, setSmtpPass] = useState("");

  const refresh = (next: EmailSettings) => {
    queryClient.setQueryData(adminKeys.email(slug), next);
  };
  const onError = (error: unknown) => {
    toast.error(adminErrorText(error));
  };

  const save = useMutation({
    mutationFn: () =>
      adminApi.updateEmailSettings(slug, {
        fromName,
        fromEmail,
        replyTo: replyTo.trim() === "" ? null : replyTo,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecurity,
        smtpUser: smtpUser.trim() === "" ? null : smtpUser,
        ...(smtpPass === "" ? {} : { smtpPass }),
      }),
    onSuccess: (next) => {
      setSmtpPass("");
      refresh(next);
      toast.success(t.saved);
    },
    onError,
  });
  const test = useMutation({
    mutationFn: () => adminApi.testEmailSettings(slug),
    onSuccess: ({ result, settings }) => {
      refresh(settings);
      if (result.ok) toast.success(t.testOk);
      else toast.error(result.message ?? texts.errors.generic);
    },
    onError,
  });
  const activate = useMutation({
    mutationFn: () => adminApi.activateEmail(slug),
    onSuccess: (next) => {
      refresh(next);
      toast.success(t.activated);
    },
    onError,
  });
  const deactivate = useMutation({
    mutationFn: () => adminApi.deactivateEmail(slug),
    onSuccess: (next) => {
      refresh(next);
      toast.success(t.deactivated);
    },
    onError,
  });

  const busy = save.isPending || test.isPending || activate.isPending || deactivate.isPending;
  const status = config?.status ?? "DRAFT";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="mt-4 grid max-w-3xl gap-4" onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t.status[status]}</Badge>
        {config !== null && <Badge>{config.tested ? t.tested : t.notTested}</Badge>}
      </div>
      {config?.status === "DISABLED" && <Banner>{t.disabledNotice}</Banner>}
      {config?.status === "ACTIVE" && config.lastFallbackAlertAt !== null && (
        <Banner>{t.fallbackNotice}</Banner>
      )}
      {config?.lastError != null && (
        <p className="text-xs text-muted-foreground">{t.lastError(config.lastError)}</p>
      )}

      <FormGrid columns={3}>
        <FormField label={t.fields.smtpHost} className="md:col-span-2">
          {(control) => (
            <Input
              {...control}
              value={smtpHost}
              placeholder="smtp.tuproveedor.com"
              required
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                setSmtpHost(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.smtpPort}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={t.fields.smtpPort}
              placeholder={t.fields.smtpPort}
              searchable={false}
              source={portSource}
              value={smtpPort}
              onChange={(option) => {
                if (option !== null) setSmtpPort(option.id);
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.smtpSecurity}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={t.fields.smtpSecurity}
              placeholder={t.fields.smtpSecurity}
              searchable={false}
              source={securitySource}
              value={smtpSecurity}
              onChange={(option) => {
                if (option !== null) setSmtpSecurity(option.id === "TLS" ? "TLS" : "STARTTLS");
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.smtpUser}>
          {(control) => (
            <Input
              {...control}
              value={smtpUser}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                setSmtpUser(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          label={t.fields.smtpPass}
          {...(config?.hasPassword === true ? { hint: t.fields.smtpPassHint } : {})}
        >
          {(control) => (
            <PasswordInput
              {...control}
              value={smtpPass}
              autoComplete="new-password"
              placeholder={config?.hasPassword === true ? t.fields.smtpPassSaved : ""}
              onChange={(event) => {
                setSmtpPass(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.fromName}>
          {(control) => (
            <Input
              {...control}
              value={fromName}
              maxLength={80}
              required
              onChange={(event) => {
                setFromName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.fromEmail} hint={t.fields.fromEmailHint}>
          {(control) => (
            <Input
              {...control}
              type="email"
              value={fromEmail}
              required
              onChange={(event) => {
                setFromEmail(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.fields.replyTo}>
          {(control) => (
            <Input
              {...control}
              type="email"
              value={replyTo}
              onChange={(event) => {
                setReplyTo(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {save.isPending ? t.actions.saving : t.actions.save}
        </Button>
        <Button
          variant="outline"
          disabled={busy || config === null || config.mode !== "SMTP"}
          onClick={() => {
            test.mutate();
          }}
        >
          {test.isPending ? t.actions.testing : t.actions.test}
        </Button>
        {status === "ACTIVE" ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              deactivate.mutate();
            }}
          >
            {t.actions.deactivate}
          </Button>
        ) : (
          <Button
            disabled={busy || config === null || config.mode !== "SMTP" || !config.tested}
            onClick={() => {
              activate.mutate();
            }}
          >
            {t.actions.activate}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t.testHint}</p>
    </form>
  );
}

function CopyLine({ value }: { value: string }) {
  const t = texts.admin.security.email.guide;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={copied ? t.copied : t.copy}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 2000);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}

function DnsGuide() {
  const t = texts.admin.security.email.guide;
  const items = [t.spf, t.dkim, t.dmarc];
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <details>
        <summary className="cursor-pointer text-base font-semibold">{t.title}</summary>
        <p className="mt-3 max-w-2xl text-xs text-muted-foreground">{t.intro}</p>
        <div className="mt-4 grid max-w-2xl gap-5">
          {items.map((item) => (
            <div key={item.title}>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="text-xs text-muted-foreground">{item.text}</p>
              <CopyLine value={item.example} />
            </div>
          ))}
          <div>
            <h3 className="text-sm font-semibold">{t.test.title}</h3>
            <p className="text-xs text-muted-foreground">{t.test.text}</p>
          </div>
        </div>
      </details>
    </Card>
  );
}

function DomainCard({ slug, data }: { slug: string; data: EmailSettings }) {
  const t = texts.admin.security.email.domain;
  const common = texts.admin.security.email;
  const queryClient = useQueryClient();
  const config = data.config;
  const domain = config?.domain ?? null;
  const [domainName, setDomainName] = useState(domain?.name ?? "");
  const [fromName, setFromName] = useState(
    config?.mode === "DOMAIN" ? (config.fromName ?? "") : "",
  );
  const [localPart, setLocalPart] = useState(
    config?.mode === "DOMAIN" ? (config.fromEmail?.split("@")[0] ?? "") : "",
  );
  const [replyTo, setReplyTo] = useState(config?.mode === "DOMAIN" ? (config.replyTo ?? "") : "");

  const refresh = (next: EmailSettings) => {
    queryClient.setQueryData(adminKeys.email(slug), next);
  };
  const onError = (error: unknown) => {
    toast.error(adminErrorText(error));
  };
  const register = useMutation({
    mutationFn: () =>
      adminApi.registerEmailDomain(slug, {
        domain: domainName,
        fromName,
        fromLocalPart: localPart,
        replyTo: replyTo.trim() === "" ? null : replyTo,
      }),
    onSuccess: (next) => {
      refresh(next);
      toast.success(t.registered);
    },
    onError,
  });
  const verify = useMutation({
    mutationFn: () => adminApi.verifyEmailDomain(slug),
    onSuccess: (next) => {
      refresh(next);
      if (next.config?.domain?.status === "VERIFIED") toast.success(t.allVerified);
      else toast.info(t.stillPending);
    },
    onError,
  });
  const test = useMutation({
    mutationFn: () => adminApi.testEmailSettings(slug),
    onSuccess: ({ result, settings }) => {
      refresh(settings);
      if (result.ok) toast.success(common.testOk);
      else toast.error(result.message ?? texts.errors.generic);
    },
    onError,
  });
  const activate = useMutation({
    mutationFn: () => adminApi.activateEmail(slug),
    onSuccess: (next) => {
      refresh(next);
      toast.success(common.activated);
    },
    onError,
  });
  const deactivate = useMutation({
    mutationFn: () => adminApi.deactivateEmail(slug),
    onSuccess: (next) => {
      refresh(next);
      toast.success(common.deactivated);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => adminApi.removeEmailDomain(slug),
    onSuccess: (next) => {
      refresh(next);
      setDomainName("");
      toast.success(t.removed);
    },
    onError,
  });

  const busy =
    register.isPending ||
    verify.isPending ||
    test.isPending ||
    activate.isPending ||
    deactivate.isPending ||
    remove.isPending;
  const domainConfig = config?.mode === "DOMAIN" ? config : null;
  const verified = domain?.status === "VERIFIED";

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="min-w-0 break-words">
        <CardTitle className="text-base">{t.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{t.text}</p>
      </div>
      {!data.domainAvailable ? (
        <div className="mt-5">
          <Banner tone="info">{t.soon}</Banner>
        </div>
      ) : (
        <div className="mt-5 grid max-w-2xl gap-5">
          {config !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t.mode[config.mode]}</Badge>
              {domainConfig !== null && <Badge>{common.status[domainConfig.status]}</Badge>}
              {domainConfig !== null && (
                <Badge>{domainConfig.tested ? common.tested : common.notTested}</Badge>
              )}
            </div>
          )}
          <form
            className="grid items-start gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              register.mutate();
            }}
          >
            <FormField label={t.domain} hint={t.domainHint} className="sm:col-span-2">
              {(control) => (
                <Input
                  {...control}
                  value={domainName}
                  placeholder="empresa.com"
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={domain !== null}
                  onChange={(event) => {
                    setDomainName(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={t.fromName}>
              {(control) => (
                <Input
                  {...control}
                  value={fromName}
                  maxLength={80}
                  required
                  onChange={(event) => {
                    setFromName(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={t.localPart} hint={t.localPartHint}>
              {(control) => (
                <Input
                  {...control}
                  value={localPart}
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => {
                    setLocalPart(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={t.replyTo} className="sm:col-span-2">
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={replyTo}
                  onChange={(event) => {
                    setReplyTo(event.target.value);
                  }}
                />
              )}
            </FormField>
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {register.isPending ? t.registering : domain === null ? t.register : t.update}
              </Button>
              {domain !== null && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    remove.mutate();
                  }}
                >
                  {t.remove}
                </Button>
              )}
            </div>
          </form>

          {domain !== null && (
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold">{t.recordsTitle}</h3>
              <p className="text-xs text-muted-foreground">{t.recordsHint}</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t.columns.type}</th>
                      <th className="px-3 py-2 font-medium">{t.columns.name}</th>
                      <th className="px-3 py-2 font-medium">{t.columns.value}</th>
                      <th className="px-3 py-2 font-medium">{t.columns.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domain.records.map((record) => (
                      <tr key={`${record.type}-${record.name}`} className="border-t border-border">
                        <td className="px-3 py-2 align-top">{record.type}</td>
                        <td className="px-3 py-2 align-top">
                          <CopyLine value={record.name} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <CopyLine value={record.value} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge>{record.verified ? t.verified : t.pending}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    verify.mutate();
                  }}
                >
                  {verify.isPending ? t.verifying : t.verify}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !verified || domainConfig === null}
                  onClick={() => {
                    test.mutate();
                  }}
                >
                  {test.isPending ? common.actions.testing : common.actions.test}
                </Button>
                {domainConfig?.status === "ACTIVE" ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      deactivate.mutate();
                    }}
                  >
                    {common.actions.deactivate}
                  </Button>
                ) : (
                  <Button
                    disabled={busy || !verified || domainConfig === null || !domainConfig.tested}
                    onClick={() => {
                      activate.mutate();
                    }}
                  >
                    {common.actions.activate}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
