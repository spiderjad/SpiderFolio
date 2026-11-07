// /app/:slug/seguridad/cae/porteria — the gatehouse (docs/spec/cae.md, «Pantallas»): a big search box
// (name, the end of the ID, the company) or a worker's QR (`?trabajador=`), answering in a large green
// «Puede entrar» or red with every reason. With the company's access log on, it records entries and
// exits. For whoever checks contractors (cae.check) on a phone or tablet at the gate.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogIn, LogOut, Search, ServerCrash, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { cn, formatDateTime } from "@/lib/utils";
import { caeApi, caeKeys, type CaeGateResult } from "./cae-api";
import { CaeNav } from "./cae-common";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.gate;

export function CaeGatePage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const workerId = params.get("trabajador");
  const [search, setSearch] = useSearchParam("q", q, patch, 250);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const results = useInfiniteList<CaeGateResult>({
    queryKey: caeKeys.gate(workspaceSlug, q),
    fetchPage: (cursor, signal) => caeApi.search(workspaceSlug, q, cursor, signal),
    enabled: q !== "" && workerId === null,
  });

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-4">
      <PpeTabs />
      <CaeNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <label className="relative block">
        <span className="sr-only">{t.searchLabel}</span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <input
          ref={input}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={search}
          placeholder={t.search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (workerId !== null) patch({ trabajador: undefined });
          }}
          className="h-16 w-full rounded-2xl border border-input bg-background pl-14 pr-4 text-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </label>
      {workerId !== null ? (
        <GateAnswer
          workerId={workerId}
          onClear={() => {
            setSearch("");
            patch({ trabajador: undefined, q: undefined });
            input.current?.focus();
          }}
        />
      ) : q === "" ? null : !results.query.isPending && results.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noResults}</p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {results.items.map((worker) => (
              <li key={worker.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted"
                  onClick={() => {
                    patch({ trabajador: worker.id });
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium">{worker.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[
                        worker.company.name,
                        worker.idNumber === null ? null : t.idNumber(worker.idNumber),
                      ]
                        .filter((value): value is string => value !== null)
                        .join(" · ")}
                    </span>
                  </span>
                  {worker.authorized ? (
                    <CheckCircle2
                      className="size-6 shrink-0 text-success"
                      strokeWidth={1.75}
                      aria-label={t.yes}
                    />
                  ) : (
                    <XCircle
                      className="size-6 shrink-0 text-danger"
                      strokeWidth={1.75}
                      aria-label={t.no}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <LoadMore
            hasNextPage={results.query.hasNextPage}
            isFetching={results.query.isFetchingNextPage}
            onLoadMore={results.loadMore}
          />
        </Card>
      )}
    </div>
  );
}

function GateAnswer({ workerId, onClear }: { workerId: string; onClear: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const check = useQuery({
    queryKey: caeKeys.check(workspaceSlug, workerId),
    queryFn: () => caeApi.check(workspaceSlug, workerId),
    select: (data) => data.result,
    // Always the answer of right now.
    staleTime: 0,
    gcTime: 0,
  });
  const record = useMutation({
    mutationFn: (direction: "IN" | "OUT") =>
      caeApi.recordAccess(workspaceSlug, workerId, direction),
    onSuccess: async (_result, direction) => {
      toast.success(direction === "IN" ? t.checkedIn : t.checkedOut);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (check.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(check.error)}
        </EmptyState>
      </Card>
    );
  }
  const result = check.data;
  if (result === undefined) return <Skeleton className="h-56 w-full rounded-2xl" />;
  const Icon = result.authorized ? CheckCircle2 : XCircle;
  return (
    <div className="grid gap-3">
      <div
        role="status"
        className={cn(
          "rounded-2xl border-2 p-5 sm:p-6",
          result.authorized
            ? "border-success bg-success-soft text-success-soft-foreground"
            : "border-danger bg-danger-soft text-danger-soft-foreground",
        )}
      >
        <div className="flex items-center gap-3">
          <Icon className="size-10 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-3xl font-semibold tracking-tight">
            {result.authorized ? t.yes : t.no}
          </p>
        </div>
        <p className="mt-4 break-words text-xl font-medium">{result.name}</p>
        <p className="mt-1 text-base">
          {[
            result.company.name,
            result.task,
            result.idNumber === null ? null : t.idNumber(result.idNumber),
          ]
            .filter((value): value is string => value !== null && value !== "")
            .join(" · ")}
        </p>
        {result.reasons.length > 0 && (
          <ul className="mt-4 grid list-disc gap-1 pl-5 text-base">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {result.lastAccess !== null && (
          <p className="mt-4 text-sm">
            {t.lastAccess(result.lastAccess.direction, formatDateTime(result.lastAccess.at))}
          </p>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {result.accessLog && (
          <>
            <Button
              size="lg"
              disabled={!result.authorized || record.isPending}
              onClick={() => {
                record.mutate("IN");
              }}
            >
              <LogIn className="size-5" strokeWidth={1.75} aria-hidden="true" />
              {t.checkIn}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={record.isPending}
              onClick={() => {
                record.mutate("OUT");
              }}
            >
              <LogOut className="size-5" strokeWidth={1.75} aria-hidden="true" />
              {t.checkOut}
            </Button>
          </>
        )}
        <Button size="lg" variant="ghost" onClick={onClear}>
          {t.clear}
        </Button>
      </div>
    </div>
  );
}
