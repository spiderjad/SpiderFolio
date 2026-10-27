// Marca visual de un espacio: su emoji (o la carpeta) sobre un cuadrado teñido con su color. Sin color
// propio usa el de su departamento y, en un espacio de la empresa, el de marca.
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpaceView } from "./api";

type Colored = Pick<SpaceView, "color" | "icon"> & { department?: { color: string | null } | null };

/** El color que se ve: el propio, el del departamento o null (= el de marca). */
export function spaceColor(
  space: Pick<SpaceView, "color"> & Pick<Colored, "department">,
): string | null {
  return space.color ?? space.department?.color ?? null;
}

const sizes = {
  /** Favoritos del menú: marca de 16 px. */
  xs: "size-4 rounded text-[11px] [&_svg]:size-3",
  sm: "size-7 rounded-md text-sm [&_svg]:size-4",
  md: "size-8 rounded-lg text-base [&_svg]:size-4",
  lg: "size-9 rounded-lg text-lg [&_svg]:size-[18px]",
} as const;

export function SpaceMark({
  space,
  size = "md",
  className,
}: {
  space: Colored;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const color = spaceColor(space);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center leading-none",
        sizes[size],
        color === null && "bg-primary-soft text-primary-soft-foreground",
        className,
      )}
      style={color === null ? undefined : { backgroundColor: `${color}26`, color }}
    >
      {space.icon ?? <FolderOpen strokeWidth={1.75} />}
    </span>
  );
}
