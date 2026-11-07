// /app/:slug/seguridad/comite/reuniones — the committee's meetings (docs/spec/seguridad-salud.md,
// «Consulta y participación»), filtered by type and dates in the address. Whoever manages the module
// records them; the committee's members read them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  MEETING_KINDS,
  committeeApi,
  committeeKeys,
  type Meeting,
  type MeetingFilters,
  type MeetingInput,
  type MeetingKind,
} from "./safety-api";
import { CommitteeNav, useCommitteeTerms } from "./committee-page";
import { useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.meetings;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function MeetingsPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const { canManage } = useSafety();
  const terms = useCommitteeTerms();
  const { params, patch } = useListParams();
  const filters = useMemo<MeetingFilters>(() => {
    const day = (key: string) => {
      const value = params.get(key) ?? "";
      return DAY.test(value) ? value : undefined;
    };
    return {
      kind: MEETING_KINDS.find((id) => id === params.get("tipo")),
      from: day("desde"),
      to: day("hasta"),
    };
  }, [params]);
  const kinds = useStaticSource(
    "meeting-kinds",
    MEETING_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Meeting>({
    queryKey: committeeKeys.meetings(workspaceSlug, filters),
    fetchPage: (cursor, signal) => committeeApi.meetings(workspaceSlug, filters, cursor, signal),
  });
  const base = `/app/${workspaceSlug}/seguridad/comite/reuniones`;
  const columns = useMemo<ColumnDef<Meeting>[]>(
    () => [
      {
        id: "date",
        header: t.columns.date,
        cell: ({ row }) => (
          <Link
            to={`${base}/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {formatUtcDate(row.original.date)}
          </Link>
        ),
      },
      { id: "kind", header: t.columns.kind, cell: ({ row }) => t.kinds[row.original.kind] },
      {
        id: "attendees",
        header: t.columns.attendees,
        cell: ({ row }) => t.attendeesCount(row.original.attendees.length),
      },
      {
        id: "minutes",
        header: t.columns.minutes,
        cell: ({ row }) =>
          row.original.minutes === null ? (
            <span className="text-muted-foreground">{t.noMinutes}</span>
          ) : (
            <Badge tone="success">{t.hasMinutes}</Badge>
          ),
      },
      {
        id: "agreements",
        header: t.columns.agreements,
        cell: ({ row }) =>
          row.original.actions.total === 0 ? (
            <span className="text-muted-foreground">{t.noAgreements}</span>
          ) : (
            <Badge tone={row.original.actions.open > 0 ? "warning" : "success"}>
              {t.openAgreements(row.original.actions.open, row.original.actions.total)}
            </Badge>
          ),
      },
    ],
    [base],
  );
  const filtered =
    filters.kind !== undefined || filters.from !== undefined || filters.to !== undefined;
  const f = t.filters;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{terms.name}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {texts.safety.committee.quarterly}
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        )}
      </div>
      <CommitteeNav />
      <Card className="grid gap-3 p-0">
        <div className="grid grid-cols-1 gap-3 px-4 pt-4 sm:grid-cols-3 sm:items-end">
          <FormField label={f.kind}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                searchable={false}
                label={f.kind}
                placeholder={f.anyKind}
                source={kinds}
                value={filters.kind ?? null}
                onChange={(option) => {
                  patch({ tipo: option?.id });
                }}
              />
            )}
          </FormField>
          <FormField label={f.from}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.from ?? ""}
                onChange={(event) => {
                  patch({ desde: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.to}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.to ?? ""}
                onChange={(event) => {
                  patch({ hasta: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        {!list.query.isPending && list.items.length === 0 ? (
          <EmptyState icon={CalendarClock} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        ) : (
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(meeting) => meeting.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        )}
      </Card>
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <MeetingDialog
            onClose={(saved) => {
              setCreating(false);
              if (saved !== undefined) void navigate(`${base}/${saved.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

/** Pages and files of the module's space, to pick the minutes. */
function useMinutesSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: committeeKeys.minutesOptions(workspaceSlug),
      search: async (q, cursor, signal) => {
        const page = await committeeApi.minutesOptions(workspaceSlug, q, cursor, signal);
        return {
          items: page.items.map((node) => ({ id: node.id, label: node.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

/** Record a meeting, or edit `meeting`. */
export function MeetingDialog({
  meeting,
  onClose,
}: {
  meeting?: Meeting;
  onClose: (saved?: Meeting) => void;
}) {
  const f = t.form;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const terms = useCommitteeTerms();
  const kinds = useStaticSource(
    "meeting-kinds",
    MEETING_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const minutesSource = useMinutesSource();
  const committee = useQuery({
    queryKey: committeeKeys.committee(workspaceSlug, false),
    queryFn: () => committeeApi.committee(workspaceSlug, false),
    select: (data) => data.committee.members,
  });
  const [date, setDate] = useState(meeting?.date.slice(0, 10) ?? today());
  const [kind, setKind] = useState<MeetingKind>(meeting?.kind ?? "ORDINARY");
  const [attendees, setAttendees] = useState<Set<string>>(
    new Set(meeting?.attendees.map((person) => person.id) ?? []),
  );
  const [agenda, setAgenda] = useState(meeting?.agenda ?? "");
  const [minutes, setMinutes] = useState<{ id: string; name: string } | null>(
    meeting?.minutes == null ? null : { id: meeting.minutes.id, name: meeting.minutes.name },
  );
  // Former members who attended stay listed so editing doesn't drop them.
  const people = useMemo(() => {
    const current = (committee.data ?? []).map((member) => ({
      id: member.id,
      name: member.person.name,
      role: member.role,
    }));
    const past = (meeting?.attendees ?? []).filter(
      (person) => !current.some((member) => member.id === person.id),
    );
    return [...current, ...past];
  }, [committee.data, meeting]);
  const save = useMutation({
    mutationFn: async () => {
      const body: MeetingInput = {
        date,
        kind,
        attendeeIds: [...attendees],
        agenda: agenda.trim() === "" ? null : agenda.trim(),
        minutesNodeId: minutes?.id ?? null,
      };
      if (meeting === undefined)
        return (await committeeApi.createMeeting(workspaceSlug, body)).meeting;
      return (await committeeApi.updateMeeting(workspaceSlug, meeting.id, body)).meeting;
    },
    onSuccess: async (saved) => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: committeeKeys.all(workspaceSlug) });
      onClose(saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={meeting === undefined ? f.createTitle : f.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending || !DAY.test(date)}
            onClick={() => {
              save.mutate();
            }}
          >
            {meeting === undefined ? texts.admin.common.create : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={f.date}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={kind}
                onChange={(option) => {
                  const next = MEETING_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setKind(next);
                }}
              />
            )}
          </FormField>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{f.attendees}</legend>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">{f.noMembers}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {people.map((person) => (
                <Checkbox
                  key={person.id}
                  label={`${person.name} · ${terms.roles[person.role]}`}
                  checked={attendees.has(person.id)}
                  onChange={(event) => {
                    const next = new Set(attendees);
                    if (event.target.checked) next.add(person.id);
                    else next.delete(person.id);
                    setAttendees(next);
                  }}
                />
              ))}
            </div>
          )}
        </fieldset>
        <FormField label={f.agenda}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={8000}
              placeholder={f.agendaPlaceholder}
              value={agenda}
              onChange={(event) => {
                setAgenda(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.minutes} hint={f.minutesHint}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.minutes}
              placeholder={f.minutesPlaceholder}
              source={minutesSource}
              value={minutes?.id ?? null}
              valueLabel={minutes?.name}
              onChange={(option) => {
                setMinutes(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
