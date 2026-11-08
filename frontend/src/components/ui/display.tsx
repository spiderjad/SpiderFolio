// Piezas de presentación: Card, Badge, Avatar, Skeleton, Banner, IconTile, EmptyState, Logo y
// Eyebrow.
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn, initials } from "@/lib/utils";
import { useAuthSurface } from "./surface";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("v-card", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold", className)} {...props} />;
}

/** spider-ui's status badges (v-badge); "solid" (the primary filled) and "warningSoft" have no
 * v-badge variant and stay on the preset's tokens. */
const badgeTone = {
  primary: "v-badge v-badge--brand",
  solid: "rounded-full px-2 py-0.5 text-[11px] font-medium bg-primary text-primary-foreground",
  success: "v-badge v-badge--success",
  warning: "v-badge v-badge--warning",
  /** A step below "warning" (e.g. a deputy head next to the head). */
  warningSoft: "v-badge border-warning-soft-foreground/20 bg-warning-soft/40 text-warning-soft-foreground",
  danger: "v-badge v-badge--danger",
  neutral: "v-badge",
} as const;

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTone | null | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        badgeTone[tone ?? "neutral"],
        className,
      )}
      {...props}
    />
  );
}

/** Avatar con iniciales sobre el color primario (10.4). */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  /** Foto de perfil: si falta o no carga, se ven las iniciales. */
  src?: string | null | undefined;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-medium text-primary-foreground",
        className,
      )}
    >
      {src != null && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden="true" className={cn("skeleton rounded-lg bg-muted", className)} {...props} />
  );
}

const bannerTone = { warning: "v-banner v-banner--warning", info: "v-banner v-banner--info" } as const;

/**
 * Banner (10.5): ícono, texto y acción a la derecha. "warning" (ámbar) para lo que pide
 * atención; "info" (violeta suave) para avisos que no son un problema, como la prueba.
 */
export function Banner({
  children,
  action,
  tone,
  icon: Icon = AlertTriangle,
}: {
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof bannerTone | null | undefined;
}) {
  const auth = useAuthSurface();
  const toneClass = auth
    ? (tone ?? "warning") === "warning"
      ? "auth-aviso-amarillo m-0"
      : "auth-banner auth-banner--info m-0"
    : bannerTone[tone ?? "warning"];
  return (
    <div role="status" className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", toneClass)}>
      <div className="flex flex-1 items-start gap-3 sm:items-center">
        <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <p className="flex-1 text-sm">{children}</p>
      </div>
      {action !== undefined && <div className="shrink-0 pl-8 sm:pl-0">{action}</div>}
    </div>
  );
}

const iconTileVariants = cva("flex shrink-0 items-center justify-center", {
  variants: {
    tone: {
      soft: "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/10",
      solid: "bg-primary text-primary-foreground shadow-card",
      danger: "bg-danger-soft text-danger-soft-foreground ring-1 ring-danger/15",
      warning: "bg-warning-soft text-warning-soft-foreground ring-1 ring-warning/20",
    },
    size: {
      sm: "size-9 rounded-lg [&_svg]:size-[18px]",
      md: "size-11 rounded-xl [&_svg]:size-5",
      lg: "size-12 rounded-xl [&_svg]:size-[22px]",
    },
  },
  defaultVariants: { tone: "soft", size: "md" },
});

/** Ícono dentro de un cuadrado redondeado, tintado o sólido (10.1). */
export function IconTile({
  icon: Icon,
  tone,
  size,
  className,
}: { icon: LucideIcon; className?: string } & VariantProps<typeof iconTileVariants>) {
  return (
    <span className={cn(iconTileVariants({ tone, size }), className)}>
      <Icon strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

/** Estado vacío: qué va a aparecer en este lugar y, si corresponde, qué hacer. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-6 text-center sm:px-6 sm:py-10",
        className,
      )}
    >
      <IconTile icon={icon} />
      {title !== undefined && <p className="mt-4 font-medium">{title}</p>}
      <p
        className={cn(
          "max-w-sm text-xs text-muted-foreground",
          title === undefined ? "mt-4" : "mt-1",
        )}
      >
        {children}
      </p>
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Marca: telaraña violeta (brand/logo-icon.svg) y el nombre. */
export function Logo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <svg viewBox="0 0 56 56" className="size-8 text-primary" aria-hidden="true">
        <path
          d="M28 28L28.00 1.00M28 28L47.09 8.91M28 28L55.00 28.00M28 28L47.09 47.09M28 28L28.00 55.00M28 28L8.91 47.09M28 28L1.00 28.00M28 28L8.91 8.91M28.00 20.00Q30.45 22.09 33.66 22.34Q33.91 25.55 36.00 28.00Q33.91 30.45 33.66 33.66Q30.45 33.91 28.00 36.00Q25.55 33.91 22.34 33.66Q22.09 30.45 20.00 28.00Q22.09 25.55 22.34 22.34Q25.55 22.09 28.00 20.00ZM28.00 11.50Q33.05 15.80 39.67 16.33Q40.20 22.95 44.50 28.00Q40.20 33.05 39.67 39.67Q33.05 40.20 28.00 44.50Q22.95 40.20 16.33 39.67Q15.80 33.05 11.50 28.00Q15.80 22.95 16.33 16.33Q22.95 15.80 28.00 11.50ZM28.00 3.00Q35.65 9.52 45.68 10.32Q46.48 20.35 53.00 28.00Q46.48 35.65 45.68 45.68Q35.65 46.48 28.00 53.00Q20.35 46.48 10.32 45.68Q9.52 35.65 3.00 28.00Q9.52 20.35 10.32 10.32Q20.35 9.52 28.00 3.00Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withName && <span className="text-lg tracking-tight">SpiderFolio</span>}
    </span>
  );
}

/** Etiqueta de grupo en mayúsculas espaciadas (10.3); con ícono, lo pone en un IconTile. */
export function Eyebrow({
  className,
  icon,
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { icon?: LucideIcon }) {
  const label = (
    <p
      className={cn(
        "text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground",
        icon === undefined && className,
      )}
      {...props}
    >
      {children}
    </p>
  );
  if (icon === undefined) return label;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <IconTile icon={icon} size="sm" />
      {label}
    </div>
  );
}
