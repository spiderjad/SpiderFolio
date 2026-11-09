// /canal/:workspaceSlug — the whistleblowing channel's public page (docs/spec/canal-denuncias.md): no
// account, nothing about the reporter is kept. It tells what can be reported, the guarantees and the
// external channels, takes the report and shows the follow-up code once.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Inbox, Megaphone, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Banner, Card, Logo, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, PasswordInput, Textarea } from "@/components/ui/form";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import {
  reporterApi,
  reporterKeys,
  type ChannelPage,
  type ReportInput,
} from "./whistleblowing-api";
import { texts } from "@/i18n";

const t = texts.whistleblowing.public;
const PASSWORD_MIN = 10;

/** The frame of the channel's public pages: outside the company's app, like the contractors' portal. */
export function ChannelFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeToggle />
          {actions}
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}

export function ChannelPage() {
  const { workspaceSlug = "" } = useParams();
  const page = useQuery({
    queryKey: reporterKeys.page(workspaceSlug),
    queryFn: () => reporterApi.page(workspaceSlug),
    select: (data) => data.page,
    retry: false,
  });
  const [step, setStep] = useState<"info" | "form" | { code: string }>("info");
  const data = page.data;
  return (
    <ChannelFrame>
      {page.isError ? (
        <Banner tone="warning">{t.unavailable}</Banner>
      ) : data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle(data.company)}</p>
          </div>
          {!data.available ? (
            <>
              <Banner tone="warning">{t.unavailable}</Banner>
              <External text={data.externalChannels} />
            </>
          ) : step === "info" ? (
            <Info
              data={data}
              slug={workspaceSlug}
              onStart={() => {
                setStep("form");
              }}
            />
          ) : step === "form" ? (
            <ReportForm
              data={data}
              slug={workspaceSlug}
              onCancel={() => {
                setStep("info");
              }}
              onSent={(code) => {
                setStep({ code });
              }}
            />
          ) : (
            <Sent company={data.company} slug={workspaceSlug} code={step.code} />
          )}
        </>
      )}
    </ChannelFrame>
  );
}

function External({ text }: { text: string }) {
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <h2 className="text-base font-semibold">{t.external}</h2>
      <p className="whitespace-pre-line text-sm text-muted-foreground">
        {text.trim() === "" ? t.externalDefault : text}
      </p>
    </Card>
  );
}

