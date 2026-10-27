// «Revisión de la estructura»: aviso plegable arriba del organigrama con lo que conviene corregir
// (departamentos sin jefe, personas sin departamento, jefes con plaza de lector, administradores
// que además son jefes y departamentos sin personas). Solo aparece lo que existe; cada aviso
// enlaza a donde se corrige.
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ListChecks } from "lucide-react";
import { Link, useParams } from "react-router";
import { Badge, Card } from "@/components/ui/display";
import { adminApi, adminKeys, type ReviewGroup } from "../api";
import { useCan } from "../guards";
import { texts } from "@/i18n";

type Kind =
  | "departmentsWithoutHead"
  | "peopleWithoutDepartment"
  | "readerLeaders"
  | "adminLeaders"
  | "emptyDepartments";

const ORDER: readonly Kind[] = [
  "departmentsWithoutHead",
  "peopleWithoutDepartment",
  "readerLeaders",
  "emptyDepartments",
  "adminLeaders",
];

export function StructureReview() {
  const t = texts.admin.members.structureReview;
  const { workspaceSlug = "" } = useParams();
  const canReview = useCan("departments.manage") || useCan("members.manage");
  const review = useQuery({
    queryKey: adminKeys.structureReview(workspaceSlug),
    queryFn: () => adminApi.structureReview(workspaceSlug),
    enabled: canReview,
  });
  if (!canReview || review.data === undefined) return null;
  const groups = ORDER.flatMap((kind) =>
    review.data[kind].total > 0 ? [{ kind, group: review.data[kind] }] : [],
  );
  // El aviso informativo (administradores que lideran) no cuenta como algo a corregir.
  const toFix = groups.filter(({ kind }) => kind !== "adminLeaders").length;

  if (groups.length === 0) {
    return (
      <Card className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} aria-hidden="true" />
        {t.allGood}
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <details open={toFix > 0} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <ListChecks className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
          {t.title}
          {toFix > 0 && <Badge tone="warning">{t.toFix(toFix)}</Badge>}
          <ChevronDown
            className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </summary>
        <ul className="m-0 grid list-none gap-3 border-t border-border p-4">
          {groups.map(({ kind, group }) => (
            <ReviewItemList key={kind} kind={kind} group={group} />
          ))}
        </ul>
      </details>
    </Card>
  );
}

function ReviewItemList({ kind, group }: { kind: Kind; group: ReviewGroup }) {
  const t = texts.admin.members.structureReview;
  const { workspaceSlug = "" } = useParams();
  const base = `/app/${workspaceSlug}/admin`;
  const departmentKind = kind === "departmentsWithoutHead" || kind === "emptyDepartments";
  const linkOf = (id: string, name: string) =>
    departmentKind
      ? `${base}/departments/${id}`
      : `${base}/members?vista=lista&q=${encodeURIComponent(name)}`;
  const text = t.groups[kind];
  return (
    <li className="grid gap-1">
      <p className="text-sm font-medium">
        {text.title(group.total)}
        {kind === "adminLeaders" && (
          <Badge className="ml-2" tone="primary">
            {t.info}
          </Badge>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{text.hint}</p>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
        {group.items.map((item) => (
          <li key={item.id}>
            <Link
              to={linkOf(item.id, item.name)}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {item.name}
              <span className="sr-only"> — {text.action}</span>
            </Link>
          </li>
        ))}
        {group.total > group.items.length && (
          <li className="text-muted-foreground">{t.more(group.total - group.items.length)}</li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">{text.action}</p>
    </li>
  );
}
