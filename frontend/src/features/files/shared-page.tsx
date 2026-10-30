// /app/:slug/files/shared — «Compartido conmigo» y «Compartido por mí». Lo primero: lo que le dieron
// a la persona (directo o por sus departamentos) en espacios que no ve; lo nuevo se marca hasta que
// lo abre. Lo segundo: lo que compartió ella (o su área, si lidera una) y poder quitar el acceso.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarPlus, Clock, Share2, UserMinus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { readChoice, useListParams, useSearchParam } from "@/features/admin/list-params";
import { expiryText } from "@/features/notifications/notification-bell";
import { sharingApi } from "@/features/sharing/api";
import { cn, dayInputOf, endOfDay, formatShortDate } from "@/lib/utils";
import { filesApi, filesKeys, previewKind, type SharedByMeItem, type SharedItem } from "./api";
import { NodeIcon } from "./file-utils";
import { texts } from "@/i18n";

/** Vence en los próximos 3 días: se destaca en ámbar. */
const soon = (expiresAt: string): boolean => {
  const left = new Date(expiresAt).getTime() - Date.now();
  return left < 3 * 86_400_000;
};

const TABS = ["with-me", "by-me"] as const;

const WEEK_MS = 7 * 86_400_000;

/** Vuelve a dar el mismo acceso con otro vencimiento (el servidor lo reemplaza). */
function regrant(slug: string, item: SharedByMeItem, expiresAt: string | null) {
  return sharingApi.set(slug, item.target, {
    ...(item.subject.type === "company"
      ? { everyone: true }
      : item.subject.type === "person"
        ? { membershipId: item.subject.id }
        : { departmentId: item.subject.id, includeSubareas: item.includeSubareas }),
    level: item.level,
    expiresAt,
  });
}

function pathOf(slug: string, item: SharedItem): string | null {
  const base = `/app/${slug}/files/${item.spaceId}`;
  if (item.type === "PAGE") return `${base}/p/${item.id}`;
  if (item.type === "FOLDER") return `${base}/f/${item.id}`;
  return null;
}

export function SharedPage() {
  const t = texts.files.shared;
  const { params, patch } = useListParams();
  const tab = readChoice(params, "tab", TABS, "with-me");
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div role="tablist" aria-label={t.tabs.label} className="flex flex-wrap gap-1.5">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              patch({ tab: value === "with-me" ? undefined : value, q: undefined });
            }}
            className="h-9 rounded-full border border-border px-4 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:border-primary/30 aria-selected:bg-primary-soft aria-selected:font-medium aria-selected:text-primary-soft-foreground"
          >
            {value === "with-me" ? t.tabs.withMe : t.tabs.byMe}
          </button>
        ))}
      </div>
      {tab === "with-me" ? <WithMe /> : <ByMe />}
    </div>
  );
}

// ─── Compartido conmigo ──────────────────────────────────────────────────────────────────

function WithMe() {
  const t = texts.files.shared;
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const list = useInfiniteList<SharedItem>({
    queryKey: [...filesKeys.all(workspaceSlug), "shared", "with-me", q],
    fetchPage: async (cursor, signal) => {
      const page = await filesApi.shared(workspaceSlug, q, cursor, signal);
      // La lista no trae total (se arma por tandas): el contador muestra lo cargado.
      return { ...page, total: 0 };
    },
  });
  const [opening, setOpening] = useState<string | null>(null);
  // Abrir un elemento lo marca como visto (y apaga «Nuevo» y el contador del menú).
  const open = useMutation({
    mutationFn: async (item: SharedItem) => {
      setOpening(item.id);
      if (item.isNew) await filesApi.markSeen(workspaceSlug, item.id);
      const to = pathOf(workspaceSlug, item);
      if (to !== null) return to;
      // Un archivo suelto no tiene carpeta que abrir: se ve (si se puede) o se descarga.
      const ticket = await filesApi.download(workspaceSlug, item.id, {
        inline: previewKind(item.mimeType) !== null,
      });
      window.open(ticket.url, "_blank", "noopener");
      return null;
    },
    onSuccess: async (to) => {
      await queryClient.invalidateQueries({
        queryKey: [...filesKeys.all(workspaceSlug), "shared"],
      });
      if (to !== null) void navigate(to);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
    onSettled: () => {
      setOpening(null);
    },
  });
  return (
    <>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t.search}
        label={t.search}
        className="max-w-sm"
      />
      <Card className="overflow-hidden">
        {list.query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.query.isError ? (
          <p role="alert" className="p-4 text-sm text-danger">
            {t.loadError}
          </p>
        ) : list.items.length === 0 ? (
          <EmptyState icon={Share2} {...(q === "" ? { title: t.emptyTitle } : {})}>
            {q === "" ? t.empty : t.none}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={opening === item.id}
                  onClick={() => {
                    open.mutate(item);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                    item.isNew && "bg-primary-soft/30",
                  )}
                >
                  <NodeIcon node={item} className="size-6" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          item.isNew ? "font-semibold" : "font-medium",
                        )}
                      >
                        {item.name}
                      </span>
                      {item.isNew && <Badge tone="primary">{t.isNew}</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        t.fromSpace(item.spaceName),
                        item.sharedBy === null ? null : t.sharedBy(item.sharedBy),
                        t.sharedOn(formatShortDate(item.sharedAt)),
                        item.expiresAt === null ? null : t.expires(formatShortDate(item.expiresAt)),
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                  </span>
                  <Badge>{texts.files.levels[item.level]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasNextPage={list.query.hasNextPage}
          isFetching={list.query.isFetchingNextPage}
          onLoadMore={list.loadMore}
        />
      </Card>
      {list.items.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t.shown(list.items.length, list.query.hasNextPage)}
        </p>
      )}
    </>
  );
}

