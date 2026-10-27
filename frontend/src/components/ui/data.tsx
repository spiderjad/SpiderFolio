// Tarjetas del dashboard (10.5): KPI y tarjeta de sección con estado vacío.
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Card, CardTitle, EmptyState, Eyebrow, IconTile, Skeleton } from "./display";

export function KpiCard({
  label,
  value,
  detail,
  icon,
  loading = false,
  to,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
  /** Si llega, el indicador es un enlace al listado correspondiente. */
  to?: string;
}) {
  // La etiqueta reserva dos líneas: los números quedan alineados aunque unas corten y otras no.
  const card = (
    <Card className="card-hover flex h-full flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow className="pt-1 sm:min-h-9">{label}</Eyebrow>
        {icon !== undefined && <IconTile icon={icon} size="sm" />}
      </div>
      {/* El Skeleton ocupa lo mismo que el número y el detalle: sin saltos al cargar. */}
      {loading ? (
        <Skeleton className="mt-2 h-10 w-24" />
      ) : (
        <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {detail !== undefined &&
        (loading ? (
          <Skeleton className="mt-2 h-4 w-32" />
        ) : (
          // mt-auto: el detalle va al pie, así las líneas de contexto quedan alineadas entre
          // tarjetas aunque una tenga barra y otra no.
          <div className="mt-auto pt-1 text-xs text-muted-foreground">{detail}</div>
        ))}
    </Card>
  );
  return to === undefined ? (
    card
  ) : (
    <Link
      to={to}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {card}
    </Link>
  );
}

/** Tarjeta con título y contenido; si está vacía, un estado vacío que explica qué va a haber. */
export function SectionCard({
  title,
  empty,
  emptyTitle,
  emptyIcon,
  emptyAction,
  loading = false,
  skeleton,
  children,
  className,
}: {
  title: string;
  empty?: string | undefined;
  emptyTitle?: string;
  emptyIcon: LucideIcon;
  emptyAction?: ReactNode;
  loading?: boolean;
  /** Forma de la carga; por defecto, un bloque de la altura de un gráfico. */
  skeleton?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("card-hover flex flex-col p-4 sm:p-5", className)}>
      <CardTitle className="text-base">{title}</CardTitle>
      <div className="mt-4 flex flex-1 flex-col justify-center">
        {loading ? (
          (skeleton ?? <Skeleton className="h-64 w-full" />)
        ) : empty !== undefined ? (
          <EmptyState
            icon={emptyIcon}
            action={emptyAction}
            {...(emptyTitle === undefined ? {} : { title: emptyTitle })}
          >
            {empty}
          </EmptyState>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/**
 * Barra de progreso (10.5). El tono lo decide quien la usa: los umbrales de aviso de los límites
 * salen del catálogo de planes (9A), no de este componente.
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = "primary",
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: "primary" | "warning" | "danger";
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-200 ease-out",
          { primary: "bg-primary", warning: "bg-warning", danger: "bg-danger" }[tone],
        )}
        style={{ width: `${String(ratio * 100)}%` }}
      />
    </div>
  );
}

/** Ids de los números que ya contaron en esta carga de la página: solo se animan la primera vez. */
const counted = new Set<string>();
const COUNT_MS = 300;

function shouldCount(id: string, value: number): boolean {
  return (
    value > 0 && !counted.has(id) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Número que cuenta hasta su valor (10.8): ≤ 300 ms, solo en la primera carga y sin animación con
 * prefers-reduced-motion (ahí el valor final está desde el primer render). La animación pasa por el
 * estado de React y termina siempre en el valor exacto.
 */
export function AnimatedNumber({ id, value }: { id: string; value: number }) {
  const [counting] = useState(() => shouldCount(id, value));
  const [shown, setShown] = useState(counting ? 0 : value);
  useEffect(() => {
    if (!counting) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / COUNT_MS, 1);
      setShown(t < 1 ? Math.round(value * (1 - (1 - t) ** 3)) : value);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        counted.add(id);
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setShown(value);
    };
  }, [id, value, counting]);
  return <span>{shown}</span>;
}
