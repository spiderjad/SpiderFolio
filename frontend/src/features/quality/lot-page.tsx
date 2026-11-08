// /app/:slug/calidad/trazabilidad/:lotId — one lot (docs/spec/calidad.md, «Fase 7»): its data, what it
// comes from, what it went into, who got it and what mentions it; and its trace backward or forward, with
// the totals, the export and «Registrar como simulacro» (the minutes counted since the trace was opened).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Pencil, Plus, ShieldAlert, Timer, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatNumber, formatUtcDate } from "@/lib/utils";
import { TestDialog, type TestStart } from "./crisis-page";
import { useLotSource } from "./lot-picker";
import {
  lotKeys,
  lotsApi,
  type LotDetail,
  type LotLink,
  type TraceDirection,
} from "./lots-api";
import { qualityKeys } from "./quality-api";
import { todayDay, useQuality } from "./quality-common";
import { LotDialog, LotKindBadge, lotWhat, quantityText } from "./traceability-page";
import { texts } from "@/i18n";

const t = texts.quality.trace;
const d = t.detail;

function useRefresh() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
  };
}

const onError = (error: unknown) => {
  toast.error(adminErrorText(error));
};

function decimal(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function Footer({
  pending,
  ready,
  label,
  onSave,
}: {
  pending: boolean;
  ready: boolean;
  label: string;
  onSave: () => void;
}) {
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" disabled={pending}>
          {texts.admin.common.cancel}
        </Button>
      </DialogClose>
      <Button disabled={!ready || pending} onClick={onSave}>
        {pending ? texts.admin.common.saving : label}
      </Button>
    </>
  );
}

