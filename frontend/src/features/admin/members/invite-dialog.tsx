// Invitar personas (9.3): uno o varios emails, rol, plaza y departamentos. Las invitaciones
// pendientes ocupan plaza (se cuentan; sin límite).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { useMembership } from "@/features/home/workspace-layout";
import { adminApi, adminKeys, type RoleView, type SeatType } from "../api";
import {
  adminErrorText,
  limitReachedOf,
  validationIssues,
  type LimitReachedDetails,
} from "../admin-utils";
import { useCapabilities } from "../guards";
import { SEAT_AUTO, seatChoices } from "../choices";
import { LimitReachedDialog } from "../limit-dialog";
import { canAssignRole } from "../lookups";
import { useDepartmentSource, useRoleSource } from "../sources";
import { texts } from "@/i18n";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Emails de un texto libre: separados por saltos de línea, comas, punto y coma o espacios. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  const unique = [...new Set(parts)];
  return {
    valid: unique.filter((email) => EMAIL.test(email)),
    invalid: unique.filter((email) => !EMAIL.test(email)),
  };
}

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <InviteForm onClose={onClose} />}
    </Dialog>
  );
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const t = texts.admin.invitations.dialog;
  const seatHintId = useId();
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const capabilities = useCapabilities();
  const actor = { base: membership.role.base, capabilities };
  const accept = useCallback(
    (role: RoleView) => canAssignRole(role, actor),
    // actor se arma con valores estables del workspace
    [membership.role.base, capabilities],
  );
  const roleSource = useRoleSource(workspaceSlug, { accept });
  const seatSource = useStaticSource("seat", seatChoices);
  const departmentSource = useDepartmentSource(workspaceSlug);

  // El rol por defecto es el de miembro: entre los primeros de la lista (los de sistema van primero).
  const defaults = useQuery({
    queryKey: [...adminKeys.roles(workspaceSlug), "default"],
    queryFn: () => adminApi.roleOptions(workspaceSlug, { pageSize: 4 }),
    staleTime: 60_000,
  });
  const defaultRole = defaults.data?.items.find(
    (r) => r.base === "MEMBER" && r.isSystem && r.capabilities.length === 0,
  );
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ id: string; base: string } | null>(null);
  const [seat, setSeat] = useState<"" | SeatType>("");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  const effectiveRoleId = picked?.id ?? defaultRole?.id ?? "";
  const isGuest = (picked?.base ?? defaultRole?.base) === "GUEST";

  const mutation = useMutation({
    mutationFn: (emails: string[]) =>
      adminApi.invite(workspaceSlug, {
        emails,
        roleId: effectiveRoleId,
        ...(seat === "" ? {} : { seatType: seat }),
        departmentIds: isGuest ? [] : departmentIds,
      }),
    onSuccess: async (result) => {
      if (result.invitations.length > 0) toast.success(t.sent(result.invitations.length));
      if (result.skipped.length > 0) toast.info(t.skipped(result.skipped.length));
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      const reached = limitReachedOf(failure);
      if (reached !== null) setLimit(reached);
      else if (validationIssues(failure).some((issue) => issue.code === "domain_not_allowed")) {
        setError(t.domainNotAllowed);
      } else setError(adminErrorText(failure));
    },
  });

  const submit = () => {
    const { valid, invalid } = parseEmails(text);
    if (invalid.length > 0) {
      setError(t.invalidEmails(invalid));
      return;
    }
    if (valid.length === 0) {
      setError(t.noEmails);
      return;
    }
    setError(null);
    mutation.mutate(valid);
  };

  return (
    <>
      <DialogContent
        title={t.title}
        description={t.description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={mutation.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button disabled={mutation.isPending} onClick={submit}>
              {mutation.isPending ? t.submitting : t.submit}
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label={t.emails} hint={t.emailsHint} error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                value={text}
                rows={4}
                placeholder="ana@empresa.com, luis@empresa.com"
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormGrid columns={2}>
            <FormField label={t.role}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-invalid={control["aria-invalid"]}
                  aria-describedby={control["aria-describedby"]}
                  label={t.role}
                  placeholder={texts.admin.members.edit.rolePlaceholder}
                  source={roleSource}
                  value={effectiveRoleId === "" ? null : effectiveRoleId}
                  valueLabel={picked === null ? defaultRole?.name : undefined}
                  onChange={(option) => {
                    if (option !== null)
                      setPicked({ id: option.id, base: option.meta?.base ?? "" });
                  }}
                />
              )}
            </FormField>
            <FormField label={t.seat}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={seatHintId}
                  label={t.seat}
                  placeholder={t.seat}
                  searchable={false}
                  source={seatSource}
                  value={seat === "" ? SEAT_AUTO : seat}
                  onChange={(option) => {
                    if (option !== null)
                      setSeat(option.id === SEAT_AUTO ? "" : (option.id as SeatType));
                  }}
                />
              )}
            </FormField>
            <p id={seatHintId} className="text-xs text-muted-foreground sm:col-span-2">
              {seat === "" ? t.seatAutoHint : texts.admin.members.edit.seatHint}
            </p>
          </FormGrid>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t.departments}</legend>
            {isGuest ? (
              <p className="text-xs text-muted-foreground">
                {texts.admin.members.edit.guestDepartments}
              </p>
            ) : (
              <Combobox
                multiple
                label={t.departments}
                placeholder={texts.admin.members.edit.departmentsPlaceholder}
                source={departmentSource}
                values={departmentIds}
                onChange={setDepartmentIds}
              />
            )}
          </fieldset>
        </FormGrid>
      </DialogContent>
      <LimitReachedDialog
        limit={limit}
        onClose={() => {
          setLimit(null);
        }}
      />
    </>
  );
}
