// /app/:slug/calidad/auditorias — the audit programme (docs/spec/calidad.md, «Fase 3»): the year's audits
// by date with their type, status and findings, and the internal programme's coverage by chapter of the
// company's standards.
import { useQuery } from "@tanstack/react-query";
import { CalendarSearch, Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Dialog } from "@/components/ui/overlay";
import { useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import { AuditDialog } from "./audit-dialog";
import { auditKeys, auditsApi, type Audit } from "./quality-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.audits;

const statusTone = { PLANNED: "warning", DONE: "success", CANCELLED: "neutral" } as const;

export function AuditStatusBadge({ status }: { status: Audit["status"] }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

function CoverageCard({ slug, year }: { slug: string; year: number }) {
  const query = useQuery({
    queryKey: auditKeys.coverage(slug, year),
    queryFn: () => auditsApi.coverage(slug, year),
    select: (data) => data.standards,
  });
  const c = t.coverage;
  return (
    <Card className="grid gap-4 p-4 sm:p-5">
      <div>
        <CardTitle>{c.title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
      </div>
      {query.data === undefined ? (
        <Skeleton className="h-24" />
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{c.none}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data.map((standard) => {
            const covered = standard.chapters.filter((chapter) => chapter.audits.length > 0).length;
            return (
              <div key={standard.standard} className="grid content-start gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{t.standards[standard.standard]}</p>
                  <p
                    className={cn(
                      "text-xs",
                      covered === standard.chapters.length
                        ? "text-success"
                        : "text-muted-foreground",
                    )}
                  >
                    {c.covered(covered, standard.chapters.length)}
                  </p>
                </div>
                <ul className="grid gap-1">
                  {standard.chapters.map((chapter) => {
                    const done = chapter.audits.length > 0;
                    return (
                      <li key={chapter.number} className="flex items-start gap-2 text-sm">
                        {done ? (
                          <Check
                            className="mt-0.5 size-4 shrink-0 text-success"
                            aria-hidden="true"
                          />
                        ) : (
                          <Minus
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span className={done ? undefined : "text-muted-foreground"}>
                          {chapter.number}.{" "}
                          {t.chapterNames[standard.standard][chapter.number - 1] ?? ""}
                          <span className="sr-only">
                            : {done ? chapter.audits.join(", ") : c.missing}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function AuditsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view } = useQuality();
  const { params, patch } = useListParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get("anio")) || thisYear;
  const years = useStaticSource(
    `quality-audit-years-${String(thisYear)}`,
    [thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((value) => ({
      id: String(value),
      label: String(value),
    })),
  );
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: auditKeys.list(workspaceSlug, year),
    queryFn: () => auditsApi.list(workspaceSlug, year),
    select: (data) => data.items,
  });
  const base = `/app/${workspaceSlug}/calidad/auditorias`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-28">
            <Combobox
              compact
              searchable={false}
              label={t.year}
              placeholder={t.year}
              source={years}
              value={String(year)}
              onChange={(option) => {
                patch({ anio: option?.id === String(thisYear) ? undefined : option?.id });
              }}
            />
          </div>
          {manage && (
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
      </div>
      {view && <CoverageCard slug={workspaceSlug} year={year} />}
      {query.data === undefined ? (
        <Skeleton className="h-40" />
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarSearch} title={t.empty.title}>
            {t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {query.data.map((audit) => (
              <li key={audit.id}>
                <Link
                  to={`${base}/${audit.id}`}
                  className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40 sm:px-5"
                >
                  <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatUtcDate(audit.doneOn ?? audit.plannedOn)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{audit.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.schemes[audit.scheme]}
                      {audit.auditor !== null && ` · ${audit.auditor}`}
                      {audit.result !== null && ` · ${audit.result}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-xs",
                      audit.findings.openNcs > 0 ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {t.findings(audit.findings.total, audit.findings.openNcs)}
                  </span>
                  <AuditStatusBadge status={audit.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <AuditDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