function InputDialog({ lot, onClose }: { lot: LotDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefresh();
  const f = d.inputDialog;
  const source = useLotSource();
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(lot.unit ?? "kg");
  const amount = decimal(quantity);
  const save = useMutation({
    mutationFn: () =>
      lotsApi.addInput(workspaceSlug, lot.id, {
        inputId: picked?.id ?? "",
        quantity: amount ?? null,
        unit: unit.trim() === "" ? null : unit.trim(),
      }),
    onSuccess: async () => {
      toast.success(f.added);
      await refresh();
      onClose();
    },
    onError,
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={picked !== null && amount !== undefined}
          label={texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <FormField label={f.lot}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={f.lot}
              placeholder={f.lotPlaceholder}
              source={source}
              value={picked?.id ?? null}
              valueLabel={picked?.label}
              onChange={(option) => {
                setPicked(option === null ? null : { id: option.id, label: option.label });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t.form.quantity}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.form.unit}>
            {(control) => (
              <Input
                {...control}
                maxLength={20}
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </FormGrid>
    </DialogContent>
  );
}

function ShipmentDialog({ lot, onClose }: { lot: LotDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefresh();
  const f = d.shipmentDialog;
  const [state, setState] = useState({
    customer: "",
    document: "",
    shippedOn: todayDay(),
    quantity: "",
    unit: lot.unit ?? "kg",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const amount = decimal(state.quantity);
  const save = useMutation({
    mutationFn: () =>
      lotsApi.addShipment(workspaceSlug, lot.id, {
        customer: state.customer.trim(),
        document: state.document.trim() === "" ? null : state.document.trim(),
        shippedOn: state.shippedOn,
        quantity: amount ?? null,
        unit: state.unit.trim() === "" ? null : state.unit.trim(),
      }),
    onSuccess: async () => {
      toast.success(f.added);
      await refresh();
      onClose();
    },
    onError,
  });
  const field = (
    label: string,
    key: "customer" | "document" | "shippedOn" | "quantity" | "unit",
    max?: number,
  ) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          {...(key === "shippedOn" ? { type: "date" } : {})}
          {...(key === "quantity" ? { inputMode: "decimal" as const } : {})}
          {...(max === undefined ? {} : { maxLength: max })}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={state.customer.trim() !== "" && state.shippedOn !== "" && amount !== undefined}
          label={texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          {field(f.customer, "customer", 160)}
          {field(f.document, "document", 80)}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field(f.shippedOn, "shippedOn")}
          {field(t.form.quantity, "quantity")}
          {field(t.form.unit, "unit", 20)}
        </div>
      </FormGrid>
    </DialogContent>
  );
}

function LinkList({
  links,
  empty,
  onRemove,
  busy,
}: {
  links: LotLink[];
  empty: string;
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  if (links.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {links.map((link) => (
        <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <Link
            to={`/app/${workspaceSlug}/calidad/trazabilidad/${link.lot.id}`}
            className="font-medium tabular-nums underline-offset-4 hover:underline"
          >
            {link.lot.code}
          </Link>
          <LotKindBadge kind={link.lot.kind} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{lotWhat(link.lot)}</span>
          <span className="tabular-nums">{quantityText(link.quantity, link.unit)}</span>
          {link.editable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={d.removeLink}
              disabled={busy}
              onClick={() => {
                onRemove(link.id);
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TraceCard({ lot }: { lot: LotDetail }) {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useQuality();
  const v = t.view;
  const [direction, setDirection] = useState<TraceDirection>(
    lot.kind === "FINISHED" ? "backward" : "forward",
  );
  const opened = useRef(Date.now());
  const [drill, setDrill] = useState<TestStart | null>(null);
  const query = useQuery({
    queryKey: lotKeys.trace(workspaceSlug, lot.id, direction),
    queryFn: () => lotsApi.trace(workspaceSlug, lot.id, direction),
  });
  const download = useMutation({
    mutationFn: (format: "csv" | "pdf") => lotsApi.exportTrace(workspaceSlug, lot.id, direction, format),
    onSuccess: (blob, format) => {
      downloadBlobFile(`${lot.code}.${format}`, blob);
    },
    onError,
  });
  const trace = query.data;
  const codeOf = new Map((trace?.lots ?? []).map((item) => [item.id, item]));
  return (
    <Card className="grid gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{v.title}</CardTitle>
        <div role="radiogroup" aria-label={v.title} className="flex gap-1">
          {(["backward", "forward"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              role="radio"
              aria-checked={direction === value}
              variant={direction === value ? "primary" : "outline"}
              onClick={() => {
                setDirection(value);
              }}
            >
              {v[value]}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {direction === "backward" ? v.backwardHint : v.forwardHint}
      </p>
      {trace === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-4">
            {[
              { label: v.lots, value: String(trace.totals.lots) },
              direction === "backward"
                ? { label: v.rawMaterials, value: String(trace.totals.rawMaterials) }
                : { label: v.customers, value: String(trace.totals.customers) },
              direction === "backward"
                ? { label: v.suppliers, value: String(trace.totals.suppliers) }
                : {
                    label: v.shipped,
                    value:
                      trace.totals.shipped.length === 0
                        ? "—"
                        : trace.totals.shipped
                            .map((item) => `${formatNumber(item.quantity)} ${item.unit}`.trim())
                            .join(" · "),
                  },
              { label: v.tookLabel, value: `${String(trace.ms)} ms` },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border p-3">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
          {trace.truncated && (
            <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-warning">
              <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
              {v.truncated}
            </p>
          )}
          <ol className="grid gap-1" aria-label={v.lots}>
            {trace.lots.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm"
                style={{ marginInlineStart: `${String(Math.min(item.depth, 6) * 1.25)}rem` }}
              >
                <span className="w-16 shrink-0 text-xs text-muted-foreground">
                  {v.level(item.depth)}
                </span>
                {item.id === lot.id ? (
                  <span className="font-semibold tabular-nums">{item.code}</span>
                ) : (
                  <Link
                    to={`/app/${workspaceSlug}/calidad/trazabilidad/${item.id}`}
                    className="font-medium tabular-nums underline-offset-4 hover:underline"
                  >
                    {item.code}
                  </Link>
                )}
                <LotKindBadge kind={item.kind} />
                <span className="min-w-0 flex-1 truncate">{lotWhat(item)}</span>
                {item.supplier !== null && (
                  <span className="text-xs text-muted-foreground">
                    {item.supplier.name}
                    {item.supplierLot === null ? "" : ` · ${item.supplierLot}`}
                  </span>
                )}
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatUtcDate(item.date)}
                </span>
              </li>
            ))}
          </ol>
          {direction === "forward" && (
            <div className="grid gap-2">
              <CardTitle>{d.shipments}</CardTitle>
              {trace.shipments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{v.noShipments}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {trace.shipments.map((shipment) => (
                    <li
                      key={shipment.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <span className="font-medium">{shipment.customer}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {[shipment.document, codeOf.get(shipment.lotId)?.code]
                          .filter((part) => part !== null && part !== undefined)
                          .join(" · ")}
                      </span>
                      <span className="flex-1" />
                      <span className="tabular-nums">
                        {quantityText(shipment.quantity, shipment.unit)}
                      </span>
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatUtcDate(shipment.shippedOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={() => {
                download.mutate("csv");
              }}
            >
              <FileDown className="size-4" aria-hidden="true" />
              {v.csv}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={download.isPending}
              onClick={() => {
                download.mutate("pdf");
              }}
            >
              <FileDown className="size-4" aria-hidden="true" />
              {v.pdf}
            </Button>
            {manage && (
              <Button
                variant="outline"
                size="sm"
                title={v.drillHint}
                onClick={() => {
                  setDrill({
                    product: lotWhat(lot) === "—" ? lot.code : lotWhat(lot),
                    lot: { id: lot.id, code: lot.code },
                    direction: direction === "backward" ? "BACKWARD" : "FORWARD",
                    minutes: Math.max(1, Math.round((Date.now() - opened.current) / 60_000)),
                  });
                }}
              >
                <Timer className="size-4" aria-hidden="true" />
                {v.drill}
              </Button>
            )}
          </div>
        </>
      )}
      <Dialog
        open={drill !== null}
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
      >
        {drill !== null && (
          <TestDialog
            start={drill}
            onClose={() => {
              setDrill(null);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

export function LotPage() {
  const { workspaceSlug = "", lotId = "" } = useParams();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [dialog, setDialog] = useState<"edit" | "input" | "shipment" | "delete" | null>(null);
  const query = useQuery({
    queryKey: lotKeys.one(workspaceSlug, lotId),
    queryFn: () => lotsApi.get(workspaceSlug, lotId),
    select: (data) => data.lot,
  });
  const removeLink = useMutation({
    mutationFn: (id: string) => lotsApi.removeLink(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(d.removed);
      await refresh();
    },
    onError,
  });
  const removeShipment = useMutation({
    mutationFn: (id: string) => lotsApi.removeShipment(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(d.removed);
      await refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => lotsApi.remove(workspaceSlug, lotId),
    onSuccess: async () => {
      toast.success(d.deleted);
      await refresh();
      await navigate(`/app/${workspaceSlug}/calidad/trazabilidad`);
    },
    onError,
  });
  const backLink = (
    <Link
      to={`/app/${workspaceSlug}/calidad/trazabilidad`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {d.back}
    </Link>
  );
  const lot = query.data;
  if (query.isError) {
    return (
      <div className="grid gap-4">
        {backLink}
        <Card className="p-5 text-sm">{adminErrorText(query.error)}</Card>
      </div>
    );
  }
  if (lot === undefined) return <Skeleton className="h-80" />;
  const close = () => {
    setDialog(null);
  };
  const facts = [
    { label: t.columns.what, value: lotWhat(lot) },
    ...(lot.supplier === null ? [] : [{ label: t.columns.supplier, value: lot.supplier.name }]),
    ...(lot.supplierLot === null ? [] : [{ label: d.supplierLot, value: lot.supplierLot }]),
    ...(lot.origin === null ? [] : [{ label: d.origin, value: lot.origin }]),
    { label: d.quantity, value: quantityText(lot.quantity, lot.unit) },
    { label: d.date, value: formatUtcDate(lot.date) },
    ...(lot.expiresOn === null ? [] : [{ label: d.expiresOn, value: formatUtcDate(lot.expiresOn) }]),
    { label: d.source, value: t.sources[lot.source] },
  ];
  const mentions = lot.holds.length + lot.complaints.length + lot.recallTests.length;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tabular-nums tracking-tight">
              {lot.code}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LotKindBadge kind={lot.kind} />
              {lot.source === "PLUGIN" && <Badge tone="neutral">{t.sources.PLUGIN}</Badge>}
            </div>
          </div>
          {lot.editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("edit");
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {d.edit}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("delete");
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {d.delete}
              </Button>
            </div>
          )}
        </div>
        {lot.source === "PLUGIN" && (
          <p className="text-xs text-muted-foreground">{d.fromPlugin}</p>
        )}
      </div>
      <Card className="p-4 sm:p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <TraceCard key={lot.id} lot={lot} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="grid content-start gap-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{d.inputs}</CardTitle>
            {lot.editable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("input");
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {d.addInput}
              </Button>
            )}
          </div>
          <LinkList
            links={lot.inputs}
            empty={d.inputsEmpty}
            busy={removeLink.isPending}
            onRemove={(id) => {
              removeLink.mutate(id);
            }}
          />
        </Card>
        <Card className="grid content-start gap-2 p-4 sm:p-5">
          <CardTitle>{d.outputs}</CardTitle>
          <LinkList
            links={lot.outputs}
            empty={d.outputsEmpty}
            busy={removeLink.isPending}
            onRemove={(id) => {
              removeLink.mutate(id);
            }}
          />
        </Card>
      </div>
      <Card className="grid gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{d.shipments}</CardTitle>
          {lot.editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDialog("shipment");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {d.addShipment}
            </Button>
          )}
        </div>
        {lot.shipments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.shipmentsEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {lot.shipments.map((shipment) => (
              <li
                key={shipment.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-medium">{shipment.customer}</span>
                {shipment.document !== null && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {shipment.document}
                  </span>
                )}
                <span className="flex-1" />
                <span className="tabular-nums">
                  {quantityText(shipment.quantity, shipment.unit)}
                </span>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {formatUtcDate(shipment.shippedOn)}
                </span>
                {shipment.editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={d.removeShipment}
                    disabled={removeShipment.isPending}
                    onClick={() => {
                      removeShipment.mutate(shipment.id);
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {mentions > 0 && (
        <Card className="grid gap-2 p-4 text-sm sm:p-5">
          <CardTitle>{d.mentions}</CardTitle>
          {lot.holds.length > 0 && (
            <p>
              <span className="text-muted-foreground">{d.holdsLabel}: </span>
              {lot.holds.map((hold, index) => (
                <span key={hold.id}>
                  {index > 0 && ", "}
                  <Link
                    to={`/app/${workspaceSlug}/calidad/retenido`}
                    className="underline-offset-4 hover:underline"
                  >
                    {hold.product}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {lot.complaints.length > 0 && (
            <p>
              <span className="text-muted-foreground">{d.complaintsLabel}: </span>
              {lot.complaints.map((complaint, index) => (
                <span key={complaint.id}>
                  {index > 0 && ", "}
                  <Link
                    to={`/app/${workspaceSlug}/calidad/reclamaciones/${complaint.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {complaint.from}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {lot.recallTests.length > 0 && (
            <p>
              <span className="text-muted-foreground">{d.recallLabel}: </span>
              <Link
                to={`/app/${workspaceSlug}/calidad/crisis`}
                className="underline-offset-4 hover:underline"
              >
                {lot.recallTests.map((test) => formatUtcDate(test.date)).join(", ")}
              </Link>
            </p>
          )}
        </Card>
      )}
      <Dialog
        open={dialog === "edit" || dialog === "input" || dialog === "shipment"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog === "edit" && <LotDialog lot={lot} onClose={close} />}
        {dialog === "input" && <InputDialog lot={lot} onClose={close} />}
        {dialog === "shipment" && <ShipmentDialog lot={lot} onClose={close} />}
      </Dialog>
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        icon={Trash2}
        tone="destructive"
        title={d.deleteTitle}
        description={d.deleteText}
        confirmLabel={d.delete}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          await remove.mutateAsync();
        }}
      />
    </div>
  );
}
