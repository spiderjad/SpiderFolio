// Árbol con líneas conectoras visibles (verticales y horizontales), para el organigrama y la
// pantalla de Departamentos. Cada TreeItem dibuja su tramo vertical y el codo horizontal hacia su
// fila; el último hijo corta la vertical en el codo. En móvil es la misma lista con sangría.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lista de hijos. `stub` es el tramo que la une con la fila de arriba. */
export function TreeList({
  className,
  children,
  label,
}: {
  className?: string | undefined;
  children: ReactNode;
  label?: string | undefined;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "relative m-0 list-none p-0 pt-3",
        "before:absolute before:left-0 before:top-0 before:h-3 before:w-px before:bg-border before:content-['']",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function TreeItem({
  last,
  compact,
  children,
}: {
  last: boolean;
  /** Fila baja (una sola línea): el codo queda más arriba. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative pb-3 pl-5 last:pb-0 sm:pl-7",
        "before:absolute before:left-0 before:top-0 before:w-px before:bg-border before:content-['']",
        last ? (compact ? "before:h-5" : "before:h-7") : "before:h-full",
        "after:absolute after:left-0 after:h-px after:w-4 after:bg-border after:content-[''] sm:after:w-6",
        compact ? "after:top-5" : "after:top-7",
      )}
    >
      {children}
    </li>
  );
}
