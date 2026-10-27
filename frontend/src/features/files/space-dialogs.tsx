// Diálogos de espacios: crear y editar. Compartir (quién tiene acceso) está en features/sharing.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COMBO_PAGE_SIZE,
  Combobox,
  useStaticSource,
  type ComboboxSource,
  type ComboOption,
} from "@/components/ui/combobox";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { departmentColors } from "@/features/admin/departments/departments-page";
import { filesApi, filesKeys, type SpaceView } from "./api";
import { texts } from "@/i18n";

// ─── Crear y editar ──────────────────────────────────────────────────────────────────────

/** Qué se abre: un espacio nuevo (con departamento ya elegido o no) o uno existente a editar. */
type Visibility = "NORMAL" | "PRIVATE" | "CONFIDENTIAL";
const VISIBILITIES: readonly Visibility[] = ["NORMAL", "PRIVATE", "CONFIDENTIAL"];

function visibilityOf(space: Pick<SpaceView, "isPrivate" | "isConfidential">): Visibility {
  if (space.isConfidential) return "CONFIDENTIAL";
  return space.isPrivate ? "PRIVATE" : "NORMAL";
}

export type SpaceTarget = SpaceView | "new" | { department: { id: string; name: string } };

const targetKey = (target: SpaceTarget): string =>
  target === "new" ? "new" : "id" in target ? target.id : `dept:${target.department.id}`;

