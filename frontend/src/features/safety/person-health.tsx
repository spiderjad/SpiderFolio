// A person's health data on their sheet (docs/spec/seguridad-salud.md): fitness for work (theirs, or
// anyone's with safety.health, who also records it) and, only for safety.health, their accidents and
// incidents.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import {
  fitnessApi,
  fitnessKeys,
  incidentsApi,
  incidentsKeys,
  type FitnessStatus,
} from "./safety-api";
import { useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.fitness;
const STATUSES: readonly FitnessStatus[] = ["APT", "APT_RESTRICTED", "NOT_APT"];
const tone = { APT: "success", APT_RESTRICTED: "warning", NOT_APT: "danger" } as const;

export function PersonFitness({ membershipId }: { membershipId: string }) {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: fitnessKeys.person(workspaceSlug, membershipId),
    queryFn: () => fitnessApi.get(workspaceSlug, membershipId),
    retry: false,
  });
  // Someone else's fitness without safety.health: the server answers 404 and nothing shows.
  if (query.isError) return null;
  if (query.data === undefined) return <Skeleton className="h-24 w-full" />;
  const latest = query.data.items[0];
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{t.hint}</p>
      </div>
      {latest === undefined ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={tone[latest.status]}>{t.statuses[latest.status]}</Badge>
            <span className="text-sm text-muted-foreground">
              {latest.validUntil === null ? t.noUntil : t.until(formatUtcDate(latest.validUntil))}
            </span>
            {latest.state === "expired" && (
              <Badge tone="danger">{texts.safety.person.states.expired}</Badge>
            )}
          </p>
          {latest.restrictions !== null && <p className="text-sm">{latest.restrictions}</p>}
          <p className="text-xs text-muted-foreground">
            {t.by(latest.createdBy?.name ?? "", formatDateTime(latest.createdAt))}
          </p>
        </div>
      )}
    </Card>
  );
}

export function PersonIncidents({ membershipId }: { membershipId: string }) {
  const { workspaceSlug = "" } = useParams();
  const { health } = useSafety();
  const filters = { person: membershipId };
  const query = useQuery({
    queryKey: incidentsKeys.list(workspaceSlug, filters),
    queryFn: ({ signal }) => incidentsApi.list(workspaceSlug, filters, undefined, signal),
    enabled: health,
  });
  if (!health) return null;
  const i = texts.safety.incidents;
  return (
    <Card className="p-4 sm:p-5">
      <CardTitle className="text-base">{texts.safety.personIncidents.title}</CardTitle>
      {query.data === undefined ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : query.data.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{texts.safety.personIncidents.none}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border text-sm">
          {query.data.items.map((incident) => (
            <li
              key={incident.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <Link
                to={`/app/${workspaceSlug}/seguridad/incidentes/${incident.id}`}
                className="underline-offset-4 hover:underline"
              >
                {formatUtcDate(incident.occurredOn)} · {i.types[incident.type]}
              </Link>
              <Badge tone={incident.status === "OPEN" ? "warning" : "success"}>
                {incident.status === "OPEN" ? i.open : i.closed}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Records someone's fitness for work (safety.health): a dialog the person's sheet opens. */
export function FitnessDialog({
  membershipId,
  open,
  onClose,
}: {
  membershipId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const statuses = useStaticSource(
    "fitness-status",
    STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const [status, setStatus] = useState<FitnessStatus>("APT");
  const [until, setUntil] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const record = useMutation({
    mutationFn: () =>
      fitnessApi.record(workspaceSlug, membershipId, {
        status,
        validUntil: until === "" ? null : until,
        restrictions: restrictions.trim() === "" ? null : restrictions.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.recorded);
      setRestrictions("");
      onClose();
      await queryClient.invalidateQueries({
        queryKey: fitnessKeys.person(workspaceSlug, membershipId),
      });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={t.record}
        description={t.hint}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline">{texts.admin.common.cancel}</Button>
            </DialogClose>
            <Button
              disabled={record.isPending}
              onClick={() => {
                record.mutate();
              }}
            >
              {t.record}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FormField label={t.status}>
            {(control) => (
              <Combobox
                id={control.id}
                label={t.status}
                placeholder={t.status}
                searchable={false}
                source={statuses}
                value={status}
                onChange={(option) => {
                  const next = STATUSES.find((id) => id === option?.id);
                  if (next !== undefined) setStatus(next);
                }}
              />
            )}
          </FormField>
          <FormField label={t.validUntil}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={until}
                onChange={(event) => {
                  setUntil(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.restrictions}>
            {(control) => (
              <Textarea
                {...control}
                rows={1}
                maxLength={500}
                disabled={status !== "APT_RESTRICTED"}
                placeholder={t.restrictionsPlaceholder}
                value={restrictions}
                onChange={(event) => {
                  setRestrictions(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