// ─── Compartido por mí ───────────────────────────────────────────────────────────────────

function ByMe() {
  const t = texts.files.shared.byMe;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const list = useInfiniteList<SharedByMeItem>({
    queryKey: [...filesKeys.all(workspaceSlug), "shared", "by-me", q],
    fetchPage: async (cursor, signal) => {
      const page = await filesApi.sharedByMe(workspaceSlug, q, cursor, signal);
      return { ...page, total: 0 };
    },
  });
  const [removing, setRemoving] = useState<SharedByMeItem | null>(null);
  const [changing, setChanging] = useState<SharedByMeItem | null>(null);
  const highlight = params.get("highlight");
  const refresh = () => queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
  const extend = useMutation({
    mutationFn: (item: SharedByMeItem) => {
      if (item.expiresAt === null) return Promise.resolve(undefined);
      const from = Math.max(new Date(item.expiresAt).getTime(), Date.now());
      return regrant(workspaceSlug, item, new Date(from + WEEK_MS).toISOString());
    },
    onSuccess: async () => {
      toast.success(t.extended);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const hrefOf = (item: SharedByMeItem): string => {
    const base = `/app/${workspaceSlug}/files/${item.target.spaceId}`;
    if (item.target.type === "space") return base;
    if (item.target.nodeType === "PAGE") return `${base}/p/${item.target.id}`;
    return `${base}/f/${item.target.id}`;
  };
  return (
    <>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t.search}
        label={t.search}
        className="max-w-sm"
      />
      <Card className="overflow-hidden">
        {list.query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.query.isError ? (
          <p role="alert" className="p-4 text-sm text-danger">
            {texts.files.shared.loadError}
          </p>
        ) : list.items.length === 0 ? (
          <EmptyState icon={Share2} {...(q === "" ? { title: t.emptyTitle } : {})}>
            {q === "" ? t.empty : texts.files.shared.none}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((item) => (
              <li
                key={item.id}
                ref={
                  item.id === highlight
                    ? (node) => {
                        node?.scrollIntoView({ block: "center" });
                      }
                    : undefined
                }
                aria-current={item.id === highlight ? "true" : undefined}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-3",
                  item.id === highlight && "bg-primary-soft/40 ring-2 ring-inset ring-primary/40",
                )}
              >
                <div className="min-w-0 flex-1 basis-64">
                  <Link
                    to={hrefOf(item)}
                    className="block truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                  >
                    {item.target.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      t.with(item.subject.name),
                      item.includeSubareas && item.subject.type === "department"
                        ? t.subareas
                        : null,
                      texts.files.shared.fromSpace(item.target.spaceName),
                      item.mine || item.grantedBy === null ? null : t.by(item.grantedBy),
                      texts.files.shared.sharedOn(formatShortDate(item.sharedAt)),
                      item.expiresAt === null || soon(item.expiresAt)
                        ? null
                        : texts.files.shared.expires(formatShortDate(item.expiresAt)),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </p>
                  {item.expiresAt !== null && soon(item.expiresAt) && (
                    <p className="flex items-center gap-1 text-xs font-medium text-warning-soft-foreground">
                      <Clock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                      {expiryText(item.expiresAt)}
                    </p>
                  )}
                </div>
                <Badge>{texts.files.levels[item.level]}</Badge>
                {item.canRemove && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.expiresAt !== null && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={extend.isPending}
                        onClick={() => {
                          extend.mutate(item);
                        }}
                      >
                        <CalendarPlus strokeWidth={1.75} aria-hidden="true" />
                        {t.extend}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setChanging(item);
                      }}
                    >
                      <CalendarClock strokeWidth={1.75} aria-hidden="true" />
                      {t.change}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRemoving(item);
                      }}
                    >
                      <UserMinus strokeWidth={1.75} aria-hidden="true" />
                      {t.remove}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasNextPage={list.query.hasNextPage}
          isFetching={list.query.isFetchingNextPage}
          onLoadMore={list.loadMore}
        />
      </Card>
      <Dialog
        open={changing !== null}
        onOpenChange={(open) => {
          if (!open) setChanging(null);
        }}
      >
        {changing !== null && (
          <ChangeExpiry
            key={changing.id}
            item={changing}
            onDone={async () => {
              setChanging(null);
              await refresh();
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        icon={UserMinus}
        tone="warning"
        title={removing === null ? "" : t.removeTitle(removing.subject.name)}
        description={removing === null ? "" : t.removeText(removing.target.name)}
        confirmLabel={t.removeConfirm}
        pendingLabel={t.removePending}
        onConfirm={async () => {
          if (removing === null) return;
          await sharingApi.remove(workspaceSlug, removing.id);
          toast.success(t.removed);
          setRemoving(null);
          await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
        }}
      />
    </>
  );
}

function ChangeExpiry({ item, onDone }: { item: SharedByMeItem; onDone: () => Promise<unknown> }) {
  const t = texts.files.shared.byMe;
  const { workspaceSlug = "" } = useParams();
  const [date, setDate] = useState(item.expiresAt === null ? "" : dayInputOf(item.expiresAt));
  const save = useMutation({
    mutationFn: () => regrant(workspaceSlug, item, date === "" ? null : endOfDay(date)),
    onSuccess: async () => {
      toast.success(t.changed);
      await onDone();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.changeTitle(item.subject.name)}
      description={t.changeText}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline">{texts.admin.common.cancel}</Button>
          </DialogClose>
          <Button
            disabled={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? t.changeSaving : t.changeSave}
          </Button>
        </>
      }
    >
      <label className="grid gap-1 text-sm">
        {t.changeDate}
        <Input
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          className="h-10"
        />
      </label>
    </DialogContent>
  );
}
