// Searching the SGA's catalogue when adding a spare part (docs/spec/mantenimiento.md, section 6): by code or
// description, with the stock the SGA last sent. Choosing one fills the code, description and unit.
// Hidden while the SGA hasn't sent any catalogue.
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useParams } from "react-router";
import { Badge } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { maintenanceApi, maintenanceKeys, type Part } from "./maintenance-api";
import { texts } from "@/i18n";

const t = texts.maintenance.parts;

export function PartPicker({
  chosen,
  onChoose,
}: {
  chosen: Part | null;
  onChoose: (part: Part) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const found = useQuery({
    queryKey: maintenanceKeys.parts(workspaceSlug, deferred),
    queryFn: () => maintenanceApi.parts(workspaceSlug, deferred),
    staleTime: 30_000,
  });
  // Without a catalogue there's nothing to search: the code is typed by hand.
  if (found.data !== undefined && found.data.total === 0) return null;
  const parts = found.data?.parts ?? [];
  return (
    <div className="grid gap-2">
      <FormField label={t.search} hint={t.searchHint}>
        {(control) => (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              {...control}
              className="pl-8"
              maxLength={120}
              placeholder={t.searchPlaceholder}
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
              }}
            />
          </div>
        )}
      </FormField>
      {deferred !== "" && (
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-1">
          {parts.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t.none}</li>
          ) : (
            parts.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  aria-pressed={chosen?.id === part.id}
                  className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-muted"
                  onClick={() => {
                    onChoose(part);
                  }}
                >
                  <span className="font-medium tabular-nums">{part.code}</span>
                  <span className="min-w-0 flex-1 truncate">{part.description}</span>
                  {part.stock !== null && (
                    <Badge tone={part.low ? "warning" : "neutral"}>
                      {t.stock(part.stock, part.unit, part.minStock)}
                    </Badge>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** «It'll go under its minimum»: the stock the SGA said, minus what's being used. */
export function lowAfter(part: Part | null, quantity: number): boolean {
  if (part === null || part.stock === null || part.minStock === null) return false;
  return part.stock - quantity <= part.minStock;
}
