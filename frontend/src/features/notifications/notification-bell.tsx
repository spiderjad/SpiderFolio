// Campana de avisos de la barra superior (todas las pantallas): «X compartió Y contigo» y «Tu acceso a
// Y vence mañana», con contador de no leídas. Abrir un aviso lo marca como leído y lleva a lo
// compartido; «Marcar todas» las limpia. Cada persona ve solo las suyas (lo decide el servidor).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Clock, Share2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import type { NodeType, Page } from "@/features/files/api";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { texts } from "@/i18n";

export interface NotificationView {
  id: string;
  kind:
    | "shared"
    | "expiring"
    | "expiring_granted"
    | "approval_pending"
    | "approval_approved"
    | "approval_rejected"
    | "approval_changes"
    | "reading_required"
    | "reading_reminder"
    | "reading_overdue_leader"
    | "email_fallback"
    | "bian_usage"
    | "bian_request"
    | "invitation_by_leader";
  createdAt: string;
  readAt: string | null;
  actor: { id: string; name: string } | null;
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
    parentId: string | null;
  } | null;
  expiresAt: string | null;
  /** Número de versión (documentos) o umbral en % (avisos de uso de Bian). */
  version: number | null;
  permissionId: string | null;
  subject: { type: "person" | "department"; name: string } | null;
  /** Invitación hecha por un jefe: a quién y a qué departamentos. */
  invitation: { email: string; departments: string[] } | null;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const notificationsKey = (slug: string) => ["w", slug, "notifications"] as const;

const notificationsApi = {
  list: (slug: string) =>
    api<Page<NotificationView> & { unread: number }>(w(slug, "/notifications?pageSize=15")),
  summary: (slug: string) => api<{ unread: number }>(w(slug, "/notifications/summary")),
  read: (slug: string, id: string) =>
    api<undefined>(w(slug, `/notifications/${id}/read`), { method: "POST" }),
  readAll: (slug: string) => api<undefined>(w(slug, "/notifications/read-all"), { method: "POST" }),
};

/** «vence hoy», «vence mañana», «vence en 2 días» (o «venció»). */
export function expiryText(expiresAt: string, now: Date = new Date()): string {
  const t = texts.notifications;
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
  if (days <= 0) return t.expiresToday;
  if (days === 1) return t.expiresTomorrow;
  return t.expiresInDays(days);
}

function pathOf(slug: string, item: NotificationView): string | null {
  if (item.kind === "email_fallback") return `/app/${slug}/admin/security?tab=email`;
  if (item.kind === "invitation_by_leader") return `/app/${slug}/admin/members`;
  if (item.kind === "bian_usage" || item.kind === "bian_request") {
    return `/app/${slug}/admin/bian${item.kind === "bian_request" ? "?tab=usage" : ""}`;
  }
  const target = item.target;
  if (target === null) return null;
  // Al que compartió se le abre «Compartido por mí» con ese acceso resaltado.
  if (item.kind === "expiring_granted") {
    const params = new URLSearchParams({ tab: "by-me", q: target.name });
    if (item.permissionId !== null) params.set("highlight", item.permissionId);
    return `/app/${slug}/files/shared?${params.toString()}`;
  }
  const base = `/app/${slug}/files/${target.spaceId}`;
  if (target.type === "space") return base;
  if (target.nodeType === "PAGE") return `${base}/p/${target.id}`;
  if (target.nodeType === "FOLDER") return `${base}/f/${target.id}`;
  return target.parentId === null ? base : `${base}/f/${target.parentId}`;
}

function text(item: NotificationView): string {
  const t = texts.notifications;
  if (item.kind === "email_fallback") return t.emailFallback;
  if (item.kind === "bian_usage") return t.bianUsage(item.version ?? 80);
  if (item.kind === "bian_request") return t.bianRequest(item.actor?.name ?? "");
  if (item.kind === "invitation_by_leader") {
    return t.invitationByLeader(
      item.actor?.name ?? "",
      item.invitation?.email ?? "",
      (item.invitation?.departments ?? []).join(", "),
    );
  }
  if (item.target === null) return t.noAccess;
  if (item.kind === "reading_required") return t.readingRequired(item.target.name);
  if (item.kind === "reading_reminder") return t.readingReminder(item.target.name);
  if (item.kind === "reading_overdue_leader") {
    return t.readingOverdueLeader(item.actor?.name ?? "", item.target.name);
  }
  if (item.kind === "approval_pending") return t.approvalPending(item.target.name);
  if (item.kind === "approval_approved") return t.approvalApproved(item.target.name);
  if (item.kind === "approval_rejected") return t.approvalRejected(item.target.name);
  if (item.kind === "approval_changes")
    return t.approvalChanges(item.actor?.name ?? "", item.target.name);
  if (item.kind === "expiring_granted") {
    return t.expiringGranted(
      item.subject?.name ?? "",
      item.target.name,
      item.expiresAt === null ? "" : expiryText(item.expiresAt),
    );
  }
  if (item.kind === "expiring") {
    return t.expiring(item.target.name, item.expiresAt === null ? "" : expiryText(item.expiresAt));
  }
  return item.actor === null
    ? t.sharedAnon(item.target.name)
    : t.shared(item.actor.name, item.target.name);
}

export function NotificationBell({ slug }: { slug: string }) {
  const t = texts.notifications;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: [...notificationsKey(slug), "summary"],
    queryFn: () => notificationsApi.summary(slug),
    staleTime: 20_000,
    refetchInterval: 120_000,
  });
  const list = useQuery({
    queryKey: [...notificationsKey(slug), "list"],
    queryFn: () => notificationsApi.list(slug),
    staleTime: 10_000,
  });
  const unread = summary.data?.unread ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsKey(slug) });
  const open = useMutation({
    mutationFn: async (item: NotificationView) => {
      if (item.readAt === null) await notificationsApi.read(slug, item.id);
    },
    onSettled: refresh,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const readAll = useMutation({
    mutationFn: () => notificationsApi.readAll(slug),
    onSettled: refresh,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DropdownMenu
      onOpenChange={(isOpen) => {
        if (isOpen) void refresh();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? t.labelUnread(unread) : t.label}
        >
          <Bell strokeWidth={1.75} aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] max-w-[92vw] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">{t.title}</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || readAll.isPending}
            onClick={() => {
              readAll.mutate();
            }}
          >
            <CheckCheck strokeWidth={1.75} aria-hidden="true" />
            {t.markAll}
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1">
          {list.isPending ? (
            <Skeleton className="m-2 h-12" />
          ) : list.isError ? (
            <p role="alert" className="p-3 text-sm text-danger">
              {t.loadError}
            </p>
          ) : list.data.items.length === 0 ? (
            <p className="p-4 sm:p-5 text-center text-xs text-muted-foreground">{t.empty}</p>
          ) : (
            list.data.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className={cn(
                  "h-auto items-start gap-3 py-2",
                  item.readAt === null && "bg-primary-soft/30",
                )}
                onSelect={() => {
                  open.mutate(item);
                  const to = pathOf(slug, item);
                  if (to !== null) void navigate(to);
                }}
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {item.kind === "expiring" || item.kind === "expiring_granted" ? (
                    <Clock className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <Share2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", item.readAt === null && "font-medium")}>
                    {text(item)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {timeAgo(item.createdAt)}
                  </span>
                </span>
                {item.readAt === null && (
                  <span
                    aria-label={t.unreadMark}
                    className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                  />
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
