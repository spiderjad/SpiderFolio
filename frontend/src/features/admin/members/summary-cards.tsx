// Resumen de Miembros en una línea compacta: cuántas personas hay en cada escalón. Cada uno filtra
// la tabla al hacer clic (otro clic, o el mismo, quita el filtro). Quien lidera un área no ve
// propietario ni administradores: no son parte de su equipo.
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Skeleton } from "@/components/ui/display";
import { cn } from "@/lib/utils";
import { adminApi, adminKeys, type MemberGroup, type MemberSummary } from "../api";
import { texts } from "@/i18n";

const items: { group: MemberGroup; count: keyof MemberSummary }[] = [
  { group: "owner", count: "owners" },
  { group: "admins", count: "admins" },
  { group: "managers", count: "managers" },
  { group: "members", count: "members" },
  { group: "readers", count: "readers" },
];

export function SummaryCards({
  active,
  onSelect,
}: {
  active: "" | MemberGroup;
  onSelect: (group: "" | MemberGroup) => void;
}) {
  const t = texts.admin.members.summary;
  const { workspaceSlug = "" } = useParams();
  const summary = useQuery({
    queryKey: adminKeys.summary(workspaceSlug),
    queryFn: () => adminApi.memberSummary(workspaceSlug),
  });
  const data = summary.data;
  if (data === undefined) return <Skeleton className="h-8 w-full max-w-xl" />;

  return (
    <section aria-label={t.label} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      <button
        type="button"
        aria-pressed={active === ""}
        onClick={() => {
          onSelect("");
        }}
        className={chip}
      >
        {t.all} <b className="font-semibold tabular-nums">{data.total}</b>
      </button>
      {items.map(({ group, count }) => {
        const selected = active === group;
        if (data[count] === 0 && !selected) return null;
        return (
          <button
            key={group}
            type="button"
            aria-pressed={selected}
            aria-label={t.filterBy(t[group])}
            onClick={() => {
              onSelect(selected ? "" : group);
            }}
            className={chip}
          >
            {t[group]} <b className="font-semibold tabular-nums">{data[count]}</b>
          </button>
        );
      })}
    </section>
  );
}

const chip = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-transparent px-3 text-muted-foreground transition-colors",
  "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground",
);