/** Departamentos donde la persona puede crear un espacio (todos, o los que lidera). */
export function useSpaceDepartmentSource(slug: string): ComboboxSource {
  return useMemo(
    () => ({
      key: filesKeys.departmentChoices(slug),
      search: async (q, cursor, signal) => {
        const result = await filesApi.spaceDepartmentChoices(
          slug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: result.items.map((d): ComboOption => ({ id: d.id, label: d.name })),
          nextCursor: result.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [slug],
  );
}

export function SpaceFormDialog({
  target,
  onClose,
}: {
  target: SpaceTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && (
        <SpaceForm
          key={targetKey(target)}
          space={target === "new" || !("id" in target) ? null : target}
          department={
            target !== "new" && "department" in target && !("id" in target)
              ? target.department
              : null
          }
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function SpaceForm({
  space,
  department,
  onClose,
}: {
  space: SpaceView | null;
  department: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = texts.files.spaces;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState(space?.name ?? "");
  const [description, setDescription] = useState(space?.description ?? "");
  const [icon, setIcon] = useState(space?.icon ?? "");
  const [color, setColor] = useState<string | null>(space?.color ?? null);
  const [visibility, setVisibility] = useState<Visibility>(
    space === null ? "NORMAL" : visibilityOf(space),
  );
  const [includeSubareas, setIncludeSubareas] = useState(space?.includeSubareas ?? false);
  const [error, setError] = useState<string | null>(null);
  // Quien tiene spaces.create elige cualquier departamento (o ninguno); un jefe, solo los suyos y
  // siempre uno. El servidor lo vuelve a validar.
  const canPickAny = useMembership().capabilities.includes("spaces.create");
  const departmentSource = useSpaceDepartmentSource(workspaceSlug);
  const levelSource = useStaticSource(
    "space-department-level",
    (["EDIT", "VIEW"] as const).map((id) => ({ id, label: t.form.departmentLevels[id] })),
  );
  const visibilitySource = useStaticSource(
    "space-visibility",
    VISIBILITIES.map((id) => ({ id, label: t.form.visibilities[id] })),
  );
  const currentDepartment = space?.department ?? department;
  const [departmentId, setDepartmentId] = useState(currentDepartment?.id ?? "");
  const [departmentLabel, setDepartmentLabel] = useState(currentDepartment?.name);
  const [departmentLevel, setDepartmentLevel] = useState<"EDIT" | "VIEW">(
    space?.departmentLevel ?? "EDIT",
  );
  // Quien no puede crear espacios de la empresa (un jefe) siempre deja un departamento suyo.
  const needsDepartment = !canPickAny && departmentId === "";
  // «Incluir subáreas» solo existe en un espacio de departamento.
  const hasDepartment = departmentId !== "";
  const flags = {
    isPrivate: visibility !== "NORMAL",
    isConfidential: visibility === "CONFIDENTIAL",
  };

  const save = useMutation({
    mutationFn: () => {
      const trimmed = description.trim();
      return space === null
        ? filesApi.createSpace(workspaceSlug, {
            name: name.trim(),
            ...flags,
            ...(icon.trim() === "" ? {} : { icon: icon.trim() }),
            ...(color === null ? {} : { color }),
            ...(trimmed === "" ? {} : { description: trimmed }),
            ...(departmentId === "" ? {} : { departmentId, departmentLevel, includeSubareas }),
          })
        : filesApi.updateSpace(workspaceSlug, space.id, {
            name: name.trim(),
            ...flags,
            icon: icon.trim() === "" ? null : icon.trim(),
            color,
            // Cambiar de departamento recalcula el acceso solo (se calcula en cada pedido).
            ...(departmentId === (space.department?.id ?? "")
              ? {}
              : { departmentId: departmentId === "" ? null : departmentId }),
            ...(hasDepartment ? { departmentLevel, includeSubareas } : {}),
            description: trimmed === "" ? null : trimmed,
          });
    },
    onSuccess: async () => {
      toast.success(space === null ? t.toasts.created : t.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });

  return (
    <DialogContent
      title={space === null ? t.form.createTitle : t.form.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending || name.trim().length < 1 || needsDepartment}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? space === null
                ? texts.admin.common.creating
                : texts.admin.common.saving
              : space === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.name} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={255}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.description}>
          {(control) => (
            <Textarea
              {...control}
              value={description}
              rows={2}
              maxLength={300}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="grid grid-cols-[7rem_1fr] items-start gap-4">
          <FormField label={t.form.icon}>
            {(control) => (
              <Input
                {...control}
                value={icon}
                maxLength={16}
                className="text-center text-lg"
                onChange={(event) => {
                  setIcon(event.target.value);
                }}
              />
            )}
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t.form.color}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={color === null}
                onClick={() => {
                  setColor(null);
                }}
                className="h-8 rounded-full border-2 border-border px-3 text-xs text-muted-foreground aria-pressed:border-foreground aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {t.form.colorDefault}
              </button>
              {departmentColors.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={value}
                  aria-pressed={color === value}
                  onClick={() => {
                    setColor(value);
                  }}
                  className="size-8 rounded-full border-2 border-transparent ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:border-foreground"
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{t.form.colorHint}</p>
          </fieldset>
        </div>
        {
          <>
            <FormField
              label={t.form.department}
              hint={needsDepartment ? t.form.departmentRequired : t.form.departmentHint}
            >
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable={canPickAny}
                  label={t.form.department}
                  placeholder={canPickAny ? t.form.departmentNone : t.form.departmentRequired}
                  source={departmentSource}
                  value={departmentId === "" ? null : departmentId}
                  valueLabel={departmentLabel}
                  onChange={(option) => {
                    setDepartmentId(option?.id ?? "");
                    setDepartmentLabel(option?.label);
                  }}
                />
              )}
            </FormField>
            {departmentId !== "" && (
              <FormField label={t.form.departmentLevel}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    searchable={false}
                    label={t.form.departmentLevel}
                    placeholder={t.form.departmentLevel}
                    source={levelSource}
                    value={departmentLevel}
                    onChange={(option) => {
                      if (option !== null) setDepartmentLevel(option.id as "EDIT" | "VIEW");
                    }}
                  />
                )}
              </FormField>
            )}
          </>
        }
        {hasDepartment && (
          <div className="grid gap-1">
            <Checkbox
              checked={includeSubareas}
              label={t.form.includeSubareas}
              onChange={(event) => {
                setIncludeSubareas(event.target.checked);
              }}
            />
            <p className="pl-6 text-xs text-muted-foreground">{t.form.includeSubareasHint}</p>
          </div>
        )}
        <FormField label={t.form.visibility} hint={t.form.visibilityHints[visibility]}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={t.form.visibility}
              placeholder={t.form.visibility}
              source={visibilitySource}
              value={visibility}
              onChange={(option) => {
                if (option !== null) setVisibility(option.id as Visibility);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
