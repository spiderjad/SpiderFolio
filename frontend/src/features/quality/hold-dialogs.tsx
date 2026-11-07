// Product on hold (docs/spec/calidad.md, «Producto retenido»): putting it on hold, from a nonconformity
// or alone, and the decision on it — released, reworked, diverted or destroyed — signed on screen by
// whoever decides. The decision never changes.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { SignaturePad } from "@/components/signature-pad";
import { adminErrorText } from "@/features/admin/admin-utils";
import { dataUrlOf } from "@/features/safety/cae-common";
import { HOLD_DECISIONS, haccpApi, qualityKeys, type Hold } from "./quality-api";
import { texts } from "@/i18n";

const t = texts.quality.holds;

export function HoldDialog({ ncId, onClose }: { ncId: string | null; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [product, setProduct] = useState("");
  const [lot, setLot] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const blank = (text: string) => (text.trim() === "" ? null : text.trim());
  const save = useMutation({
    mutationFn: () =>
      haccpApi.createHold(workspaceSlug, {
        ncId,
        product: product.trim(),
        lot: blank(lot),
        quantity: blank(quantity),
        location: blank(location),
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.form.created);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = product.trim() !== "" && reason.trim() !== "";
  return (
    <DialogContent
      title={t.form.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!ready || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : t.create}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.product}>
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              value={product}
              onChange={(event) => {
                setProduct(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t.form.lot}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                value={lot}
                onChange={(event) => {
                  setLot(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.form.quantity}>
            {(control) => (
              <Input
                {...control}
                maxLength={60}
                placeholder={t.form.quantityPlaceholder}
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.form.location}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                value={location}
                onChange={(event) => {
                  setLocation(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={t.form.reason}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

type Decision = (typeof HOLD_DECISIONS)[number];

export function DecisionDialog({ hold, onClose }: { hold: Hold; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const d = t.decision;
  const decisions = useStaticSource(
    "quality-hold-decisions",
    HOLD_DECISIONS.map((id) => ({ id, label: t.statuses[id] })),
  );
  const [status, setStatus] = useState<Decision>("RELEASED");
  const [note, setNote] = useState("");
  const readSignature = useRef<() => Promise<Blob | null>>(() => Promise.resolve(null));
  const save = useMutation({
    mutationFn: async () => {
      const blob = await readSignature.current();
      if (blob === null) throw new Error(d.signature);
      return await haccpApi.decide(workspaceSlug, hold.id, {
        status,
        note: note.trim(),
        signature: await dataUrlOf(blob),
      });
    },
    onSuccess: async () => {
      toast.success(d.done);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={d.title}
      description={d.description}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={note.trim() === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : t.decide}
          </Button>
        </>
      }
    >
      <FormGrid>
        <p className="text-sm">
          <span className="font-medium">{hold.product}</span>
          {hold.lot !== null && <span className="text-muted-foreground"> · {hold.lot}</span>}
          {hold.quantity !== null && (
            <span className="text-muted-foreground"> · {hold.quantity}</span>
          )}
        </p>
        <FormField label={d.status}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={d.status}
              placeholder={d.status}
              source={decisions}
              value={status}
              onChange={(option) => {
                const next = HOLD_DECISIONS.find((id) => id === option?.id);
                if (next !== undefined) setStatus(next);
              }}
            />
          )}
        </FormField>
        <FormField label={d.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
              placeholder={d.notePlaceholder}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </FormField>
        <SignaturePad
          label={d.signature}
          register={(read) => {
            readSignature.current = read;
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}
