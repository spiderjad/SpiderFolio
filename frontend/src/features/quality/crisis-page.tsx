// /app/:slug/calidad/crisis — crisis and recall (docs/spec/calidad.md, «Gestión de crisis y retirada»):
// the crisis team, its outside contacts and the recall tests with the next one due. quality.manage
// changes them; quality.view reads them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FolderOpen, Plus, UserMinus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { CRISIS_CONTACT_KINDS, complaintKeys, complaintsApi, qualityKeys } from "./quality-api";
import { todayDay, useQuality, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.crisis;
const KINDS = ["DRILL", "REAL"] as const;
const DIRECTIONS = ["BACKWARD", "FORWARD", "BOTH"] as const;

function useSave(onClose: () => void, message: string) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return {
    onSuccess: async () => {
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(adminErrorText(error));
    },
  };
}

function Footer({
  pending,
  ready,
  onSave,
}: {
  pending: boolean;
  ready: boolean;
  onSave: () => void;
}) {
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" disabled={pending}>
          {texts.admin.common.cancel}
        </Button>
      </DialogClose>
      <Button disabled={!ready || pending} onClick={onSave}>
        {pending ? texts.admin.common.saving : texts.admin.common.create}
      </Button>
    </>
  );
}

function MemberDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const people = usePeopleSource();
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [role, setRole] = useState("");
  const save = useMutation({
    mutationFn: () => complaintsApi.addMember(workspaceSlug, person?.id ?? "", role.trim()),
    ...useSave(onClose, t.team.added),
  });
  return (
    <DialogContent
      title={t.team.add}
      footer={
        <Footer
          pending={save.isPending}
          ready={person !== null && role.trim() !== ""}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <FormField label={t.team.person}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={t.team.person}
              placeholder={t.team.person}
              source={people}
              value={person?.id ?? null}
              valueLabel={person?.name}
              onChange={(option) => {
                setPerson(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
        <FormField label={t.team.role}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              placeholder={t.team.rolePlaceholder}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function ContactDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.contacts.form;
  const kinds = useStaticSource(
    "quality-crisis-contact-kinds",
    CRISIS_CONTACT_KINDS.map((id) => ({ id, label: t.contacts.kinds[id] })),
  );
  const [state, setState] = useState({
    kind: "AUTHORITY" as (typeof CRISIS_CONTACT_KINDS)[number],
    name: "",
    organization: "",
    phone: "",
    email: "",
    notes: "",
  });
  const blank = (text: string) => (text.trim() === "" ? null : text.trim());
  const save = useMutation({
    mutationFn: () =>
      complaintsApi.addContact(workspaceSlug, {
        kind: state.kind,
        name: state.name.trim(),
        organization: blank(state.organization),
        phone: blank(state.phone),
        email: blank(state.email),
        notes: blank(state.notes),
      }),
    ...useSave(onClose, f.created),
  });
  const text = (key: "name" | "organization" | "phone" | "email", label: string, max: number) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          {...(key === "email" ? { type: "email" } : {})}
          value={state[key]}
          onChange={(event) => {
            setState({ ...state, [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={state.name.trim() !== ""}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={state.kind}
                onChange={(option) => {
                  const next = CRISIS_CONTACT_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setState({ ...state, kind: next });
                }}
              />
            )}
          </FormField>
          {text("name", f.name, 160)}
        </div>
        {text("organization", f.organization, 160)}
        <div className="grid gap-4 sm:grid-cols-2">
          {text("phone", f.phone, 40)}
          {text("email", f.email, 254)}
        </div>
        <FormField label={f.notes}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={500}
              value={state.notes}
              onChange={(event) => {
                setState({ ...state, notes: event.target.value });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function TestDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.tests.form;
  const kinds = useStaticSource(
    "quality-recall-kinds",
    KINDS.map((id) => ({ id, label: t.tests.kinds[id] })),
  );
  const directions = useStaticSource(
    "quality-recall-directions",
    DIRECTIONS.map((id) => ({ id, label: t.tests.directions[id] })),
  );
  const [state, setState] = useState({
    kind: "DRILL" as (typeof KINDS)[number],
    date: todayDay(),
    product: "",
    lot: "",
    direction: "BOTH" as (typeof DIRECTIONS)[number],
    minutes: "",
    recovered: "",
    result: "",
  });
  const save = useMutation({
    mutationFn: () =>
      complaintsApi.addTest(workspaceSlug, {
        kind: state.kind,
        date: state.date,
        product: state.product.trim(),
        lot: state.lot.trim(),
        direction: state.direction,
        minutes: Number(state.minutes),
        recoveredPercent: state.recovered === "" ? null : Number(state.recovered),
        result: state.result.trim(),
      }),
    ...useSave(onClose, f.created),
  });
  const ready =
    state.product.trim() !== "" &&
    state.lot.trim() !== "" &&
    state.result.trim() !== "" &&
    state.minutes !== "" &&
    state.date !== "";
  const field = (key: "date" | "product" | "lot" | "minutes" | "recovered", label: string) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          type={
            key === "date" ? "date" : key === "minutes" || key === "recovered" ? "number" : "text"
          }
          {...(key === "recovered" ? { min: 0, max: 100 } : key === "minutes" ? { min: 0 } : {})}
          value={state[key]}
          onChange={(event) => {
            setState({ ...state, [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      size="lg"
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={ready}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={state.kind}
                onChange={(option) => {
                  const next = KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setState({ ...state, kind: next });
                }}
              />
            )}
          </FormField>
          {field("date", f.date)}
          <FormField label={f.direction}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.direction}
                placeholder={f.direction}
                source={directions}
                value={state.direction}
                onChange={(option) => {
                  const next = DIRECTIONS.find((id) => id === option?.id);
                  if (next !== undefined) setState({ ...state, direction: next });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          {field("product", f.product)}
          {field("lot", f.lot)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("minutes", f.minutes)}
          {field("recovered", f.recovered)}
        </div>
        <FormField label={f.result}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={2000}
              placeholder={f.resultPlaceholder}
              value={state.result}
              onChange={(event) => {
                setState({ ...state, result: event.target.value });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

export function CrisisPage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { manage } = useQuality();
  const query = useQuery({
    queryKey: complaintKeys.crisis(workspaceSlug),
    queryFn: () => complaintsApi.crisis(workspaceSlug),
    select: (data) => data.crisis,
  });
  const [dialog, setDialog] = useState<"member" | "contact" | "test" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
  const remove = useMutation({
    mutationFn: (id: string) => complaintsApi.removeMember(workspaceSlug, id),
    onSuccess: refresh,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => complaintsApi.archiveContact(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.contacts.archived);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const crisis = query.data;
  const close = () => {
    setDialog(null);
  };
  const header = (title: string, action?: { label: string; open: () => void }, hint?: string) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle>{title}</CardTitle>
        {hint !== undefined && (
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      {manage && action !== undefined && (
        <Button size="sm" onClick={action.open}>
          <Plus className="size-4" aria-hidden="true" />
          {action.label}
        </Button>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {crisis?.spaceId != null && (
          <Button asChild variant="outline">
            <Link to={`/app/${workspaceSlug}/files/${crisis.spaceId}`}>
              <FolderOpen className="size-4" aria-hidden="true" />
              {t.templates}
            </Link>
          </Button>
        )}
      </div>
      {crisis === undefined ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="grid content-start gap-3 p-4 sm:p-5">
            {header(t.team.title, {
              label: t.team.add,
              open: () => {
                setDialog("member");
              },
            })}
            {crisis.team.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.team.empty}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {crisis.team.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{member.person.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                    {manage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.team.remove(member.person.name)}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(member.id);
                        }}
                      >
                        <UserMinus className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="grid content-start gap-3 p-4 sm:p-5">
            {header(t.contacts.title, {
              label: t.contacts.add,
              open: () => {
                setDialog("contact");
              },
            })}
            {crisis.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.contacts.empty}</p>
            ) : (
              <ul className="-my-2 divide-y divide-border">
                {crisis.contacts.map((contact) => (
                  <li key={contact.id} className="flex items-start gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{contact.name}</span>
                        <Badge tone="neutral">{t.contacts.kinds[contact.kind]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[contact.organization, contact.phone, contact.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {contact.notes !== null && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{contact.notes}</p>
                      )}
                    </div>
                    {manage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t.contacts.archive(contact.name)}
                        disabled={archive.isPending}
                        onClick={() => {
                          archive.mutate(contact.id);
                        }}
                      >
                        <Archive className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="grid content-start gap-3 p-4 sm:p-5 lg:col-span-2">
            {header(
              t.tests.title,
              {
                label: t.tests.add,
                open: () => {
                  setDialog("test");
                },
              },
              t.tests.hint,
            )}
            {crisis.nextTestOn !== null && (
              <p
                className={
                  crisis.nextTestOn < todayDay() ? "text-sm text-danger" : "text-sm font-medium"
                }
              >
                {t.tests.next(formatUtcDate(crisis.nextTestOn))}
              </p>
            )}
            {crisis.tests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.tests.empty}</p>
            ) : (
              <ul className="grid gap-2">
                {crisis.tests.map((test) => (
                  <li key={test.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={test.kind === "REAL" ? "danger" : "primary"}>
                        {t.tests.kinds[test.kind]}
                      </Badge>
                      <span className="font-medium">
                        {test.product} · {test.lot}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatUtcDate(test.date)} · {t.tests.directions[test.direction]} ·{" "}
                        {t.tests.minutes(test.minutes)}
                        {test.recoveredPercent !== null &&
                          ` · ${t.tests.recovered(test.recoveredPercent)}`}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words">{test.result}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "member" && <MemberDialog onClose={close} />}
        {dialog === "contact" && <ContactDialog onClose={close} />}
        {dialog === "test" && <TestDialog onClose={close} />}
      </Dialog>
    </div>
  );
}
