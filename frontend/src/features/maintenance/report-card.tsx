// "Report a breakdown" for the plant's shared tablets (docs/spec/mantenimiento.md, section 9): whoever
// signs in with their username + PIN sees it on their home, big, with the module on.
import { Wrench } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { useMaintenance } from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.kiosk;

export function ReportBreakdownCard({ slug }: { slug: string }) {
  const { enabled, report } = useMaintenance();
  if (!enabled || !report) return null;
  return (
    <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
      <Wrench className="size-8 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.text}</p>
      </div>
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link to={`/app/${slug}/mantenimiento/avisar`}>{t.action}</Link>
      </Button>
    </Card>
  );
}
