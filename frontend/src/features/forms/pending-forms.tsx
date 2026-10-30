// Home's "Forms to fill in" (docs/spec/formularios.md, phase 3): the periodic forms assigned to whoever
// is looking that have no record yet this period, with a button to fill each one in. Hidden when there
// is none, so it only shows up when it matters.
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/display";
import { formsApi, formsKeys } from "./forms-api";
import { texts } from "@/i18n";

const t = texts.forms.pending;

export function PendingFormsCard({ slug }: { slug: string }) {
  const pending = useQuery({
    queryKey: formsKeys.pending(slug),
    queryFn: () => formsApi.pending(slug),
    staleTime: 60_000,
  });
  const items = pending.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t.title}</h2>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t.hint}</p>
      <ul className="-my-2 divide-y divide-border">
        {items.map((item) => (
          <li key={item.formId} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <p className="min-w-0 flex-1 truncate font-medium">{item.name}</p>
            <Badge tone="warning">{t[item.frequency]}</Badge>
            <Button asChild size="sm">
              <Link to={`/app/${slug}/files/${item.spaceId}/form/${item.formId}/fill`}>
                {t.fill}
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
