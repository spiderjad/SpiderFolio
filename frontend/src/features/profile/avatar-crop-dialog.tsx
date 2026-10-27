// Recorte circular de la foto de perfil: se arrastra la imagen y se acerca con el control de zoom
// (también con las flechas del teclado). Todo con canvas y eventos de puntero, sin librerías. Al
// guardar, la imagen se recorta a 512 × 512 px y se codifica en WebP (sin metadatos).
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import {
  clampOffset,
  drawCropPreview,
  loadBitmap,
  renderAvatar,
  type CropView,
} from "@/lib/image-crop";
import { texts } from "@/i18n";

const FRAME = 288;
const MAX_ZOOM = 4;
const KEY_STEP = 12;

export function AvatarCropDialog({
  file,
  onClose,
  onConfirm,
}: {
  file: File | null;
  onClose: () => void;
  /** Sube la foto ya recortada; si falla, lanza el error y el diálogo sigue abierto. */
  onConfirm: (blob: Blob) => Promise<void>;
}) {
  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {file !== null && (
        <CropForm
          key={`${file.name}:${String(file.size)}`}
          file={file}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}

function CropForm({
  file,
  onClose,
  onConfirm,
}: {
  file: File;
  onClose: () => void;
  onConfirm: (blob: Blob) => Promise<void>;
}) {
  const t = texts.profile.crop;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<CropView>({ frame: FRAME, zoom: 1, offsetX: 0, offsetY: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadBitmap(file).then(
      (loaded) => {
        if (alive) setBitmap(loaded);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    if (canvas.current !== null && bitmap !== null) drawCropPreview(canvas.current, bitmap, view);
  }, [bitmap, view]);

  const move = (next: Partial<CropView>) => {
    if (bitmap === null) return;
    setView((current) => {
      const merged = { ...current, ...next };
      return { ...merged, ...clampOffset(bitmap, merged) };
    });
  };

  const save = async () => {
    if (bitmap === null) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(await renderAvatar(bitmap, view));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent
      title={t.title}
      description={t.hint}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={saving} className="relative z-10">
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            className="relative z-10"
            disabled={saving || bitmap === null}
            onClick={() => {
              void save();
            }}
          >
            {saving ? t.saving : t.save}
          </Button>
        </>
      }
    >
      <div className="grid justify-items-center gap-4">
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {t.unreadable}
          </p>
        ) : (
          <>
            <div
              role="application"
              aria-label={t.frame}
              tabIndex={0}
              style={{ width: FRAME, height: FRAME, touchAction: "none" }}
              className="relative cursor-grab overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                  x: event.clientX,
                  y: event.clientY,
                  offsetX: view.offsetX,
                  offsetY: view.offsetY,
                };
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (start === null) return;
                move({
                  offsetX: start.offsetX + event.clientX - start.x,
                  offsetY: start.offsetY + event.clientY - start.y,
                });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                const step: Record<string, [number, number]> = {
                  ArrowLeft: [KEY_STEP, 0],
                  ArrowRight: [-KEY_STEP, 0],
                  ArrowUp: [0, KEY_STEP],
                  ArrowDown: [0, -KEY_STEP],
                };
                const delta = step[event.key];
                if (delta === undefined) return;
                event.preventDefault();
                move({ offsetX: view.offsetX + delta[0], offsetY: view.offsetY + delta[1] });
              }}
            >
              <canvas
                ref={canvas}
                width={FRAME * 2}
                height={FRAME * 2}
                className="size-full select-none"
                aria-hidden="true"
              />
              {/* Máscara circular: lo que queda fuera del círculo se oscurece. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.55)]"
              />
            </div>
            <label className="flex w-full max-w-xs items-center gap-3 text-sm">
              <span className="shrink-0 text-muted-foreground">{t.zoom}</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                disabled={bitmap === null}
                onChange={(event) => {
                  move({ zoom: Number(event.target.value) });
                }}
                className="w-full accent-primary"
              />
            </label>
          </>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </DialogContent>
  );
}
