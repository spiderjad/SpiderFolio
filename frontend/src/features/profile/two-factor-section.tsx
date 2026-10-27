// Mi perfil › Verificación en dos pasos: activar (QR, código y códigos de recuperación que se muestran
// una sola vez), generar códigos nuevos (pide confirmar el código si no se confirmó hace poco) y
// desactivar con contraseña y código. Lo hace cumplir el servidor.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/display";
import { FormField, Input, PasswordInput } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadTextFile } from "@/features/admin/admin-utils";
import { api, ApiError } from "@/lib/api";
import { formatShortDate } from "@/lib/utils";
import { texts } from "@/i18n";

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  recent: boolean;
  available: boolean;
}

const statusKey = ["profile", "2fa"] as const;

export function TwoFactorSection() {
  const t = texts.profile.twoFactor;
  const queryClient = useQueryClient();
  const { reloadAccount } = useAuth();
  const status = useQuery({ queryKey: statusKey, queryFn: () => api<MfaStatus>("/auth/2fa") });
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: statusKey });
    await reloadAccount();
  };
  const regenerate = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", { method: "POST" }),
    onSuccess: async (result) => {
      setCodes(result.recoveryCodes);
      toast.success(t.regenerated);
      await refresh();
    },
    onError: (error) => {
      // Sin confirmación reciente: se pide el código y se reintenta.
      if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
        setConfirming(true);
        return;
      }
      toast.error(adminErrorText(error));
    },
  });

  const data = status.data;
  return (
    <Card className="grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {t.title}
            {data !== undefined && data.available && (
              <Badge tone={data.enabled ? "primary" : undefined}>
                {data.enabled ? t.on : t.off}
              </Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
        </div>
      </div>
      {status.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : data === undefined || !data.available ? (
        <p className="text-xs text-muted-foreground">{t.unavailable}</p>
      ) : data.enabled ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {data.enabledAt !== null && `${t.since(formatShortDate(data.enabledAt))} `}
            {t.codesLeft(data.recoveryCodesLeft)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={regenerate.isPending}
              onClick={() => {
                regenerate.mutate();
              }}
            >
              {t.regenerate}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDisableOpen(true);
              }}
            >
              {t.disable}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            onClick={() => {
              setSetupOpen(true);
            }}
          >
            {t.enable}
          </Button>
        </div>
      )}

      {setupOpen && (
        <SetupDialog
          onClose={() => {
            setSetupOpen(false);
          }}
          onEnabled={async (recoveryCodes) => {
            setSetupOpen(false);
            setCodes(recoveryCodes);
            toast.success(t.enabled);
            await refresh();
          }}
        />
      )}
      {codes !== null && (
        <RecoveryCodesDialog
          codes={codes}
          onClose={() => {
            setCodes(null);
          }}
        />
      )}
      {confirming && (
        <ConfirmCodeDialog
          onClose={() => {
            setConfirming(false);
          }}
          onConfirmed={() => {
            setConfirming(false);
            regenerate.mutate();
          }}
        />
      )}
      {disableOpen && (
        <DisableDialog
          onClose={() => {
            setDisableOpen(false);
          }}
          onDisabled={async () => {
            setDisableOpen(false);
            toast.success(t.disabled);
            await refresh();
          }}
        />
      )}
    </Card>
  );
}

