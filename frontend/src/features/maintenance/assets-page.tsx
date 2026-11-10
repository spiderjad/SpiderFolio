// /app/:slug/mantenimiento/equipos — equipment (docs/spec/mantenimiento.md, section 1): the tree of lines,
// machines and components, each with its documents folder and the QR to stick on it (it opens «Report a
// breakdown» with it chosen). maintenance.manage creates and edits.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cog, Pencil, Plus, QrCode } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import {
  ASSET_STATUSES,
  CRITICALITY,
  maintenanceApi,
  maintenanceKeys,
  type Asset,
} from "./maintenance-api";
import { useAssetSource, useAssets, useMaintenance } from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.assets;
const k = texts.maintenance;

/** The tree, flattened in order with each one's depth. */
function flatten(assets: readonly Asset[]): { asset: Asset; depth: number }[] {
  const children = new Map<string | null, Asset[]>();
  const ids = new Set(assets.map((asset) => asset.id));
  for (const asset of assets) {
    const parent = asset.parentId !== null && ids.has(asset.parentId) ? asset.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), asset]);
  }
  const out: { asset: Asset; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const asset of children.get(parent) ?? []) {
      out.push({ asset, depth });
      walk(asset.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function AssetsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useMaintenance();
  const [archived, setArchived] = useState(false);
  const assets = useAssets(archived);
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  const rows = useMemo(() => flatten(assets.data ?? []), [assets.data]);
  const qr = useMutation({
    mutationFn: async (asset: Asset) => ({
      asset,
      blob: await maintenanceApi.assetQr(workspaceSlug, asset.id, "png"),
    }),
    onSuccess: ({ asset, blob }) => {
      downloadBlobFile(`qr-${asset.code}.png`, blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="v-segmented" role="tablist">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                role="tab"
                aria-selected={archived === value}
                className="v-segmented__item"
                onClick={() => {
                  setArchived(value);
                }}
              >
                {value ? k.common.archived : k.common.active}
              </button>
            ))}
          </div>
          {manage && !archived && (
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.new}
            </Button>
          )}
        </div>
      </div>
      {assets.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Cog} title={t.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map(({ asset, depth }) => (
              <li
                key={asset.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                style={{ paddingLeft: `${String(16 + depth * 24)}px` }}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{asset.code}</span>
                    <span>{asset.name}</span>
                    {asset.criticality === "A" && <Badge tone="danger">{k.criticality.A}</Badge>}
                    {asset.foodContact && <Badge tone="primary">{t.foodContact}</Badge>}
                    {asset.status !== "OPERATING" && (
                      <Badge tone="warning">{k.assetStatuses[asset.status]}</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[asset.location, [asset.manufacturer, asset.model].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {asset.openWorkOrders > 0 && (
                    <Link
                      to={`/app/${workspaceSlug}/mantenimiento/ot?equipo=${asset.id}&estado=open`}
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t.columns.open}: {asset.openWorkOrders}
                    </Link>
                  )}
                  {asset.folder !== null && (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        to={`/app/${workspaceSlug}/files/${asset.folder.spaceId}/f/${asset.folder.id}`}
                      >
                        {k.common.documents}
                      </Link>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`${t.qrDownload}: ${asset.code}`}
                    title={t.qrDownload}
                    disabled={qr.isPending}
                    onClick={() => {
                      qr.mutate(asset);
                    }}
                  >
                    <QrCode className="size-4" aria-hidden="true" />
                  </Button>
                  {manage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`${k.common.edit}: ${asset.code}`}
                      onClick={() => {
                        setEditing(asset);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing !== null && (
        <AssetDialog
          asset={editing === "new" ? undefined : editing}
          all={assets.data ?? []}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AssetDialog({
  asset,
  all,
  onClose,
}: {
  asset?: Asset | undefined;
  all: readonly Asset[];
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = t.form;
  const parents = useAssetSource(
    "parents",
    all.filter((item) => item.id !== asset?.id),
  );
  const criticality = useStaticSource(
    "maintenance-criticality",
    CRITICALITY.map((id) => ({ id, label: k.criticality[id] })),
  );
  const statuses = useStaticSource(
    "maintenance-asset-statuses",
    ASSET_STATUSES.map((id) => ({ id, label: k.assetStatuses[id] })),
  );
  const [state, setState] = useState({
    code: asset?.code ?? "",
    name: asset?.name ?? "",
    parentId: asset?.parentId ?? null,
    location: asset?.location ?? "",
    manufacturer: asset?.manufacturer ?? "",
    model: asset?.model ?? "",
    serial: asset?.serial ?? "",
    installedOn: asset?.installedOn ?? "",
    criticality: asset?.criticality ?? "B",
    status: asset?.status ?? "OPERATING",
    foodContact: asset?.foodContact ?? false,
    notes: asset?.notes ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        code: state.code.trim(),
        name: state.name.trim(),
        parentId: state.parentId,
        location: state.location.trim(),
        manufacturer: state.manufacturer.trim(),
        model: state.model.trim(),
        serial: state.serial.trim(),
        installedOn: state.installedOn === "" ? null : state.installedOn,
        criticality: state.criticality,
        foodContact: state.foodContact,
        status: state.status,
        notes: state.notes.trim(),
      };
      return asset === undefined
        ? maintenanceApi.createAsset(workspaceSlug, body)
        : maintenanceApi.updateAsset(workspaceSlug, asset.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(asset === undefined ? k.common.created : k.common.saved);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const text = (
    label: string,
    key: "code" | "name" | "location" | "manufacturer" | "model" | "serial",
    max: number,
    hint?: string,
  ) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={asset === undefined ? t.new : t.edit}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {asset === undefined ? (
              <span />
            ) : (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate(!asset.archived);
                }}
              >
                {asset.archived ? k.common.restore : k.common.archive}
              </Button>
            )}
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="outline" disabled={save.isPending}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                disabled={state.code.trim() === "" || state.name.trim() === "" || save.isPending}
                onClick={() => {
                  save.mutate(undefined);
                }}
              >
                {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            {text(f.code, "code", 40, f.codeHint)}
            {text(f.name, "name", 160)}
          </div>
          <FormField label={f.parent}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.parent}
                placeholder={f.parentPlaceholder}
                source={parents}
                value={state.parentId}
                onChange={(option) => {
                  set({ parentId: option?.id ?? null });
                }}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            {text(f.location, "location", 120)}
            {text(f.manufacturer, "manufacturer", 120)}
            {text(f.model, "model", 120)}
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            {text(f.serial, "serial", 120)}
            <FormField label={f.installedOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.installedOn}
                  onChange={(event) => {
                    set({ installedOn: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.criticality}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  label={f.criticality}
                  placeholder={f.criticality}
                  source={criticality}
                  value={state.criticality}
                  onChange={(option) => {
                    const value = CRITICALITY.find((id) => id === option?.id);
                    if (value !== undefined) set({ criticality: value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.status}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  label={f.status}
                  placeholder={f.status}
                  source={statuses}
                  value={state.status}
                  onChange={(option) => {
                    const value = ASSET_STATUSES.find((id) => id === option?.id);
                    if (value !== undefined) set({ status: value });
                  }}
                />
              )}
            </FormField>
          </div>
          <Checkbox
            label={f.foodContact}
            checked={state.foodContact}
            onChange={(event) => {
              set({ foodContact: event.target.checked });
            }}
          />
          <FormField label={f.notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={4000}
                value={state.notes}
                onChange={(event) => {
                  set({ notes: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
