// Editar a un miembro (9.3): rol, plaza, puesto y departamentos.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi, adminKeys, type MemberView, type RoleView, type SeatType } from "../api";
import { adminErrorText, limitReachedOf, type LimitReachedDetails } from "../admin-utils";
import { useCapabilities } from "../guards";
import { SEAT_AUTO, seatChoices } from "../choices";
import { LimitReachedDialog } from "../limit-dialog";
import { canAssignRole } from "../lookups";
import { useDepartmentSource, useRoleSource } from "../sources";
import { useMembership } from "@/features/home/workspace-layout";
import { leadershipReason } from "./role-badge";
import { texts } from "@/i18n";

export function EditMemberDialog({
  member,
  onClose,
}: {
  member: MemberView | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {member !== null && <EditForm key={member.id} member={member} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({ member, onClose }: { member: MemberView; onClose: () => void }) {
  const t = texts.admin.members.edit;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const capabilities = useCapabilities();
  const actor = { base: membership.role.base, capabilities };
  // Solo los roles que quien edita puede asignar (el actual siempre se muestra).
  const accept = useCallback(
    (role: RoleView) => role.id === member.roleId || canAssignRole(role, actor),
    // actor se arma con valores estables del workspace
    [member.roleId, membership.role.base, capabilities],
  );
  const roleSource = useRoleSource(workspaceSlug, { accept });
  const seatSource = useStaticSource("seat", seatChoices);
  const departmentSource = useDepartmentSource(workspaceSlug);

  const [roleId, setRoleId] = useState(member.roleId);
  const [roleBase, setRoleBase] = useState<string>(member.roleBase);
  const [seat, setSeat] = useState<"" | SeatType>("");
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  // El email solo se corrige mientras no esté confirmado (y quien entra con PIN no tiene).
  const emailLocked = member.kind === "PIN" || member.email === null || member.emailVerified;
  const [departmentIds, setDepartmentIds] = useState<string[]>(member.departments.map((d) => d.id));
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  const isGuest = roleBase === "GUEST";

  const mutation = useMutation({
    mutationFn: () => {
      const originalDepartments = member.departments.map((d) => d.id);
      const sameDepartments =
        departmentIds.length === originalDepartments.length &&
        originalDepartments.every((id) => departmentIds.includes(id));
      const title = jobTitle.trim() === "" ? null : jobTitle.trim();
      return adminApi.updateMember(workspaceSlug, member.id, {
        ...(roleId === member.roleId ? {} : { roleId }),
        ...(seat === "" ? {} : { seatType: seat }),
        ...(sameDepartments ? {} : { departmentIds: isGuest ? [] : departmentIds }),
        ...(title === member.jobTitle ? {} : { jobTitle: title }),
        ...(name.trim() === member.name ? {} : { name: name.trim() }),
        ...(emailLocked || email.trim() === (member.email ?? "") ? {} : { email: email.trim() }),
      });
    },
    onSuccess: async () => {
      toast.success(texts.admin.members.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      const reached = limitReachedOf(error);
      if (reached === null) toast.error(adminErrorText(error));
      else setLimit(reached);
    },
  });

  return (
    <>
      <DialogContent
        title={t.title(member.name)}
        description={member.email ?? texts.admin.members.noEmail}
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
                mutation.mutate();
              }}
            >
              {mutation.isPending ? texts.admin.common.saving : texts.admin.common.save}
            </Button>
          </>
        }
      >
        <FormGrid>
          <LeadershipNote member={member} />
          {capabilities.includes("permissions.audit") && (
            <Link
              to={`/app/${workspaceSlug}/admin/access?tab=person&id=${member.id}`}
              className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {t.canSee}
            </Link>
          )}
          <FormField label={t.name}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>
          {member.kind !== "PIN" && (
            <FormField label={t.email} hint={emailLocked ? t.emailLockedHint : t.emailHint}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="off"
                  disabled={emailLocked}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
              )}
            </FormField>
          )}
          <FormField label={t.role}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-invalid={control["aria-invalid"]}
                aria-describedby={control["aria-describedby"]}
                label={t.role}
                placeholder={t.rolePlaceholder}
                source={roleSource}
                value={roleId}
                valueLabel={member.roleId === roleId ? member.roleName : undefined}
                onChange={(option) => {
                  if (option === null) return;
                  setRoleId(option.id);
                  setRoleBase(option.meta?.base ?? roleBase);
                }}
              />
            )}
          </FormField>

          <FormField label={t.seat} hint={seat === "" ? t.seatAutoHint : t.seatHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
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

          <FormField label={t.jobTitle}>
            {(control) => (
              <Input
                {...control}
                value={jobTitle}
                maxLength={80}
                placeholder={t.jobTitlePlaceholder}
                onChange={(event) => {
                  setJobTitle(event.target.value);
                }}
              />
            )}
          </FormField>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t.departments}</legend>
            {isGuest ? (
              <p className="text-xs text-muted-foreground">{t.guestDepartments}</p>
            ) : (
              <Combobox
                multiple
                label={t.departments}
                placeholder={t.departmentsPlaceholder}
                source={departmentSource}
                values={departmentIds}
                valueLabels={new Map(member.departments.map((d) => [d.id, d.name]))}
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

/** La jefatura de la persona y por qué tiene (o no) capacidades de jefe. */
function LeadershipNote({ member }: { member: MemberView }) {
  const t = texts.admin.members.leadership;
  const reason = leadershipReason(member);
  if (reason === null) return null;
  return (
    <section
      aria-label={t.title}
      className="rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm"
    >
      <p className="font-medium">{reason}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t.scopeNote}</p>
    </section>
  );
}
