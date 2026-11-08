// Form fields on spider-ui's panel (v-input, v-label, v-help, v-error): Input, Label, FormField (with an
// accessible error) and PasswordInput. The spacing comes from FormField's grid, so the margins spider-ui
// gives labels and messages are reset here.
import * as LabelPrimitive from "@radix-ui/react-label";
import { Eye, EyeOff } from "lucide-react";
import {
  forwardRef,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { useAuthSurface } from "./surface";
import { texts } from "@/i18n";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const auth = useAuthSurface();
    return (
      <input
        ref={ref}
        className={cn(auth ? "auth-input" : "v-input h-9 py-0", className)}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export function Label({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  const auth = useAuthSurface();
  return (
    <LabelPrimitive.Root
      className={cn(auth ? "auth-label mb-0" : "v-label mb-0", className)}
      {...props}
    />
  );
}

export interface FieldControlProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

interface FormFieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  /** El control recibe id y atributos ARIA para vincularlo con el label y el error. */
  children: (control: FieldControlProps) => ReactElement;
  className?: string;
}

export function FormField({ label, error, hint, children, className }: FormFieldProps) {
  const id = useId();
  const messageId = `${id}-mensaje`;
  const message = error ?? hint;
  const auth = useAuthSurface();
  const messageClass =
    error !== undefined
      ? auth
        ? "auth-error"
        : "v-error"
      : auth
        ? "text-[13px] text-[var(--auth-muted)]"
        : "v-help";
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": message === undefined ? undefined : messageId,
      })}
      {message !== undefined && (
        <p
          id={messageId}
          className={cn("mt-0", messageClass)}
          {...(error === undefined ? {} : { role: "alert" })}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const auth = useAuthSurface();
    const label = visible ? texts.common.hidePassword : texts.common.showPassword;
    return (
      <div className={auth ? "auth-input-wrap" : "relative"}>
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(!auth && "pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => {
            setVisible((v) => !v);
          }}
          aria-label={label}
          title={label}
          className={
            auth
              ? "auth-eye"
              : "absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          }
        >
          {visible ? (
            <EyeOff className="size-4" strokeWidth={1.75} />
          ) : (
            <Eye className="size-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("v-input min-h-24", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** Casilla con su texto: toda la fila es clicable. */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: ReactNode }
>(({ className, label, ...props }, ref) => {
  const auth = useAuthSurface();
  const box = (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
  if (label === undefined) return box;
  return (
    <label
      className={
        auth
          ? "auth-check"
          : "flex cursor-pointer items-center gap-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
      }
    >
      {box}
      <span>{label}</span>
    </label>
  );
});
Checkbox.displayName = "Checkbox";

/** Interruptor (role="switch"). */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-background shadow-card transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/**
 * Grilla de formulario: campos con etiqueta arriba, alineados al tope (`items-start`) para que los
 * controles queden a la misma altura aunque uno tenga texto de ayuda o de error. 1 columna, 2 o 3
 * (3 solo para filas cortas como servidor, puerto y seguridad); en móvil siempre es 1.
 */
export function FormGrid({
  columns = 1,
  className,
  children,
}: {
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "md:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
