// Picking a traced lot in another record (product on hold, complaint, recall test; docs/spec/calidad.md,
// «Fase 7»): the lot's code stays as text, and the link opens its trace. Only for whoever traces
// (quality.view); the rest just write the code.
import { useMemo } from "react";
import { useParams } from "react-router";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form";
import { lotsApi, type Lot } from "./lots-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const optionOf = (lot: Lot) => ({
  id: lot.id,
  label: `${lot.code} · ${texts.quality.trace.kinds[lot.kind]}${
    lot.product?.name !== undefined || lot.material !== null
      ? ` · ${lot.product?.name ?? lot.material ?? ""}`
      : ""
  }`,
});

export function useLotSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "lot-options"],
      search: async (q) => {
        const page = await lotsApi.search(workspaceSlug, q);
        return { items: page.items.map(optionOf), nextCursor: null };
      },
      byIds: async (ids) => {
        const page = await lotsApi.search(workspaceSlug, "", ids);
        return page.items.map(optionOf);
      },
    }),
    [workspaceSlug],
  );
}

/** «Lote de Trazabilidad»: picking one fills the code; null clears the link (the code stays). */
export function LotPicker({
  value,
  label,
  onChange,
}: {
  value: { id: string; code: string } | null;
  label?: string;
  onChange: (lot: { id: string; code: string } | null) => void;
}) {
  const { view } = useQuality();
  const source = useLotSource();
  if (!view) return null;
  const t = texts.quality.trace.picker;
  return (
    <FormField label={label ?? t.label} hint={t.hint}>
      {(control) => (
        <Combobox
          id={control.id}
          aria-describedby={control["aria-describedby"]}
          clearable
          label={label ?? t.label}
          placeholder={t.placeholder}
          source={source}
          value={value?.id ?? null}
          valueLabel={value?.code}
          onChange={(option) => {
            onChange(
              option === null ? null : { id: option.id, code: option.label.split(" · ")[0] ?? "" },
            );
          }}
        />
      )}
    </FormField>
  );
}