function Info({ data, slug, onStart }: { data: ChannelPage; slug: string; onStart: () => void }) {
  return (
    <>
      {data.intro.trim() !== "" && <p className="whitespace-pre-line text-sm">{data.intro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onStart}>
          <Megaphone className="size-4" aria-hidden="true" />
          {t.start}
        </Button>
        <Button asChild variant="outline">
          <Link to={`/canal/${slug}/buzon`}>
            <Inbox className="size-4" aria-hidden="true" />
            {t.followUp}
          </Link>
        </Button>
      </div>
      <Card className="grid gap-4 p-4 sm:p-5">
        <section className="grid gap-1">
          <h2 className="text-base font-semibold">{t.what}</h2>
          <p className="text-sm text-muted-foreground">{t.whatText}</p>
        </section>
        <section className="grid gap-1">
          <h2 className="text-base font-semibold">{t.who}</h2>
          <p className="text-sm text-muted-foreground">{t.whoText}</p>
        </section>
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">{t.guarantees}</h2>
          <ul className="grid gap-2 text-sm">
            {t.guaranteeList.map((line) => (
              <li key={line} className="flex gap-2">
                <ShieldCheck
                  className="mt-0.5 size-4 shrink-0 text-success"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </Card>
      <External text={data.externalChannels} />
    </>
  );
}

function ReportForm({
  data,
  slug,
  onCancel,
  onSent,
}: {
  data: ChannelPage;
  slug: string;
  onCancel: () => void;
  onSent: (code: string) => void;
}) {
  const f = t.form;
  const categories = useStaticSource(
    `channel-categories-${slug}`,
    data.categories.map((name) => ({ id: name, label: name })),
  );
  const [state, setState] = useState({
    category: null as string | null,
    account: "",
    people: "",
    when: "",
    where: "",
    identify: false,
    name: "",
    contact: "",
    excluded: [] as string[],
    password: "",
    repeat: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const send = useMutation({
    mutationFn: () => {
      const body: ReportInput = {
        category: state.category ?? "",
        account: state.account.trim(),
        people: state.people.trim(),
        when: state.when.trim(),
        where: state.where.trim(),
        contact: state.identify ? { name: state.name.trim(), contact: state.contact.trim() } : null,
        excluded: state.excluded,
        password: state.password,
      };
      return reporterApi.report(slug, body);
    },
    onSuccess: ({ code }) => {
      onSent(code);
    },
    onError: (failed) => {
      setError(failed instanceof ApiError ? errorText(failed) : String(failed));
    },
  });
  const differ = state.repeat !== "" && state.repeat !== state.password;
  const ready =
    state.category !== null &&
    state.account.trim() !== "" &&
    (!state.identify || state.name.trim() !== "") &&
    state.password.length >= PASSWORD_MIN &&
    state.repeat === state.password &&
    state.excluded.length < Math.max(1, data.managers.length);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !send.isPending) send.mutate();
  };
  return (
    <Card className="p-4 sm:p-5">
      <form className="grid gap-4" onSubmit={submit}>
        <h2 className="text-lg font-semibold">{f.title}</h2>
        {error !== null && (
          <p role="alert" className="v-banner v-banner--danger">
            {error}
          </p>
        )}
        <FormField label={f.category}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={f.category}
              placeholder={f.categoryPlaceholder}
              source={categories}
              value={state.category}
              onChange={(option) => {
                set({ category: option?.id ?? null });
              }}
            />
          )}
        </FormField>
        <FormField label={f.account} hint={f.accountHint}>
          {(control) => (
            <Textarea
              {...control}
              rows={7}
              maxLength={20_000}
              value={state.account}
              onChange={(event) => {
                set({ account: event.target.value });
              }}
            />
          )}
        </FormField>
        <FormField label={f.people} hint={f.peopleHint}>
          {(control) => (
            <Input
              {...control}
              maxLength={2_000}
              value={state.people}
              onChange={(event) => {
                set({ people: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.when} hint={f.whenHint}>
            {(control) => (
              <Input
                {...control}
                maxLength={2_000}
                value={state.when}
                onChange={(event) => {
                  set({ when: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.where} hint={f.whereHint}>
            {(control) => (
              <Input
                {...control}
                maxLength={2_000}
                value={state.where}
                onChange={(event) => {
                  set({ where: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <Checkbox
            label={f.identify}
            checked={state.identify}
            onChange={(event) => {
              set({ identify: event.target.checked });
            }}
          />
          <p className="v-help mt-0">{f.identifyHint}</p>
          {state.identify && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={f.name}>
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="name"
                    maxLength={300}
                    value={state.name}
                    onChange={(event) => {
                      set({ name: event.target.value });
                    }}
                  />
                )}
              </FormField>
              <FormField label={f.contact} hint={f.contactHint}>
                {(control) => (
                  <Input
                    {...control}
                    maxLength={300}
                    value={state.contact}
                    onChange={(event) => {
                      set({ contact: event.target.value });
                    }}
                  />
                )}
              </FormField>
            </div>
          )}
        </div>
        {data.managers.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="v-label">{f.exclude}</legend>
            <p className="v-help mt-0">{f.excludeHint}</p>
            {data.managers.map((manager) => (
              <Checkbox
                key={manager.id}
                label={manager.name}
                checked={state.excluded.includes(manager.id)}
                disabled={
                  !state.excluded.includes(manager.id) &&
                  state.excluded.length >= data.managers.length - 1
                }
                onChange={(event) => {
                  set({
                    excluded: event.target.checked
                      ? [...state.excluded, manager.id]
                      : state.excluded.filter((id) => id !== manager.id),
                  });
                }}
              />
            ))}
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.password} hint={f.passwordHint(PASSWORD_MIN)}>
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="new-password"
                maxLength={200}
                value={state.password}
                onChange={(event) => {
                  set({ password: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.passwordRepeat} {...(differ ? { error: f.passwordsDiffer } : {})}>
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="new-password"
                maxLength={200}
                value={state.repeat}
                onChange={(event) => {
                  set({ repeat: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <Banner tone="info">{f.warning}</Banner>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={send.isPending} onClick={onCancel}>
            {f.cancel}
          </Button>
          <Button type="submit" disabled={!ready || send.isPending}>
            {send.isPending ? f.sending : f.submit}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Sent({ company, slug, code }: { company: string; slug: string; code: string }) {
  const s = t.sent;
  const mailboxUrl = `${window.location.origin}/canal/${slug}/buzon`;
  const download = () => {
    const blob = new Blob([s.fileText(company, code, mailboxUrl)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = s.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card className="grid gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Check className="size-5 text-success" aria-hidden="true" />
        <h2 className="text-lg font-semibold">{s.title}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{s.text}</p>
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-center font-mono text-xl tracking-widest">
        {code}
      </p>
      <Banner tone="warning">{t.form.warning}</Banner>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => toast.success(s.copied));
          }}
        >
          <Copy className="size-4" aria-hidden="true" />
          {s.copy}
        </Button>
        <Button variant="outline" onClick={download}>
          <Download className="size-4" aria-hidden="true" />
          {s.download}
        </Button>
        <Button asChild>
          <Link to={`/canal/${slug}/buzon`}>
            <Inbox className="size-4" aria-hidden="true" />
            {s.mailbox}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
