// Barra de filtros común a todas las listas: buscador y selectores en la misma línea, todos de
// h-9, con la lupa centrada en el campo. Los selectores (Combobox con `compact`) muestran su
// etiqueta en una sola línea y, si no entra, la cortan con «…» y la completan en un tooltip.
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./form";

/** Ancho de un selector de filtro: completo en móvil, fijo en pantallas grandes. */
export const FILTER_SELECT_CLASS = "w-full sm:w-52";

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-48 flex-1 basis-56", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <Input
        type="search"
        className="h-9 pl-9"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
