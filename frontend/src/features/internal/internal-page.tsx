// /internal: backoffice de quien administra la instalación (solo User.isStaff; el resto ve «no
// encontrada»). Las empresas de este servidor con su uso y sus límites. Solo cantidades.
import { Building2 } from "lucide-react";
import { Outlet } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import { loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import {
  internalApi,
  licenseKeys,
  type InternalWorkspace,
} from "@/features/admin/license/license-api";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatBytes, formatShortDate } from "@/lib/utils";
import { locale, texts } from "@/i18n";

const t = texts.license.internal;
const l = texts.license.limits;

/** Para quien no administra la instalación, /internal no existe. */
export function RequireStaff() {
  const { account } = useAuth();
  return account?.user.isStaff === true ? <Outlet /> : <NotFoundPage />;
}

export function InternalPage() {
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const list = useInfiniteList<InternalWorkspace>({
    queryKey: [...licenseKeys.companies(), q],
    fetchPage: (cursor, signal) => internalApi.companies(q, cursor, signal),
  });
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t.search}
        label={t.search}
        className="max-w-sm"
      />
      <Card>
        {list.query.isError && list.items.length === 0 ? (
          <EmptyState icon={loadErrorIcon(list.query.error)} title={t.loadError}>
            {loadErrorText(list.query.error)}
          </EmptyState>
        ) : list.query.isPending ? (
          <Skeleton className="m-4 h-40" />
        ) : list.items.length === 0 ? (
          <EmptyState icon={Building2}>{t.empty}</EmptyState>
        ) : (
          <InfiniteList
            items={list.items}
            getKey={(item) => item.id}
            estimateHeight={120}
            maxHeightClass="max-h-[70vh]"
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
            renderItem={(company) => (
              <div className="grid gap-2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{company.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {company.slug} · {t.created(formatShortDate(company.createdAt))}
                    </p>
                  </div>
                  {company.licensed && <Badge tone="success">{t.licensed}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {l.storage}:{" "}
                  {company.usage.storageMaxBytes === null
                    ? `${formatBytes(company.usage.storageBytes)} · ${l.unlimited}`
                    : l.of(
                        formatBytes(company.usage.storageBytes),
                        formatBytes(company.usage.storageMaxBytes),
                      )}
                  {" · "}
                  {l.membersValue(
                    company.usage.members.FULL.toLocaleString(locale),
                    company.usage.members.READER.toLocaleString(locale),
                  )}
                  {" · "}
                  {l.aiThisMonth}: {company.usage.aiQueriesThisMonth.toLocaleString(locale)}
                </p>
              </div>
            )}
          />
        )}
      </Card>
    </div>
  );
}
