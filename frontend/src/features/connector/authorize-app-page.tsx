// /authorize-app#request=… — the consent screen of the connector for Claude (docs/spec/conector-mcp.md).
// The server checked the request and signed it; it travels in the fragment (never sent to a server),
// also through the sign-in screen (?next=/authorize-app#request=…), and is removed from the address. The person sees which app,
// where it sends them back, picks the company and allows or cancels; the server answers where to go.
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Plug, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { Splash } from "@/auth/guards";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Banner, Skeleton } from "@/components/ui/display";
import { texts } from "@/i18n";
import { api, ApiError } from "@/lib/api";

type Reason = "invalid_client" | "invalid_redirect_uri" | "invalid_request" | "expired" | "missing";

interface Overview {
  client: { name: string; redirectHost: string; loopbackOnly: boolean; verified: boolean };
  wantsWrite: boolean;
  companies: { slug: string; name: string; canWrite: boolean }[];
}

/** The request or the error the server put in the fragment, read once and removed from the address. */
function takeFromHash(): { request: string | null; error: Reason | null } {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const request = hash.get("request");
  const error = hash.get("error");
  if (window.location.hash !== "") {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }
  const known: Reason[] = ["invalid_client", "invalid_redirect_uri", "invalid_request", "expired"];
  return {
    request,
    error: known.find((reason) => reason === error) ?? null,
  };
}

export function AuthorizeAppPage() {
  const t = texts.connector.consent;
  const { status } = useAuth();
  const [initial] = useState(takeFromHash);
  const { request } = initial;
  const [slug, setSlug] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["oauth", "consent", request],
    queryFn: () => api<Overview>(`/oauth/consent?request=${encodeURIComponent(request ?? "")}`),
    enabled: status === "authenticated" && request !== null && initial.error === null,
    retry: false,
  });
  const companies = overview.data?.companies ?? [];
  useEffect(() => {
    if (slug === null && companies[0] !== undefined) setSlug(companies[0].slug);
  }, [companies, slug]);

  const decide = useMutation({
    mutationFn: (allow: boolean) =>
      api<{ redirectTo: string }>("/oauth/consent", {
        method: "POST",
        body: { request, allow, ...(slug === null ? {} : { workspaceSlug: slug }) },
      }),
    onSuccess: ({ redirectTo }) => {
      window.location.assign(redirectTo);
    },
  });

  if (status === "loading") return <Splash />;
  if (status === "anonymous" && request !== null) {
    // Back here after signing in, with the request in the fragment again.
    const next = `/authorize-app#request=${encodeURIComponent(request)}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  const failure: Reason | null =
    initial.error ??
    (request === null
      ? "missing"
      : overview.error instanceof ApiError
        ? ((overview.error.details as { reason?: Reason } | undefined)?.reason ?? "invalid_request")
        : null);

  const chosen = companies.find((company) => company.slug === slug);
  return (
    <AuthLayout title={t.title} subtitle={t.subtitle}>
      {failure !== null ? (
        <FormAlert tone="danger">{t.errors[failure]}</FormAlert>
      ) : overview.data === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid gap-5">
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{t.app(overview.data.client.name)}</p>
              <p className="text-sm text-muted-foreground">
                {t.redirect(overview.data.client.redirectHost)}
              </p>
              {overview.data.client.verified && (
                <p className="text-xs text-muted-foreground">{t.verified}</p>
              )}
            </div>
          </div>
          {overview.data.client.loopbackOnly && (
            <Banner tone="warning" icon={AlertTriangle}>
              {t.loopback}
            </Banner>
          )}
          {companies.length === 0 ? (
            <FormAlert tone="danger">{t.noCompanies}</FormAlert>
          ) : (
            <>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">{t.company}</legend>
                <p className="text-xs text-muted-foreground">{t.companyHelp}</p>
                {companies.map((company) => (
                  <label
                    key={company.slug}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="company"
                      value={company.slug}
                      checked={slug === company.slug}
                      onChange={() => {
                        setSlug(company.slug);
                      }}
                    />
                    {company.name}
                  </label>
                ))}
              </fieldset>
              <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  {t.willRead}
                </li>
                {overview.data.wantsWrite && chosen?.canWrite === true && (
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {t.willWrite}
                  </li>
                )}
                {overview.data.wantsWrite && chosen?.canWrite === false && (
                  <li className="flex gap-2 text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {t.readOnly}
                  </li>
                )}
                <li className="flex gap-2 text-muted-foreground">
                  <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t.never}
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">{t.revokeHint}</p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {companies.length > 0 && (
              <Button
                disabled={decide.isPending || slug === null}
                onClick={() => {
                  decide.mutate(true);
                }}
              >
                {decide.isPending ? t.sending : t.allow}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate(false);
              }}
            >
              {t.deny}
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
