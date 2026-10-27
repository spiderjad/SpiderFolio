// Acciones masivas sobre la selección (9.3): cambiar rol, departamentos, suspender y reactivar.
// Cada persona pasa por las mismas reglas que la acción individual; el resultado es por persona.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { useCallback, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoToast } from "@/components/ui/undo-toast";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { useMembership } from "@/features/home/workspace-layout";
import { adminApi, adminKeys, type BulkAction, type RoleView, type SeatType } from "../api";
import { adminErrorText } from "../admin-utils";
import { useCan, useCapabilities } from "../guards";
import { canAssignRole } from "../lookups";
import { departmentModeChoices, seatOnlyChoices } from "../choices";
import { useDepartmentSource, useRoleSource } from "../sources";
import { texts } from "@/i18n";

type BulkDialog = "role" | "departments" | "seat" | null;

export function BulkBar({
  selectedIds,
  onDone,
}: {
  selectedIds: ReadonlySet<string>;
  onDone: () => void;
}) {
  const t = texts.admin.members;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const canManage = useCan("members.manage");
  const canSuspend = useCan("members.suspend");
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [suspending, setSuspending] = useState(false);

  const mutation = useMutation({
    mutationFn: (action: BulkAction) => adminApi.bulk(workspaceSlug, [...selectedIds], action),
    onSuccess: async (result) => {
      const message = t.bulk.result(result.succeeded, result.failed);
      if (result.failed === 0) toast.success(message);
      else toast.warning(message);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      setDialog(null);
      onDone();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
  // Suspender en bloque pasa por confirmación (con el error dentro del modal) y se puede deshacer
  // para las personas que sí se suspendieron.
  const suspendAll = async () => {
    const result = await adminApi.bulk(workspaceSlug, [...selectedIds], { type: "suspend" });
    await invalidate();
    onDone();
    const message = t.bulk.result(result.succeeded, result.failed);
    const suspended = result.results.flatMap((row) => (row.ok ? [row.id] : []));
    if (suspended.length === 0) {
      toast.warning(message);
      return;
    }
    undoToast(message, async () => {
      await adminApi.bulk(workspaceSlug, suspended, { type: "reactivate" });
      await invalidate();
    });
  };
  const confirmSuspend = t.bulk.confirmSuspend;

  return (
    <div
      role="region"
      aria-label={t.selected(selectedIds.size)}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/60 px-4 py-2"
    >
      <p className="mr-2 text-sm font-medium">{t.selected(selectedIds.size)}</p>
      {canManage && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog("role");
            }}
          >
            {t.bulk.changeRole}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog("seat");
            }}
          >
            {t.bulk.changeSeat}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDialog("departments");
            }}
          >
            {t.bulk.changeDepartments}
          </Button>
        </>
      )}
      {canSuspend && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => {
              setSuspending(true);
            }}
          >
            {t.bulk.suspend}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate({ type: "reactivate" });
            }}
          >
            {t.bulk.reactivate}
          </Button>
        </>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "role" && (
          <BulkRoleForm
            pending={mutation.isPending}
            onSubmit={(roleId) => {
              mutation.mutate({ type: "change_role", roleId });
            }}
          />
        )}
        {dialog === "seat" && (
          <BulkSeatForm
            pending={mutation.isPending}
            onSubmit={(seatType) => {
              mutation.mutate({ type: "change_seat", seatType });
            }}
          />
        )}
        {dialog === "departments" && (
          <BulkDepartmentsForm
            pending={mutation.isPending}
            onSubmit={(mode, departmentIds) => {
              mutation.mutate({ type: "change_departments", mode, departmentIds });
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={suspending}
        onOpenChange={setSuspending}
        icon={UserMinus}
        tone="warning"
        title={confirmSuspend.title(selectedIds.size)}
        description={confirmSuspend.text}
        confirmLabel={confirmSuspend.action(selectedIds.size)}
        pendingLabel={confirmSuspend.pending}
        requireText={confirmSuspend.word}
        onConfirm={suspendAll}
      />
    </div>
  );
}

function BulkRoleForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (roleId: string) => void;
}) {
  const t = texts.admin.members;
  const membership = useMembership();
  const capabilities = useCapabilities();
  const { workspaceSlug = "" } = useParams();
  const accept = useCallback(
    (role: RoleView) => canAssignRole(role, { base: membership.role.base, capabilities }),
    [membership.role.base, capabilities],
  );
  const source = useRoleSource(workspaceSlug, { accept });
  const [value, setValue] = useState("");
  return (
    <DialogContent
      title={t.bulk.changeRole}
      size="md"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={pending || value === ""}
            onClick={() => {
              onSubmit(value);
            }}
          >
            {t.bulk.apply}
          </Button>
        </>
      }
    >
      <FormField label={t.edit.role}>
        {(control) => (
          <Combobox
            id={control.id}
            aria-invalid={control["aria-invalid"]}
            aria-describedby={control["aria-describedby"]}
            label={t.edit.role}
            placeholder={t.edit.rolePlaceholder}
            source={source}
            value={value === "" ? null : value}
            onChange={(option) => {
              setValue(option?.id ?? "");
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

function BulkDepartmentsForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (mode: "add" | "remove" | "set", departmentIds: string[]) => void;
}) {
  const t = texts.admin.members;
  const { workspaceSlug = "" } = useParams();
  const source = useDepartmentSource(workspaceSlug);
  const modeSource = useStaticSource("department-mode", departmentModeChoices);
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [ids, setIds] = useState<string[]>([]);
  return (
    <DialogContent
      title={t.bulk.changeDepartments}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={pending || (mode !== "set" && ids.length === 0)}
            onClick={() => {
              onSubmit(mode, ids);
            }}
          >
            {t.bulk.apply}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.columns.departments}>
          {(control) => (
            <Combobox
              id={control.id}
              label={t.columns.departments}
              placeholder={t.columns.departments}
              searchable={false}
              source={modeSource}
              value={mode}
              onChange={(option) => {
                if (option !== null) setMode(option.id as "add" | "remove" | "set");
              }}
            />
          )}
        </FormField>
        <Combobox
          multiple
          label={t.columns.departments}
          placeholder={t.edit.departmentsPlaceholder}
          source={source}
          values={ids}
          onChange={setIds}
        />
      </FormGrid>
    </DialogContent>
  );
}

function BulkSeatForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (seatType: SeatType) => void;
}) {
  const t = texts.admin.members;
  const seatSource = useStaticSource("seat-only", seatOnlyChoices);
  const [seat, setSeat] = useState<SeatType>("READER");
  return (
    <DialogContent
      title={t.bulk.changeSeat}
      size="md"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={pending}
            onClick={() => {
              onSubmit(seat);
            }}
          >
            {t.bulk.apply}
          </Button>
        </>
      }
    >
      <FormField label={t.edit.seat} hint={t.edit.seatHint}>
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control["aria-describedby"]}
            label={t.edit.seat}
            placeholder={t.edit.seat}
            searchable={false}
            source={seatSource}
            value={seat}
            onChange={(option) => {
              if (option !== null) setSeat(option.id as SeatType);
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}
