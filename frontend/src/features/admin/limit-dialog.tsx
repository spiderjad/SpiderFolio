// Diálogo de LIMIT_REACHED (9A.5): siempre el mismo, con cuánto se usa y qué hacer.
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/display";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import type { LimitReachedDetails } from "./admin-utils";
import { texts } from "@/i18n";

export function LimitReachedDialog({
  limit,
  onClose,
}: {
  limit: LimitReachedDetails | null;
  onClose: () => void;
}) {
  const t = texts.admin.limit;
  return (
    <Dialog
      open={limit !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {limit !== null && (
        <DialogContent
          title={t.title}
          description={t.used(limit.used, limit.max)}
          footer={
            <DialogClose asChild>
              <Button>{t.close}</Button>
            </DialogClose>
          }
        >
          <div className="flex items-start gap-4">
            <IconTile icon={Gauge} size="lg" />
            <div className="grid gap-2 text-sm">
              <p className="font-medium">{t.limits[limit.limit] ?? limit.limit}</p>
              <p className="text-muted-foreground">{t.help}</p>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
