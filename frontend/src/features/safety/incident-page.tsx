// /app/:slug/seguridad/incidentes/:incidentId — one case (docs/spec/seguridad-salud.md): what was
// reported (the form's record), its corrective measures with who and by when, and closing it once
// they're all done. Health data: only safety.health.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ServerCrash } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatDay } from "@/lib/utils";
import { incidentsApi, incidentsKeys } from "./safety-api";
import { usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.incidents;

export function IncidentPage() {
  const { workspaceSlug = "", incidentId = "" } = useParams();
  const queryClient = useQueryClient();
  const form = useQuery({
    queryKey: incidentsKeys.form(workspaceSlug),
    queryFn: () => incidentsApi.form(workspaceSlug),
    select: (data) => data.form,
  });
  const query = useQuery({
    queryKey: incidentsKeys.one(workspaceSlug, incidentId),
    queryFn: () => incidentsApi.get(workspaceSlug, incidentId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
  const status = useMutation({
    mutationFn: (close: boolean) => incidentsApi.setStatus(workspaceSlug, incidentId, close),
    onSuccess: async (_result, close) => {
      toast.success(close ? t.toasts.closed : t.toasts.reopened);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const done = useMutation({
    mutationFn: (id: string) => incidentsApi.done(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.toasts.done);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const peopleSource = usePeopleSource();
  const [description, setDescription] = useState("");
  const [responsible, setResponsible] = useState<ComboOption | null>(null);
  const [dueOn, setDueOn] = useState("");
  const add = useMutation({
    mutationFn: () =>
      incidentsApi.addAction(workspaceSlug, incidentId, {
        description: description.trim(),
        responsibleId: responsible?.id ?? "",
        dueOn,
      }),
    onSuccess: async () => {
      toast.success(t.toasts.added);
      setDescription("");
      setResponsible(null);
      setDueOn("");
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  if (query.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(query.error)}
        </EmptyState>
      </Card>
    );
  }
  if (query.data === undefined) return <Skeleton className="h-64 w-full" />;
  const { incident, actions } = query.data;
  const pending = actions.some((action) => action.done === null);
  const recordPath =
    form.data == null
      ? null
      : `/app/${workspaceSlug}/files/${form.data.spaceId}/form/${form.data.formId}/r/${incident.recordId}`;

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <Link
        to={`/app/${workspaceSlug}/seguridad/incidentes`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {t.types[incident.type]}
            {incident.status === "OPEN" ? (
              <Badge tone="warning">{t.open}</Badge>
            ) : (
              <Badge tone="success">{t.closed}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDay(incident.occurredOn)}
            {incident.place === null ? "" : ` · ${incident.place}`}
            {incident.severity === null ? "" : ` · ${t.severities[incident.severity]}`}
          </p>
          {incident.person !== null && (
            <p className="text-sm font-medium">{incident.person.name}</p>
          )}
          {incident.department !== null && (
            <p className="text-xs text-muted-foreground">
              {t.department(incident.department.name)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t.reportedBy(incident.reportedBy.name)}</p>
          {recordPath !== null && (
            <Link
              to={recordPath}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {t.record}
            </Link>
          )}
        </div>
        <Button
          variant="outline"
          disabled={status.isPending || (incident.status === "OPEN" && pending)}
          onClick={() => {
            status.mutate(incident.status === "OPEN");
          }}
        >
          {incident.status === "OPEN" ? t.close : t.reopen}
        </Button>
      </div>
      {incident.closed !== null && (
        <Banner tone="info">
          {t.closedBy(incident.closed.by?.name ?? "", formatDateTime(incident.closed.at))}
        </Banner>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle className="text-base">{t.actionsTitle}</CardTitle>
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noActions}</p>
        ) : (
          <ul className="divide-y divide-border">
            {actions.map((action) => (
              <li
                key={action.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p
                    className={
                      action.done === null ? "font-medium" : "text-muted-foreground line-through"
                    }
                  >
                    {action.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {action.responsible.name} · {t.due(formatDay(action.dueOn))}
                    {action.done !== null &&
                      ` · ${t.doneBy(action.done.by?.name ?? "", formatDateTime(action.done.at))}`}
                  </p>
                </div>
                {action.done === null && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={done.isPending}
                    onClick={() => {
                      done.mutate(action.id);
                    }}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {t.markDone}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-[1fr_12rem_10rem_auto] sm:items-end">
          <FormField label={t.action}>
            {(control) => (
              <Input
                {...control}
                value={description}
                maxLength={500}
                placeholder={t.actionPlaceholder}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.responsible}>
            {(control) => (
              <Combobox
                id={control.id}
                label={t.responsible}
                placeholder={t.responsible}
                source={peopleSource}
                value={responsible?.id ?? null}
                valueLabel={responsible?.label}
                onChange={setResponsible}
              />
            )}
          </FormField>
          <FormField label={t.dueOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={dueOn}
                onChange={(event) => {
                  setDueOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button
            disabled={
              add.isPending || description.trim().length < 3 || responsible === null || dueOn === ""
            }
            onClick={() => {
              add.mutate();
            }}
          >
            {t.addAction}
          </Button>
        </div>
      </Card>
    </div>
  );
}