const codeInput = (value: string, onChange: (value: string) => void) =>
  function CodeInput(control: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) {
    return (
      <Input
        {...control}
        value={value}
        autoComplete="one-time-code"
        inputMode="text"
        maxLength={20}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  };

export function SetupDialog({
  onClose,
  onEnabled,
}: {
  onClose: () => void;
  onEnabled: (codes: string[]) => Promise<void>;
}) {
  const t = texts.profile.twoFactor.setup;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  // La clave manual queda oculta hasta pedirla. El diálogo se desmonta al cerrarse o cancelarse,
  // así que al volver a abrirlo arranca oculta otra vez.
  const [showKey, setShowKey] = useState(false);
  const setup = useQuery({
    queryKey: ["profile", "2fa", "setup"],
    queryFn: () =>
      api<{ secret: string; otpauthUri: string; qr: string }>("/auth/2fa/setup", {
        method: "POST",
      }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const enable = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>("/auth/2fa/enable", {
        method: "POST",
        body: { code: code.trim() },
      }),
    onSuccess: async (result) => {
      await onEnabled(result.recoveryCodes);
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    enable.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline">{t.cancel}</Button>
            </DialogClose>
            <Button
              type="submit"
              form="mfa-setup"
              disabled={setup.data === undefined || enable.isPending || code.trim().length < 6}
            >
              {enable.isPending ? t.confirming : t.confirm}
            </Button>
          </>
        }
      >
        <form id="mfa-setup" className="grid gap-4" onSubmit={submit}>
          <p className="text-sm">{t.scan}</p>
          {setup.isPending ? (
            <p className="text-xs text-muted-foreground">{t.loading}</p>
          ) : setup.isError ? (
            <p className="text-xs text-danger">{adminErrorText(setup.error)}</p>
          ) : (
            <div className="grid justify-items-center gap-2">
              <img
                src={setup.data.qr}
                alt={t.qrAlt}
                width={200}
                height={200}
                className="rounded-lg border border-border bg-white p-2"
              />
              {showKey ? (
                <div className="grid justify-items-center gap-2">
                  <p className="text-center text-xs text-muted-foreground">{t.manual}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <code className="select-all break-all rounded bg-muted px-2 py-1 text-xs tracking-wider">
                      {setup.data.secret.replace(/(.{4})/gu, "$1 ").trim()}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(setup.data.secret)
                          .then(() => toast.success(t.keyCopied));
                      }}
                    >
                      {t.copyKey}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setShowKey(true);
                  }}
                >
                  {t.showKey}
                </Button>
              )}
            </div>
          )}
          <FormField label={t.code} error={error}>
            {codeInput(code, setCode)}
          </FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const t = texts.profile.twoFactor.codes;
  const text = codes.join("\n");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.text}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => toast.success(t.copied));
              }}
            >
              {t.copy}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                downloadTextFile(t.fileName, `${text}\n`, "text/plain");
              }}
            >
              {t.download}
            </Button>
            <DialogClose asChild>
              <Button>{t.done}</Button>
            </DialogClose>
          </>
        }
      >
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((code) => (
            <li key={code} className="rounded bg-muted px-2 py-1 text-center tracking-wider">
              {code}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmCodeDialog({
  onClose,
  onConfirmed,
}: {
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const t = texts.profile.twoFactor.confirmCode;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const confirm = useMutation({
    mutationFn: () => api("/auth/2fa/confirm", { method: "POST", body: { code: code.trim() } }),
    onSuccess: onConfirmed,
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.text}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline">{t.cancel}</Button>
            </DialogClose>
            <Button
              type="submit"
              form="mfa-confirm"
              disabled={confirm.isPending || code.trim().length < 6}
            >
              {t.submit}
            </Button>
          </>
        }
      >
        <form
          id="mfa-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            confirm.mutate();
          }}
        >
          <FormField label={t.label} error={error}>
            {codeInput(code, setCode)}
          </FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({
  onClose,
  onDisabled,
}: {
  onClose: () => void;
  onDisabled: () => Promise<void>;
}) {
  const t = texts.profile.twoFactor.disableDialog;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const disable = useMutation({
    mutationFn: () =>
      api("/auth/2fa/disable", { method: "POST", body: { password, code: code.trim() } }),
    onSuccess: onDisabled,
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.text}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline">{t.cancel}</Button>
            </DialogClose>
            <Button
              type="submit"
              form="mfa-disable"
              variant="destructive"
              disabled={disable.isPending || password === "" || code.trim().length < 6}
            >
              {t.submit}
            </Button>
          </>
        }
      >
        <form
          id="mfa-disable"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            disable.mutate();
          }}
        >
          <FormField label={t.password}>
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.code} error={error}>
            {codeInput(code, setCode)}
          </FormField>
        </form>
      </DialogContent>
    </Dialog>
  );
}
