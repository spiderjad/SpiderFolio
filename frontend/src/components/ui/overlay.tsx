// Primitivas Radix con el estilo del sistema: Tooltip, DropdownMenu, Sheet (panel lateral) y
// Dialog. La confirmación de acciones destructivas vive en confirm-dialog.tsx.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

export const TooltipProvider = TooltipPrimitive.Provider;

const CLOSE_TOOLTIPS_EVENT = "spiderfolio:close-tooltips";

/** Cierra todos los tooltips abiertos (ej. al contraer o expandir el menú lateral). */
export function closeAllTooltips(): void {
  window.dispatchEvent(new Event(CLOSE_TOOLTIPS_EVENT));
}

export function Tooltip({
  content,
  children,
  disabled = false,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  /** Sin globo (ej. el menú lateral expandido, donde el texto ya se ve). */
  disabled?: boolean;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const close = () => {
      setOpen(false);
    };
    window.addEventListener(CLOSE_TOOLTIPS_EVENT, close);
    return () => {
      window.removeEventListener(CLOSE_TOOLTIPS_EVENT, close);
    };
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <TooltipPrimitive.Root
      delayDuration={300}
      open={open && !disabled}
      onOpenChange={(next) => {
        if (!next) {
          setOpen(false);
          return;
        }
        // Solo con el puntero encima o con foco de teclado: el foco que queda en el botón después
        // de un clic (no es :focus-visible) no abre ni reabre el globo.
        const trigger = triggerRef.current;
        if (trigger !== null && (trigger.matches(":hover") || trigger.matches(":focus-visible"))) {
          setOpen(true);
        }
      }}
    >
      <TooltipPrimitive.Trigger asChild ref={triggerRef}>
        {children}
      </TooltipPrimitive.Trigger>
      {!disabled && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={8}
            className="motion-pop z-50 origin-[var(--radix-tooltip-content-transform-origin)] rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-pop"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        className={cn(
          "motion-pop z-50 min-w-44 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl border border-border bg-background p-1 shadow-pop",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-sm outline-none data-[highlighted]:bg-muted [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) => (
  <DropdownPrimitive.Label
    className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
    {...props}
  />
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

export function SheetContent({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="motion-fade fixed inset-0 z-40 bg-foreground/30" />
      <DialogPrimitive.Content
        className={cn(
          "motion-slide fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col bg-background shadow-pop",
          className,
        )}
        // El foco inicial va al botón Cerrar: si cae en el primer botón del contenido, abre su
        // tooltip sin que nadie lo pida.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeRef.current?.focus();
        }}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label={texts.common.close}
        >
          <X className="size-4" strokeWidth={1.75} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const SheetClose = DialogPrimitive.Close;

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const dialogSizes = { md: "max-w-[480px]", lg: "max-w-[640px]", xl: "max-w-[920px]" } as const;

/**
 * Diálogo centrado para formularios y detalles. El título y la descripción son obligatorios
 * para lectores de pantalla; el pie lleva los botones.
 */
export function DialogContent({
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof dialogSizes;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="motion-fade fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "motion-pop fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-background shadow-pop focus:outline-none",
          dialogSizes[size],
          className,
        )}
        {...(description === undefined ? { "aria-describedby": undefined } : {})}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description !== undefined && (
              <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mr-2 -mt-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={texts.common.close}
          >
            <X className="size-4" strokeWidth={1.75} />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer !== undefined && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
