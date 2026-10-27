// Personas que entran con usuario + PIN (CLAUDE.md, sección 7.6): crear, resetear y ver el PIN.
// El PIN en claro se muestra una sola vez (después no se puede consultar) y se copia con un clic.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi, adminKeys, type MemberView, type RoleView } from "../api";
import { adminErrorText, limitReachedOf, type LimitReachedDetails } from "../admin-utils";
import { LimitReachedDialog } from "../limit-dialog";
import { useDepartmentSource, useRoleSource } from "../sources";
import { texts } from "@/i18n";

export interface RevealedPin {
  name: string;
  loginName: string;
  pin: string;
}

/** Muestra el PIN una sola vez, en grande, con copiar. */
export function PinRevealDialog({
  revealed,
  onClose,
}: {
  revealed: RevealedPin | null;
  onClose: () => void;
}) {
  const t = texts.admin.pin.reveal;
  return (
    <Dialog
      open={revealed !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {revealed !== null && (
        <DialogContent
          title={t.title(revealed.name)}
          description={t.description}
          footer={
            <DialogClose asChild>
              <Button>{t.done}</Button>
            </DialogClose>
          }
        >
          <dl className="grid gap-4">
            <div>
              <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {t.loginName}
              </dt>
              <dd className="mt-1 font-mono text-lg">{revealed.loginName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t.pin}</dt>
              <dd className="mt-1 flex items-center gap-3">
                <span
                  data-testid="revealed-pin"
                  className="font-mono text-4xl font-semibold tracking-[0.3em]"
                >
                  {revealed.pin}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(revealed.pin)
                      .then(() => {
                        toast.success(t.copied);
                      })
                      .catch(() => {
                        toast.error(t.copyFailed);
                      });
                  }}
                >
                  <Copy strokeWidth={1.75} aria-hidden="true" />
                  {t.copy}
                </Button>
              </dd>
            </div>
          </dl>
          <p className="mt-5 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
            {t.once}
          </p>
        </DialogContent>
      )}
    </Dialog>
  );
}

// ─── Crear ───────────────────────────────────────────────────────────────────────────────

export function CreatePinMemberDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (revealed: RevealedPin) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <CreateForm onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (revealed: RevealedPin) => void;
}) {
  const t = texts.admin.pin.create;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  // Una persona con PIN es lectora y no administra: solo roles de miembro sin capacidades.
  const accept = useCallback(
    (role: RoleView) => role.base === "MEMBER" && role.capabilities.length === 0,
    [],
  );
  const roleSource = useRoleSource(workspaceSlug, { accept });
  const departmentSource = useDepartmentSource(workspaceSlug);

  const [name, setName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.createPinMember(workspaceSlug, {
        name: name.trim(),
        loginName: loginName.trim(),
        roleId,
        departmentIds,
        ...(pin === "" ? {} : { pin }),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
      onCreated({
        name: result.member.name,
        loginName: result.member.loginName ?? loginName.trim(),
        pin: result.pin,
      });
    },
    onError: (failure) => {
      const reached = limitReachedOf(failure);
      if (reached !== null) setLimit(reached);
      else setError(adminErrorText(failure));
    },
  });

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
            <Button
              disabled={
                mutation.isPending ||
                name.trim().length < 2 ||
                loginName.trim() === "" ||
                roleId === ""
              }
              onClick={() => {
                setError(null);
                mutation.mutate();
              }}
            >
              {mutation.isPending ? t.submitting : t.submit}
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
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.loginName} hint={t.loginNameHint}>
            {(control) => (
              <Input
                {...control}
                value={loginName}
                maxLength={32}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => {
                  setLoginName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.role} hint={t.roleHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-invalid={control["aria-invalid"]}
                aria-describedby={control["aria-describedby"]}
                label={t.role}
                placeholder={texts.admin.members.edit.rolePlaceholder}
                source={roleSource}
                value={roleId === "" ? null : roleId}
                onChange={(option) => {
                  setRoleId(option?.id ?? "");
                }}
              />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t.departments}</legend>
            <Combobox
              multiple
              label={t.departments}
              placeholder={texts.admin.members.edit.departmentsPlaceholder}
              source={departmentSource}
              values={departmentIds}
              onChange={setDepartmentIds}
            />
          </fieldset>
          <FormField label={t.pin} hint={t.pinHint}>
            {(control) => (
              <Input
                {...control}
                value={pin}
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                placeholder={t.pinPlaceholder}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, ""));
                }}
              />
            )}
          </FormField>
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

// ─── Resetear ────────────────────────────────────────────────────────────────────────────

/** Confirma y genera un PIN nuevo (desbloquea la cuenta y cierra sus sesiones). */
export function ResetPinDialog({
  member,
  onClose,
  onReset,
}: {
  member: MemberView | null;
  onClose: () => void;
  onReset: (revealed: RevealedPin) => void;
}) {
  const t = texts.admin.pin.reset;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const target = useMemo(() => member, [member]);
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      icon={KeyRound}
      title={t.title}
      description={target === null ? "" : t.text(target.name)}
      confirmLabel={t.action}
      pendingLabel={t.pending}
      tone="primary"
      onConfirm={async () => {
        if (target === null) return;
        const result = await adminApi.resetPin(workspaceSlug, target.id);
        await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
        onReset({ name: target.name, loginName: result.loginName, pin: result.pin });
      }}
    />
  );
}
