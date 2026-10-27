// /app/:slug/admin/security — Seguridad (CLAUDE.md, sección 9.3): quién ve a quién, jefes y
// autoaprobación. Lo hace cumplir el servidor; esta pantalla solo cambia el ajuste. Exigir 2FA y los
// dominios permitidos son del plugin security-policies (docs/spec/plugins.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileCheck2, Languages, UserPlus } from "lucide-react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, Switch } from "@/components/ui/form";
import { adminApi, adminKeys, type SecuritySettings } from "../api";
import { adminErrorText } from "../admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { cn } from "@/lib/utils";
import { visibilityChoices } from "../choices";
import { EmailTab } from "./email-tab";
import { isLocale, LOCALE_NAMES, LOCALES, texts } from "@/i18n";

function SecurityGeneral() {
  const t = texts.admin.security;
  const visibilitySource = useStaticSource("visibility", visibilityChoices);
  const languageSource = useStaticSource(
    "company-language",
    LOCALES.map((id) => ({ id, label: LOCALE_NAMES[id] })),
  );
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: adminKeys.security(workspaceSlug),
    queryFn: () => adminApi.securitySettings(workspaceSlug),
    select: (data) => data.settings,
  });
  const update = useMutation({
    mutationFn: (changes: Partial<SecuritySettings>) =>
      adminApi.updateSecuritySettings(workspaceSlug, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.security(workspaceSlug) });
      toast.success(texts.admin.common.saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = settings.data;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Languages
            className="size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 break-words">
            <CardTitle className="text-base">{t.language.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.language.text}</p>
          </div>
        </div>
        {data === undefined ? (
          <Skeleton className="mt-5 h-10 w-full max-w-sm" />
        ) : (
          <div className="mt-5 max-w-sm">
            <FormField label={t.language.label}>
              {(control) => (
                <Combobox
                  id={control.id}
                  label={t.language.label}
                  placeholder={t.language.label}
                  searchable={false}
                  disabled={update.isPending}
                  source={languageSource}
                  value={data.locale}
                  onChange={(option) => {
                    if (option !== null && isLocale(option.id)) {
                      update.mutate({ locale: option.id });
                    }
                  }}
                />
              )}
            </FormField>
          </div>
        )}
      </Card>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <Eye className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0 break-words">
            <CardTitle className="text-base">{t.visibility.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.visibility.text}</p>
          </div>
        </div>
        {data === undefined ? (
          <Skeleton className="mt-5 h-10 w-full max-w-sm" />
        ) : (
          <div className="mt-5 max-w-sm">
            <FormField label={t.visibility.label} hint={t.visibility.hint}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={t.visibility.label}
                  placeholder={t.visibility.label}
                  searchable={false}
                  disabled={update.isPending}
                  source={visibilitySource}
                  value={data.memberVisibility}
                  onChange={(option) => {
                    if (option !== null) {
                      update.mutate({
                        memberVisibility: option.id === "department" ? "department" : "company",
                      });
                    }
                  }}
                />
              )}
            </FormField>
          </div>
        )}
      </Card>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <UserPlus
            className="size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 break-words">
            <CardTitle className="text-base">{t.leaders.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.leaders.text}</p>
          </div>
        </div>
        {data === undefined ? (
          <Skeleton className="mt-5 h-10 w-full max-w-sm" />
        ) : (
          <div className="mt-5 flex max-w-xl items-start gap-3">
            <Switch
              id="leaders-can-invite"
              aria-labelledby="leaders-can-invite-label"
              checked={data.leadersCanInvite}
              disabled={update.isPending}
              onCheckedChange={(leadersCanInvite) => {
                update.mutate({ leadersCanInvite });
              }}
            />
            <div className="min-w-0 break-words">
              <p id="leaders-can-invite-label" className="text-sm font-medium">
                {t.leaders.invite}
              </p>
              <p className="text-xs text-muted-foreground">{t.leaders.inviteHint}</p>
            </div>
          </div>
        )}
      </Card>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <FileCheck2
            className="size-5 shrink-0 text-primary"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 break-words">
            <CardTitle className="text-base">{t.documents.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.documents.text}</p>
          </div>
        </div>
        {data === undefined ? (
          <Skeleton className="mt-5 h-10 w-full max-w-sm" />
        ) : (
          <div className="mt-5 flex max-w-xl items-start gap-3">
            <Switch
              id="allow-self-approval"
              aria-labelledby="allow-self-approval-label"
              checked={data.allowSelfApproval}
              disabled={update.isPending}
              onCheckedChange={(allowSelfApproval) => {
                update.mutate({ allowSelfApproval });
              }}
            />
            <div className="min-w-0 break-words">
              <p id="allow-self-approval-label" className="text-sm font-medium">
                {t.documents.selfApproval}
              </p>
              <p className="text-xs text-muted-foreground">{t.documents.selfApprovalHint}</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Seguridad: «General» es solo del propietario (el servidor lo hace cumplir); «Email» lo ven también
 * los administradores con la capacidad de seguridad. Quien no es propietario entra directo a Email.
 */
export function SecurityPage() {
  const t = texts.admin.security;
  const isOwner = useMembership().role.base === "OWNER";
  const [params, setParams] = useSearchParams();
  const tabs = [
    ...(isOwner ? [{ id: "general", label: t.tabs.general }] : []),
    { id: "email", label: t.tabs.email },
  ];
  const wanted = params.get("tab");
  const tab = tabs.find((item) => item.id === wanted)?.id ?? (isOwner ? "general" : "email");

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label={t.tabs.label} className="flex gap-1 border-b border-border">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                tab === item.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setParams(item.id === "general" ? {} : { tab: item.id }, { replace: true });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {tab === "general" ? <SecurityGeneral /> : <EmailTab />}
    </div>
  );
}
