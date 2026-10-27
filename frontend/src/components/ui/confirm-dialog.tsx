// Confirmación de acciones destructivas o delicadas, sobre AlertDialog de Radix. Toda acción
// destructiva de la interfaz pasa por aquí. Cancelar recibe el foco inicial; mientras la acción
// corre el botón muestra el progreso y el diálogo no se cierra; si falla, el error queda dentro.
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Loader2, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { errorText } from "@/lib/error-text";
import { Button } from "./button";
import { IconTile } from "./display";
import { Input, Label } from "./form";
import { texts } from "@/i18n";

const tones = {
  destructive: { tile: "danger", button: "destructive" },
  warning: { tile: "warning", button: "destructive" },
  primary: { tile: "soft", button: "primary" },
} as const;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  /** destructive: rojo suave; warning: ámbar; primary: acción no destructiva. */
  tone?: keyof typeof tones;
  title: string;
  /** La consecuencia real de la acción, en una línea. */
  description: ReactNode;
  /** Verbo concreto: «Quitar de IT», nunca «Aceptar». */
  confirmLabel: string;
  pendingLabel: string;
  /** Para lo irreversible o masivo: hay que escribir este texto para habilitar la acción. */
  requireText?: string;
  /** Si lanza, el error se muestra dentro del diálogo y este sigue abierto. */
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  icon,
  tone = "destructive",
  title,
  description,
  confirmLabel,
  pendingLabel,
  requireText,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const style = tones[tone];
  const needsText = requireText !== undefined && requireText !== "";
  const matches = !needsText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();

  const change = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setError(null);
      setTyped("");
    }
    onOpenChange(next);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={change}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="motion-fade fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px]" />
        <AlertDialogPrimitive.Content className="motion-pop fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-4 sm:p-5 shadow-pop focus:outline-none">
          <IconTile icon={icon} tone={style.tile} size="lg" />
          <AlertDialogPrimitive.Title className="mt-5 text-lg font-semibold tracking-tight">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </AlertDialogPrimitive.Description>
          {needsText && (
            <div className="mt-4 grid gap-1.5">
              <Label htmlFor={inputId}>{texts.common.typeToConfirm(requireText)}</Label>
              <Input
                id={inputId}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches && !pending) {
                    event.preventDefault();
                    void confirm();
                  }
                }}
              />
            </div>
          )}
          {error !== null && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground"
            >
              {error}
            </p>
          )}
          {/* En el DOM, Cancelar va primero: recibe el foco inicial y Enter no confirma solo. */}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {texts.common.cancel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={style.button}
              disabled={pending || !matches}
              aria-busy={pending}
              onClick={() => void confirm()}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
