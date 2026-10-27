// Lo que va encima del título de una página (estilo Notion): portada e ícono opcionales, con
// «Añadir ícono» y «Añadir portada» a la vista al pasar el mouse. La portada es un color
// predefinido; el ícono, un emoji. Cambiarlos pide editar la página (lo decide el servidor).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, SmilePlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi, filesKeys } from "@/features/files/api";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

export const COVERS = {
  violet: "linear-gradient(135deg, #c4b5fd, #6d28d9)",
  sky: "linear-gradient(135deg, #bae6fd, #0284c7)",
  emerald: "linear-gradient(135deg, #a7f3d0, #047857)",
  amber: "linear-gradient(135deg, #fde68a, #d97706)",
  rose: "linear-gradient(135deg, #fecdd3, #e11d48)",
  slate: "linear-gradient(135deg, #cbd5e1, #475569)",
  sunset: "linear-gradient(135deg, #fdba74, #db2777)",
  ocean: "linear-gradient(135deg, #67e8f9, #4f46e5)",
} as const;
export type CoverId = keyof typeof COVERS;

const coverIds = Object.keys(COVERS) as CoverId[];
export const isCover = (value: string | null): value is CoverId =>
  value !== null && value in COVERS;

const EMOJI = [
  "📄,📝,📋,📌,📎,📚,📖,📒,🗂️,📁,📊,📈,🧾,🧪,🔬,⚙️,🛠️,🔧,🔩,🏭,🚚,📦,🛒,💼,👥,🤝,💡,⭐",
  "✅,⚠️,🔒,🔑,🧭,🎯,🚀,🌱,♻️,🔥,💧,⚡,🧰,🧯,🦺,🧤,🥼,🍎,🥩,🥛,🧀,🍞,🥫,🧊,🌡️,🕒,📅,📣",
  "📢,🎓,🏷️,🧮,🖨️,💻,📱,🔔,❓,❗,🏠,🏢,🏗️,🚧,🛡️,🧹,🧼,🩺,💊,🧬,🌍,☀️,🌙,❤️,👍,🎉,🏆,📍",
]
  .join(",")
  .split(",");

function PickerDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={title}
        footer={
          <DialogClose asChild>
            <Button variant="outline">{texts.admin.common.cancel}</Button>
          </DialogClose>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function PageIdentity({
  slug,
  nodeId,
  icon: initialIcon,
  cover: initialCover,
  canEdit,
  children,
}: {
  slug: string;
  nodeId: string;
  icon: string | null;
  cover: string | null;
  canEdit: boolean;
  /** El título. */
  children: ReactNode;
}) {
  const t = texts.pages.chrome;
  const queryClient = useQueryClient();
  const [icon, setIcon] = useState(initialIcon);
  const [cover, setCover] = useState<string | null>(initialCover);
  const [picking, setPicking] = useState<"icon" | "cover" | null>(null);
  const save = useMutation({
    mutationFn: (body: { icon?: string | null; cover?: CoverId | null }) =>
      filesApi.updateNode(slug, nodeId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(slug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const chooseIcon = (next: string | null) => {
    setIcon(next);
    setPicking(null);
    save.mutate({ icon: next });
  };
  const chooseCover = (next: CoverId | null) => {
    setCover(next);
    setPicking(null);
    save.mutate({ cover: next });
  };
  const showCover = isCover(cover);
  return (
    <div className="group/title">
      {showCover && (
        <div
          className={cn(
            "relative -mx-4 h-40 rounded-xl sm:-mx-12 print:hidden",
            // Con ícono, este se monta sobre el borde inferior: no hace falta margen.
            icon === null && "mb-4",
          )}
          style={{ background: COVERS[cover] }}
        >
          {canEdit && (
            <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/title:opacity-100 focus-within:opacity-100">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPicking("cover");
                }}
              >
                {t.changeCover}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  chooseCover(null);
                }}
              >
                {t.removeCover}
              </Button>
            </div>
          )}
        </div>
      )}
      {icon !== null && (
        <button
          type="button"
          disabled={!canEdit}
          aria-label={t.changeIcon}
          onClick={() => {
            setPicking("icon");
          }}
          className={cn(
            // Por encima de la portada (que es `relative`); con portada, la mitad del ícono (36 px)
            // queda sobre su borde inferior y la otra mitad debajo, alineado con el título.
            "relative z-10 mb-4 flex size-[72px] items-center justify-start rounded-xl text-[64px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            showCover && "-mt-9",
            canEdit && "cursor-pointer hover:bg-muted/60",
          )}
        >
          {icon}
        </button>
      )}
      {canEdit && (icon === null || !showCover) && (
        <div className="mb-1 flex gap-1 text-sm opacity-0 transition-opacity group-hover/title:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 print:hidden">
          {icon === null && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setPicking("icon");
              }}
            >
              <SmilePlus strokeWidth={1.75} aria-hidden="true" />
              {t.addIcon}
            </Button>
          )}
          {!showCover && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setPicking("cover");
              }}
            >
              <ImagePlus strokeWidth={1.75} aria-hidden="true" />
              {t.addCover}
            </Button>
          )}
        </div>
      )}
      {children}

      <PickerDialog
        open={picking === "icon"}
        title={t.iconTitle}
        onClose={() => {
          setPicking(null);
        }}
      >
        <div className="grid gap-3">
          <div
            role="listbox"
            aria-label={t.iconTitle}
            className="grid grid-cols-7 gap-1 sm:grid-cols-9"
          >
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={emoji === icon}
                onClick={() => {
                  chooseIcon(emoji);
                }}
                className="grid h-10 place-items-center rounded-lg text-2xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-primary-soft"
              >
                {emoji}
              </button>
            ))}
          </div>
          {icon !== null && (
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => {
                chooseIcon(null);
              }}
            >
              <X strokeWidth={1.75} aria-hidden="true" />
              {t.removeIcon}
            </Button>
          )}
        </div>
      </PickerDialog>
      <PickerDialog
        open={picking === "cover"}
        title={t.coverTitle}
        onClose={() => {
          setPicking(null);
        }}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {coverIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={t.covers[id]}
              aria-pressed={cover === id}
              onClick={() => {
                chooseCover(id);
              }}
              style={{ background: COVERS[id] }}
              className="h-16 rounded-lg ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
            />
          ))}
        </div>
      </PickerDialog>
    </div>
  );
}
