// Aviso de acción reversible con «Deshacer» durante unos segundos.
import { toast } from "sonner";
import { errorText } from "@/lib/error-text";
import { texts } from "@/i18n";

const UNDO_MS = 8000;

export function undoToast(message: string, undo: () => Promise<void>) {
  toast.success(message, {
    duration: UNDO_MS,
    action: {
      label: texts.common.undo,
      onClick: () => {
        undo()
          .then(() => {
            toast.success(texts.common.undone);
          })
          .catch((error: unknown) => {
            toast.error(errorText(error));
          });
      },
    },
  });
}
