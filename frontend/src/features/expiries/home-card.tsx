// On Home (docs/spec/vencimientos.md): what the person (or a department they head) looks after, due soon
// or expired. Nothing to show, no card.
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Link } from "react-router";
import { Card, CardTitle } from "@/components/ui/display";
import { useMembership } from "@/features/home/workspace-layout";
import { expiriesApi, expiriesKeys } from "./expiries-api";
import { elementPath } from "./expiries-page";
import { ExpiryBadge } from "./expiry-dialog";
import { texts } from "@/i18n";

const SHOWN = 5;

export function ExpiriesHomeCard({ slug }: { slug: string }) {
  const membership = useMembership();
  const enabled = membership.role.base !== "GUEST";
  const mine = useQuery({
    queryKey: expiriesKeys.mine(slug),
    queryFn: () => expiriesApi.mine(slug),
    staleTime: 60_000,
    enabled,
  });
  const items = mine.data?.items ?? [];
  if (!enabled || items.length === 0) return null;
  const t = texts.expiries.home;
  const total = mine.data?.total ?? items.length;
  return (
    <Card className="flex flex-col p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-warning-soft-foreground" aria-hidden="true" />
          {t.title}
        </CardTitle>
        <Link
          to={`/app/${slug}/vencimientos`}
          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:underline"
        >
          {t.seeAll}
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>
      <ul className="mt-3 grid">
        {items.slice(0, SHOWN).map((row) => (
          <li key={row.node.id}>
            <Link
              to={elementPath(slug, row.node)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{row.node.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {row.node.spaceName}
                  {row.responsible?.type === "department" ? ` · ${row.responsible.name}` : ""}
                </span>
              </span>
              <ExpiryBadge dueOn={row.dueOn} state={row.state} />
            </Link>
          </li>
        ))}
      </ul>
      {total > SHOWN && (
        <p className="mt-2 text-xs text-muted-foreground">{t.more(total - SHOWN)}</p>
      )}
    </Card>
  );
}
