// Plazas usadas del workspace (9A.4): usuarios completos y lectores, con barra de uso.
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ProgressBar } from "@/components/ui/data";
import { Card, Skeleton } from "@/components/ui/display";
import { adminApi, adminKeys, type SeatType } from "./api";
import { texts } from "@/i18n";

export function SeatMeters() {
  const { workspaceSlug = "" } = useParams();
  const t = texts.admin.seats;
  const seats = useQuery({
    queryKey: adminKeys.seats(workspaceSlug),
    queryFn: () => adminApi.seats(workspaceSlug),
  });
  const rows: { type: SeatType; label: string }[] = [
    { type: "FULL", label: t.full },
    { type: "READER", label: t.reader },
  ];
  return (
    <Card className="grid gap-4 p-5 sm:grid-cols-2" aria-label={t.title}>
      {rows.map(({ type, label }) => {
        const seat = seats.data?.seats[type];
        return (
          <div key={type}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <p className="font-medium">{label}</p>
              {seat === undefined ? (
                <Skeleton className="h-4 w-20" />
              ) : (
                <p className="tabular-nums text-muted-foreground">{t.of(seat.used, seat.max)}</p>
              )}
            </div>
            {seat !== undefined && seat.max !== null && (
              <ProgressBar value={seat.used} max={seat.max} label={label} className="mt-2" />
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground sm:col-span-2">{t.hint}</p>
    </Card>
  );
}
