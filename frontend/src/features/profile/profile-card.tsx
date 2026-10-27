// Tarjeta de resumen de «Mi perfil»: portada arriba (se arrastra verticalmente para elegir el
// encuadre), foto de perfil encima, y debajo nombre, puesto, email, rol y departamentos.
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import type { Account, Membership } from "@/auth/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, Badge, Card } from "@/components/ui/display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { loadBitmap, renderCover } from "@/lib/image-crop";
import { removeProfileImage, saveCoverPosition, uploadProfileImage } from "@/lib/profile-media";
import { cn } from "@/lib/utils";
import { AvatarCropDialog } from "./avatar-crop-dialog";
import { texts } from "@/i18n";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const COVER_HEIGHT = 128;

/** Alto de la imagen mostrada a todo el ancho de la franja: define cuánto se puede mover. */
function useDisplayedHeight(url: string | null, width: number): number {
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    if (url === null) return;
    const image = new Image();
    image.onload = () => {
      setRatio(image.naturalHeight / image.naturalWidth);
    };
    image.src = url;
  }, [url]);
  return url === null ? 0 : ratio * width;
}

export function ProfileCard({ account, membership }: { account: Account; membership: Membership }) {
  const t = texts.profile.card;
  const m = texts.profile.media;
  const { reloadAccount } = useAuth();
  const queryClient = useQueryClient();
  const { avatarUrl, coverUrl, coverPositionY } = account.user;
  const photoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [removing, setRemoving] = useState<"avatar" | "cover" | null>(null);
  const [busy, setBusy] = useState(false);
  // Encuadre en edición (null = no se está ajustando).
  const [position, setPosition] = useState<number | null>(null);
  const [stripWidth, setStripWidth] = useState(340);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const displayedHeight = useDisplayedHeight(coverUrl, stripWidth);
  const overflow = Math.max(0, displayedHeight - COVER_HEIGHT);

  useEffect(() => {
    const element = strip.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setStripWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const refresh = async () => {
    await reloadAccount();
    await queryClient.invalidateQueries();
  };

  const pick = (file: File | undefined, then: (file: File) => void) => {
    if (file === undefined) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error(m.notAnImage);
      return;
    }
    if (file.size > MAX_ORIGINAL_BYTES) {
      toast.error(m.tooBig);
      return;
    }
    then(file);
  };

  const uploadCover = async (file: File) => {
    setBusy(true);
    try {
      const bitmap = await loadBitmap(file);
      const blob = await renderCover(bitmap);
      await uploadProfileImage("cover", blob, { positionY: 50 });
      await refresh();
      // Recién subida: se arrastra para elegir el encuadre.
      setPosition(50);
      toast.info(m.dragToFrame);
    } catch (error) {
      toast.error(adminErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const savePosition = async () => {
    if (position === null) return;
    setBusy(true);
    try {
      await saveCoverPosition(Math.round(position));
      await refresh();
      setPosition(null);
      toast.success(m.positionSaved);
    } catch (error) {
      toast.error(adminErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const shownPosition = position ?? coverPositionY;

  return (
    <Card className="overflow-hidden">
      <div
        ref={strip}
        style={{
          height: COVER_HEIGHT,
          touchAction: position === null ? undefined : "none",
          ...(coverUrl === null
            ? {}
            : {
                backgroundImage: `url("${coverUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: `50% ${String(shownPosition)}%`,
              }),
        }}
        className={cn(
          // Al encuadrar, la franja queda por encima del avatar (que además se oculta).
          "relative bg-gradient-to-br from-primary-soft to-muted",
          position !== null && "z-10 cursor-grab active:cursor-grabbing",
        )}
        {...(position === null
          ? {}
          : {
              onPointerDown: (event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { y: event.clientY, position };
              },
              onPointerMove: (event) => {
                const start = drag.current;
                if (start === null || overflow === 0) return;
                // Arrastrar hacia abajo muestra más de la parte de arriba de la imagen.
                const next = start.position - ((event.clientY - start.y) / overflow) * 100;
                setPosition(Math.min(100, Math.max(0, next)));
              },
              onPointerUp: () => {
                drag.current = null;
              },
              onPointerCancel: () => {
                drag.current = null;
              },
            })}
      >
        {position !== null ? (
          <div className="absolute inset-x-3 top-3 z-50 flex items-center justify-between gap-2">
            <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-medium shadow-sm">
              {displayedHeight > 0 && overflow === 0 ? m.noRoomToFrame : m.dragHint}
            </span>
            {/* Los botones no inician el arrastre: la franja captura el puntero y se tragaría el clic. */}
            <div
              className="flex gap-2"
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="bg-background/90"
                onClick={() => {
                  // Descarta lo arrastrado: vuelve a verse la posición guardada.
                  setPosition(null);
                }}
              >
                {texts.admin.common.cancel}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  void savePosition();
                }}
              >
                {m.saveFrame}
              </Button>
            </div>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="absolute right-3 top-3 bg-background/90"
                aria-label={m.coverMenu}
              >
                <ImagePlus strokeWidth={1.75} aria-hidden="true" />
                {m.cover}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  coverInput.current?.click();
                }}
              >
                {coverUrl === null ? m.uploadCover : m.changeCover}
              </DropdownMenuItem>
              {coverUrl !== null && (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      setPosition(coverPositionY);
                    }}
                  >
                    {m.adjustFrame}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-danger"
                    onSelect={() => {
                      setRemoving("cover");
                    }}
                  >
                    {m.removeCover}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="grid justify-items-center gap-4 px-6 pb-6">
        <div className={cn("relative -mt-12", position !== null && "invisible")}>
          <Avatar
            name={account.user.name}
            src={avatarUrl}
            className="size-24 text-3xl ring-4 ring-background"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={busy}
                aria-label={m.photoMenu}
                className="absolute -bottom-1 -right-1 size-8 rounded-full bg-background"
              >
                <Camera className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  photoInput.current?.click();
                }}
              >
                {avatarUrl === null ? m.uploadPhoto : m.changePhoto}
              </DropdownMenuItem>
              {avatarUrl !== null && (
                <DropdownMenuItem
                  className="text-danger"
                  onSelect={() => {
                    setRemoving("avatar");
                  }}
                >
                  {m.removePhoto}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="min-w-0 max-w-full text-center">
          <p className="break-words text-xl font-semibold">{account.user.name}</p>
          <p className="break-words text-xs text-muted-foreground">
            {membership.jobTitle ?? t.noJobTitle}
          </p>
          {account.user.email !== null && (
            <p className="mt-1 break-all text-xs text-muted-foreground">{account.user.email}</p>
          )}
        </div>
        <dl className="grid w-full gap-3 border-t border-border pt-4 text-left text-sm">
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.role}
            </dt>
            <dd>
              <Badge tone="primary">{membership.role.name}</Badge>
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.departments}
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {membership.departments.length === 0 ? (
                <span className="text-muted-foreground">{t.noDepartments}</span>
              ) : (
                membership.departments.map((department) => (
                  <Badge
                    key={department.id}
                    tone={department.position === "MEMBER" ? "neutral" : "primary"}
                  >
                    {department.name}
                    {department.position === "MEMBER"
                      ? ""
                      : ` · ${t.positions[department.position]}`}
                  </Badge>
                ))
              )}
            </dd>
          </div>
        </dl>
      </div>

      <input
        ref={photoInput}
        type="file"
        accept={ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          pick(file, setCropping);
        }}
      />
      <input
        ref={coverInput}
        type="file"
        accept={ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          pick(file, (picked) => {
            void uploadCover(picked);
          });
        }}
      />
      <AvatarCropDialog
        file={cropping}
        onClose={() => {
          setCropping(null);
        }}
        onConfirm={async (blob) => {
          await uploadProfileImage("avatar", blob);
          await refresh();
          toast.success(m.photoSaved);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        icon={removing === "cover" ? ImagePlus : Camera}
        title={removing === "cover" ? m.confirmRemoveCover.title : m.confirmRemovePhoto.title}
        description={removing === "cover" ? m.confirmRemoveCover.text : m.confirmRemovePhoto.text}
        confirmLabel={m.remove}
        pendingLabel={m.removing}
        tone="warning"
        onConfirm={async () => {
          if (removing === null) return;
          await removeProfileImage(removing);
          await refresh();
          toast.success(removing === "cover" ? m.coverRemoved : m.photoRemoved);
        }}
      />
    </Card>
  );
}
