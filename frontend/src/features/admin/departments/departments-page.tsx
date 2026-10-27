// Departamentos (CLAUDE.md, sección 9.3): formulario de departamento, colores y punto de color.
// La pantalla (árbol + detalle) vive en department-workspace.tsx.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi, adminKeys, type DepartmentView } from "../api";
import { useCan } from "../guards";
import { adminErrorText } from "../admin-utils";
import { useDepartmentSource, useMemberSource } from "../sources";
import { texts } from "@/i18n";

/** Colores sugeridos para los departamentos (datos del cliente: se guardan como #rrggbb). */
export const departmentColors = [
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#db2777",
  "#64748b",
] as const;

export function ColorDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-border"
      style={color === null ? undefined : { backgroundColor: color }}
    />
  );
}

export function DepartmentFormDialog({
  target,
  parent,
  onClose,
}: {
  target: DepartmentView | "new" | null;
  /** Al crear: el departamento en el que queda (una subárea). */
  parent?: { id: string; name: string } | undefined;
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
        <DepartmentForm
          key={target === "new" ? "new" : target.id}
          department={target === "new" ? null : target}
          parent={target === "new" ? parent : undefined}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function DepartmentForm({
  department,
  parent,
  onClose,
}: {
  department: DepartmentView | null;
  parent: { id: string; name: string } | undefined;
  onClose: () => void;
}) {
  const t = texts.admin.departments.form;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  // El padre y el jefe se buscan en el servidor. El jefe solo lo ve quien puede ver
  // miembros. Un departamento no puede ser su propio padre; los ciclos más largos los rechaza el
  // servidor.
  const canPickHead = useCan("members.view") || useCan("members.manage");
  const parentSource = useDepartmentSource(workspaceSlug, {
    exclude: department === null ? [] : [department.id],
  });
  const headSource = useMemberSource(workspaceSlug);

  const [name, setName] = useState(department?.name ?? "");
  const [description, setDescription] = useState(department?.description ?? "");
  const [color, setColor] = useState<string | null>(department?.color ?? null);
  const [parentId, setParentId] = useState(department?.parentId ?? parent?.id ?? "");
  const [parentLabel, setParentLabel] = useState(
    department?.parentName ?? parent?.name ?? undefined,
  );
  const [headId, setHeadId] = useState(department?.head?.membershipId ?? "");
  const [headLabel, setHeadLabel] = useState(department?.head?.name);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        color,
        parentId: parentId === "" ? null : parentId,
        ...(canPickHead ? { headId: headId === "" ? null : headId } : {}),
      };
      return department === null
        ? adminApi.createDepartment(workspaceSlug, body)
        : adminApi.updateDepartment(workspaceSlug, department.id, body);
    },
    onSuccess: async () => {
      toast.success(
        department === null
          ? texts.admin.departments.toasts.created
          : texts.admin.departments.toasts.updated,
      );
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });

  return (
    <DialogContent
      title={department === null ? t.createTitle : t.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={mutation.isPending || name.trim().length < 2}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending
              ? department === null
                ? texts.admin.common.creating
                : texts.admin.common.saving
              : department === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.name} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.description}>
          {(control) => (
            <Textarea
              {...control}
              value={description}
              rows={2}
              maxLength={200}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t.color}</legend>
          <div className="flex flex-wrap gap-2">
            {departmentColors.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={value}
                aria-pressed={color === value}
                onClick={() => {
                  setColor(color === value ? null : value);
                }}
                className="size-8 rounded-full border-2 border-transparent ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:border-foreground"
                style={{ backgroundColor: value }}
              />
            ))}
          </div>
        </fieldset>
        <FormField label={t.parent}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-invalid={control["aria-invalid"]}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={t.parent}
              placeholder={t.noParent}
              source={parentSource}
              value={parentId === "" ? null : parentId}
              valueLabel={parentLabel}
              onChange={(option) => {
                setParentId(option?.id ?? "");
                setParentLabel(option?.label);
              }}
            />
          )}
        </FormField>
        {canPickHead && (
          <FormField label={t.head}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-invalid={control["aria-invalid"]}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={t.head}
                placeholder={t.noHead}
                source={headSource}
                value={headId === "" ? null : headId}
                valueLabel={headLabel}
                onChange={(option) => {
                  setHeadId(option?.id ?? "");
                  setHeadLabel(option?.label);
                }}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </DialogContent>
  );
}
