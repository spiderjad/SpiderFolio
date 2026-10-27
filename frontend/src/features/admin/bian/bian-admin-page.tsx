// Administración › Bian: interruptores, consultas del mes y límites por persona, uso por persona y por
// departamento, y valoraciones de las respuestas. La ven quienes tienen seguridad o facturación.
import { useListParams } from "@/features/admin/list-params";
import { cn } from "@/lib/utils";
import { FeedbackTab } from "./feedback-tab";
import { OverviewTab } from "./overview-tab";
import { UsageTab } from "./usage-tab";
import { texts } from "@/i18n";

const TABS = ["overview", "usage", "feedback"] as const;
type Tab = (typeof TABS)[number];

export function BianAdminPage() {
  const t = texts.bian.admin;
  const { params, patch } = useListParams();
  const wanted = params.get("tab");
  const tab: Tab = TABS.find((candidate) => candidate === wanted) ?? "overview";
  const labels: Record<Tab, string> = {
    overview: t.tabs.overview,
    usage: t.tabs.usage,
    feedback: t.tabs.feedback,
  };
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div role="tablist" aria-label={t.tabs.label} className="flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === item
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              patch({ tab: item === "overview" ? undefined : item });
            }}
          >
            {labels[item]}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "usage" && <UsageTab />}
      {tab === "feedback" && <FeedbackTab />}
    </div>
  );
}
