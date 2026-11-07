// A form's quality settings (docs/spec/calidad.md, «Apertura automática»): whether a non-conforming record
// opens a nonconformity by itself, its severity and who handles it. Shown in the form's settings while the
// module is on; whoever can edit the form changes them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Card, CardTitle } from "@/components/ui/display";
import { FormField, Switch } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import {
  SEVERITIES,
  qualityApi,
  qualityKeys,
  type FormQuality,
  type Severity,
} from "./quality-api";
import { usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.formSettings;

function Editor({
  formId,
  saved,
  canEdit,
}: {
  formId: string;
  saved: FormQuality;
  canEdit: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const severities = useStaticSource(
    "quality-form-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const [autoNc, setAutoNc] = useState(saved.autoNc);
  const [severity, setSeverity] = useState<Severity>(saved.severity ?? "MAJOR");
  const [owner, setOwner] = useState(saved.owner);
  const save = useMutation({
    mutationFn: () =>
      qualityApi.saveForm(workspaceSlug, formId, {
        autoNc,
        severity,
        ownerId: owner?.id ?? null,
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.form(workspaceSlug, formId) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const changed =
    autoNc !== saved.autoNc ||
    severity !== (saved.severity ?? "MAJOR") ||
    (owner?.id ?? null) !== (saved.owner?.id ?? null);
  return (
    <div className="grid gap-4">
      <label className="flex items-start justify-between gap-4 text-sm">
        <span>{t.autoNc}</span>
        <Switch
          checked={autoNc}
          disabled={!canEdit}
          aria-label={t.autoNc}
          onCheckedChange={setAutoNc}
        />
      </label>
      {autoNc && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t.severity}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                disabled={!canEdit}
                label={t.severity}
                placeholder={t.severity}
                source={severities}
                value={severity}
                onChange={(option) => {
                  const next = SEVERITIES.find((id) => id === option?.id);
                  if (next !== undefined) setSeverity(next);
                }}
              />
            )}
          </FormField>
          <FormField label={t.owner}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                disabled={!canEdit}
                label={t.owner}
                placeholder={t.ownerPlaceholder}
                source={people}
                value={owner?.id ?? null}
                valueLabel={owner?.name}
                onChange={(option) => {
                  setOwner(option === null ? null : { id: option.id, name: option.label });
                }}
              />
            )}
          </FormField>
        </div>
      )}
      {canEdit && (
        <Button
          className="justify-self-start"
          disabled={!changed || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
        </Button>
      )}
    </div>
  );
}

export function FormQualityCard({ formId, canEdit }: { formId: string; canEdit: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const membership = useMembership();
  const on = membership.workspace.quality.enabled && membership.role.base !== "GUEST";
  const query = useQuery({
    queryKey: qualityKeys.form(workspaceSlug, formId),
    queryFn: () => qualityApi.form(workspaceSlug, formId),
    select: (data) => data.settings,
    enabled: on,
  });
  if (!on || query.data === undefined) return null;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          {t.title}
        </CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
      </div>
      <Editor
        key={`${String(query.data.autoNc)}-${query.data.severity ?? ""}-${query.data.owner?.id ?? ""}`}
        formId={formId}
        saved={query.data}
        canEdit={canEdit}
      />
    </Card>
  );
}
