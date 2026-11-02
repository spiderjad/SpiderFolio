// /app/:slug/seguridad/epis/nueva — a PPE handout (docs/spec/seguridad-salud.md, «EPIs»): who receives
// it (what their position requires and they lack shows at once), the items with quantity and size, and
// their signature on the screen under the statement they accept. `?persona=` comes from their sheet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Banner, Card, CardTitle } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { safetyApi, safetyKeys, type SafetyItem } from "./safety-api";
import { useItemSource, usePeopleSource, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.newDelivery;

interface Line {
  key: number;
  itemId: string | null;
  label: string | undefined;
  quantity: string;
  size: string;
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(new Error("signature"));
    };
    reader.readAsDataURL(blob);
  });
}

export function NewDeliveryPage() {
  const { workspaceSlug = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const safety = useSafety();
  const peopleSource = usePeopleSource();
  const itemSource = useItemSource();
  const [person, setPerson] = useState<ComboOption | null>(null);
  const personId = person?.id ?? params.get("persona");
  const [lines, setLines] = useState<Line[]>([
    { key: 1, itemId: null, label: undefined, quantity: "1", size: "" },
  ]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const readSignature = useRef<() => Promise<Blob | null>>(() => Promise.resolve(null));
  const ppe = useQuery({
    queryKey: safetyKeys.person(workspaceSlug, personId ?? ""),
    queryFn: () => safetyApi.person(workspaceSlug, personId ?? ""),
    enabled: personId !== null,
  });
  const chosen = lines.flatMap((line) => (line.itemId === null ? [] : [line.itemId]));
  const items = useQuery({
    queryKey: [...safetyKeys.items(workspaceSlug), "chosen", chosen],
    queryFn: () => safetyApi.items(workspaceSlug, { ids: chosen, status: "all" }),
    enabled: chosen.length > 0,
  });
  const itemById = new Map<string, SafetyItem>((items.data?.items ?? []).map((i) => [i.id, i]));
  const personName = person?.label ?? ppe.data?.person.name;

  const save = useMutation({
    mutationFn: async () => {
      if (personId === null) throw new Error(t.needPerson);
      const filled = lines.filter((line) => line.itemId !== null);
      if (filled.length === 0) throw new Error(t.needLines);
      for (const line of filled) {
        const item = itemById.get(line.itemId ?? "");
        if (item?.hasSizes === true && line.size.trim() === "") {
          throw new Error(t.needSize(item.name));
        }
      }
      const blob = await readSignature.current();
      if (blob === null) throw new Error(t.needSignature);
      return await safetyApi.createDelivery(workspaceSlug, {
        membershipId: personId,
        lines: filled.map((line) => ({
          itemId: line.itemId ?? "",
          quantity: Math.max(1, Number.parseInt(line.quantity, 10) || 1),
          size: itemById.get(line.itemId ?? "")?.hasSizes === true ? line.size.trim() : null,
        })),
        note: note.trim() === "" ? null : note.trim(),
        signature: await dataUrlOf(blob),
      });
    },
    onSuccess: async ({ delivery }) => {
      toast.success(t.done);
      await queryClient.invalidateQueries({ queryKey: safetyKeys.all(workspaceSlug) });
      void navigate(`/app/${workspaceSlug}/seguridad/epis/${delivery.id}`);
    },
    onError: (failure) => {
      setError(failure instanceof ApiError ? adminErrorText(failure) : failure.message);
    },
  });

  const update = (key: number, change: Partial<Line>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <Link
        to={`/app/${workspaceSlug}/seguridad/epis`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {texts.safety.delivery.back}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title(safety.terms.ppes)}</h1>

      <Card className="grid gap-4 p-4 sm:p-5">
        <FormField label={t.person}>
          {(control) => (
            <Combobox
              id={control.id}
              label={t.person}
              placeholder={t.personPlaceholder}
              source={peopleSource}
              value={personId}
              valueLabel={personName}
              onChange={(option) => {
                setPerson(option);
              }}
            />
          )}
        </FormField>
        {ppe.data !== undefined && ppe.data.missing.length > 0 && (
          <Banner tone="warning">
            {t.missing} {ppe.data.missing.map((item) => item.name).join(", ")}
          </Banner>
        )}
      </Card>

      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle className="text-base">{t.lines}</CardTitle>
        {lines.map((line) => {
          const item = line.itemId === null ? undefined : itemById.get(line.itemId);
          return (
            <div
              key={line.key}
              className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_6rem_6rem_auto]"
            >
              <FormField label={t.item}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    label={t.item}
                    placeholder={t.itemPlaceholder}
                    source={itemSource}
                    value={line.itemId}
                    valueLabel={line.label}
                    onChange={(option) => {
                      update(line.key, { itemId: option?.id ?? null, label: option?.label });
                    }}
                  />
                )}
              </FormField>
              <FormField label={t.quantity}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    max={100}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) => {
                      update(line.key, { quantity: event.target.value });
                    }}
                  />
                )}
              </FormField>
              <FormField label={t.size}>
                {(control) => (
                  <Input
                    {...control}
                    value={line.size}
                    maxLength={20}
                    disabled={item?.hasSizes !== true}
                    onChange={(event) => {
                      update(line.key, { size: event.target.value });
                    }}
                  />
                )}
              </FormField>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.remove}
                disabled={lines.length === 1}
                onClick={() => {
                  setLines((current) => current.filter((other) => other.key !== line.key));
                }}
              >
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLines((current) => [
                ...current,
                {
                  key: Math.max(...current.map((line) => line.key)) + 1,
                  itemId: null,
                  label: undefined,
                  quantity: "1",
                  size: "",
                },
              ]);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t.addLine}
          </Button>
        </div>
        <FormField label={t.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </FormField>
      </Card>

      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle className="text-base">{t.signature}</CardTitle>
        <p className="text-sm text-muted-foreground">{t.statement}</p>
        <SignaturePad
          label={t.signature}
          signer={personName}
          register={(read) => {
            readSignature.current = read;
          }}
        />
      </Card>

      {error !== null && <Banner tone="warning">{error}</Banner>}
      <div className="flex justify-end">
        <Button
          disabled={save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          {save.isPending ? t.saving : t.save}
        </Button>
      </div>
    </div>
  );
}
