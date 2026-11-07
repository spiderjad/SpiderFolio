// /app/:slug/seguridad/emergencias/simulacros — the drills (docs/spec/seguridad-salud.md,
// «Emergencias y simulacros»): one row per drill, filtered by scenario and dates in the address.
// For whoever manages the module.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Siren } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  DRILL_SCENARIOS,
  emergenciesApi,
  emergenciesKeys,
  type Drill,
  type DrillFilters,
  type DrillInput,
  type DrillScenario,
} from "./safety-api";
import { EmergencyNav } from "./emergencies-page";
import { texts } from "@/i18n";

const t = texts.safety.drills;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function today(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole non-negative number from a field; empty → null. */
function countOf(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function DrillsPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const { params, patch } = useListParams();
  const filters = useMemo<DrillFilters>(() => {
    const day = (key: string) => {
      const value = params.get(key) ?? "";
      return DAY.test(value) ? value : undefined;
    };
    return {
      scenario: DRILL_SCENARIOS.find((id) => id === params.get("escenario")),
      from: day("desde"),
      to: day("hasta"),
    };
  }, [params]);
  const scenarios = useStaticSource(
    "drill-scenarios",
    DRILL_SCENARIOS.map((id) => ({ id, label: t.scenarios[id] })),
  );
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Drill>({
    queryKey: emergenciesKeys.drills(workspaceSlug, filters),
    fetchPage: (cursor, signal) => emergenciesApi.drills(workspaceSlug, filters, cursor, signal),
  });
  const base = `/app/${workspaceSlug}/seguridad/emergencias/simulacros`;
  const columns = useMemo<ColumnDef<Drill>[]>(
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
      {
        id: "scenario",
        header: t.columns.scenario,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            {t.scenarios[row.original.scenario]}
            {!row.original.announced && <Badge>{t.detail.unannounced}</Badge>}
          </span>
        ),
      },
      { id: "area", header: t.columns.area, cell: ({ row }) => row.original.area ?? "—" },
      {
        id: "time",
        header: t.columns.time,
        cell: ({ row }) =>
          row.original.evacuationSeconds === null ? "—" : t.seconds(row.original.evacuationSeconds),
      },
      {
        id: "actions",
        header: t.columns.actions,
        cell: ({ row }) =>
          row.original.actions.total === 0 ? (
            <span className="text-muted-foreground">{t.noActions}</span>
          ) : (
            <Badge tone={row.original.actions.open > 0 ? "warning" : "success"}>
              {t.openActions(row.original.actions.open, row.original.actions.total)}
            </Badge>
          ),
      },
    ],
    [base],
  );
  const filtered =
    filters.scenario !== undefined || filters.from !== undefined || filters.to !== undefined;
  const f = t.filters;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.create}
        </Button>
      </div>
      <EmergencyNav />
      <Card className="grid gap-3 p-0">
        <div className="grid grid-cols-1 gap-3 px-4 pt-4 sm:grid-cols-3 sm:items-end">
          <FormField label={f.scenario}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                searchable={false}
                label={f.scenario}
                placeholder={f.anyScenario}
                source={scenarios}
                value={filters.scenario ?? null}
                onChange={(option) => {
                  patch({ escenario: option?.id });
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
          <EmptyState icon={Siren} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        ) : (
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(drill) => drill.id}
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
          <DrillDialog
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

/** Create a drill, or edit `drill`. */
export function DrillDialog({
  drill,
  onClose,
}: {
  drill?: Drill;
  onClose: (saved?: Drill) => void;
}) {
  const f = t.form;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const scenarios = useStaticSource(
    "drill-scenarios",
    DRILL_SCENARIOS.map((id) => ({ id, label: t.scenarios[id] })),
  );
  const [date, setDate] = useState(drill?.date.slice(0, 10) ?? today());
  const [scenario, setScenario] = useState<DrillScenario>(drill?.scenario ?? "EVACUATION");
  const [area, setArea] = useState(drill?.area ?? "");
  const [announced, setAnnounced] = useState(drill?.announced ?? false);
  const [participants, setParticipants] = useState(
    drill?.participants == null ? "" : String(drill.participants),
  );
  const seconds = drill?.evacuationSeconds ?? null;
  const [minutes, setMinutes] = useState(seconds === null ? "" : String(Math.floor(seconds / 60)));
  const [secs, setSecs] = useState(seconds === null ? "" : String(seconds % 60));
  const [incidents, setIncidents] = useState(drill?.incidents ?? "");
  const [observers, setObservers] = useState(drill?.observers ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const m = countOf(minutes);
      const s = countOf(secs);
      const text = (value: string) => (value.trim() === "" ? null : value.trim());
      const body: Omit<DrillInput, "nodeId"> = {
        date,
        scenario,
        area: text(area),
        announced,
        participants: countOf(participants),
        evacuationSeconds: m === null && s === null ? null : (m ?? 0) * 60 + Math.min(s ?? 0, 59),
        incidents: text(incidents),
        observers: text(observers),
      };
      if (drill === undefined)
        return (await emergenciesApi.createDrill(workspaceSlug, { ...body, nodeId: null })).drill;
      return (await emergenciesApi.updateDrill(workspaceSlug, drill.id, body)).drill;
    },
    onSuccess: async (saved) => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: emergenciesKeys.all(workspaceSlug) });
      onClose(saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={drill === undefined ? f.createTitle : f.editTitle}
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
            {drill === undefined ? texts.admin.common.create : texts.admin.common.save}
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
                max={today()}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.scenario}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.scenario}
                placeholder={f.scenario}
                source={scenarios}
                value={scenario}
                onChange={(option) => {
                  const next = DRILL_SCENARIOS.find((id) => id === option?.id);
                  if (next !== undefined) setScenario(next);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.area}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={area}
              onChange={(event) => {
                setArea(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={f.announced}
          checked={announced}
          onChange={(event) => {
            setAnnounced(event.target.checked);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={f.participants}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                inputMode="numeric"
                value={participants}
                onChange={(event) => {
                  setParticipants(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.minutes}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => {
                  setMinutes(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.secondsField}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                value={secs}
                onChange={(event) => {
                  setSecs(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.incidents}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={4000}
              placeholder={f.incidentsPlaceholder}
              value={incidents}
              onChange={(event) => {
                setIncidents(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.observers}>
          {(control) => (
            <Input
              {...control}
              maxLength={200}
              value={observers}
              onChange={(event) => {
                setObservers(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
