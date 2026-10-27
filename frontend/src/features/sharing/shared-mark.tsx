// Ícono «compartido» de un elemento o espacio con accesos dados; el tooltip dice con quién y hasta
// cuándo. Solo llega para quien puede gestionarlo.
import { Share2 } from "lucide-react";
import { Tooltip } from "@/components/ui/overlay";
import { cn, formatShortDate } from "@/lib/utils";
import { texts } from "@/i18n";

export interface SharingSummary {
  count: number;
  names: string[];
  expiresAt: string | null;
}

/** «Compartido con Finanzas y 2 más · vence 23/10». */
export function sharingText(sharing: SharingSummary): string {
  const t = texts.sharing.mark;
  const extra = sharing.count - sharing.names.length;
  const who = t.with(sharing.names, extra);
  return sharing.expiresAt === null
    ? who
    : `${who} · ${t.expires(formatShortDate(sharing.expiresAt))}`;
}

export function SharedMark({
  sharing,
  className,
}: {
  sharing: SharingSummary | null | undefined;
  className?: string;
}) {
  if (sharing === null || sharing === undefined) return null;
  const text = sharingText(sharing);
  return (
    <Tooltip content={text}>
      <span
        role="img"
        aria-label={text}
        className={cn("inline-flex shrink-0 items-center text-muted-foreground", className)}
      >
        <Share2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
