// Administration › Audit rooms (docs/spec/salas-de-auditoria.md): the rooms one created (the owner, all),
// with their state, and a new one: name, the auditor's email, the expiry (30 days at most) and downloads.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { dayInputOf, formatDateTime, formatShortDate } from "@/lib/utils";
import { roomsApi, roomsKeys, type Room, type RoomState } from "./audit-rooms-api";
import { texts } from "@/i18n";

const t = texts.auditRooms;

export const roomTone: Record<RoomState, "success" | "neutral" | "danger"> = {
  open: "success",
  expired: "neutral",
  revoked: "danger",
};

export function RoomsPage() {
  const { workspaceSlug = "" } = useParams();
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Room>({
    queryKey: roomsKeys.list(workspaceSlug),
    fetchPage: (cursor, signal) => roomsApi.list(workspaceSlug, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Room>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <Link
            to={`/app/${workspaceSlug}/admin/audit-rooms/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: "auditor", header: t.columns.auditor, cell: ({ row }) => row.original.auditorEmail },
      {
        id: "expires",
        header: t.columns.expires,
        cell: ({ row }) => formatShortDate(row.original.expiresAt),
      },
      {
        id: "state",
        header: t.columns.state,
        cell: ({ row }) => (
          <Badge tone={roomTone[row.original.state]}>{t.states[row.original.state]}</Badge>
        ),
      },
      { id: "items", header: t.columns.items, cell: ({ row }) => t.itemsCount(row.original.items) },
      {
        id: "lastAccess",
        header: t.columns.lastAccess,
        cell: ({ row }) =>
          row.original.lastAccessAt === null ? t.never : formatDateTime(row.original.lastAccessAt),
      },
    ],
    [workspaceSlug],
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t.create}
        </Button>
      </div>
      <Card className="p-0">
        {!list.query.isPending && list.items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t.empty}>
            {t.subtitle}
          </EmptyState>
        ) : (
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(room) => room.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        )}
      </Card>
      <NewRoomDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
    </div>
  );
}

function NewRoomDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = dayInputOf(new Date().toISOString());
  const max = dayInputOf(new Date(Date.now() + 30 * 86_400_000).toISOString());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [allowDownload, setAllowDownload] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      roomsApi.create(workspaceSlug, { name, auditorEmail: email, expiresOn, allowDownload }),
    onSuccess: async ({ room }) => {
      toast.success(t.form.created);
      await queryClient.invalidateQueries({ queryKey: roomsKeys.all(workspaceSlug) });
      onClose();
      void navigate(`/app/${workspaceSlug}/admin/audit-rooms/${room.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const f = t.form;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={f.title}
        description={f.description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline">{texts.common.cancel}</Button>
            </DialogClose>
            <Button
              disabled={
                create.isPending ||
                name.trim().length < 2 ||
                email.trim() === "" ||
                expiresOn === ""
              }
              onClick={() => {
                create.mutate();
              }}
            >
              {f.save}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField label={f.name}>
            {(field) => (
              <Input
                {...field}
                maxLength={120}
                placeholder={f.namePlaceholder}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.email}>
            {(field) => (
              <Input
                {...field}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.expiresOn} hint={f.expiresHint}>
            {(field) => (
              <Input
                {...field}
                type="date"
                min={today}
                max={max}
                value={expiresOn}
                onChange={(event) => {
                  setExpiresOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={allowDownload}
              onChange={(event) => {
                setAllowDownload(event.target.checked);
              }}
            />
            <span>
              <span className="font-medium">{f.allowDownload}</span>
              <span className="block text-xs text-muted-foreground">{f.allowDownloadHint}</span>
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
