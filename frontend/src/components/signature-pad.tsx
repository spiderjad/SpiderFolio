// A signature pad (docs/spec/formularios.md and docs/spec/seguridad-salud.md): forms and PPE handouts.
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { useMembership } from "@/features/home/workspace-layout";
import { texts } from "@/i18n";

const t = texts.forms.fill;

/**
 * A signature drawn with a finger, a pen or the mouse; read as a PNG when it's sent. By default it's the
 * signature of whoever is signed in; `signer` names someone else (a PPE handout signed by its recipient).
 */
export function SignaturePad({
  label,
  register,
  signer,
}: {
  label: string;
  register: (read: () => Promise<Blob | null>) => void;
  signer?: string | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const membership = useMembership();
  const { account } = useAuth();

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    // Sharp on any screen: the drawing buffer follows the device's pixels.
    const ratio = window.devicePixelRatio || 1;
    element.width = element.clientWidth * ratio;
    element.height = element.clientHeight * ratio;
    const context = element.getContext("2d");
    if (context === null) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111";
  }, []);

  useEffect(() => {
    register(async () => {
      if (empty || canvas.current === null) return null;
      const element = canvas.current;
      return await new Promise<Blob | null>((resolve) => {
        element.toBlob((blob) => {
          resolve(blob);
        }, "image/png");
      });
    });
  }, [empty, register]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const context = () => canvas.current?.getContext("2d") ?? null;

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${label}. ${t.signHere}`}
        className="h-40 w-full touch-none rounded-xl border border-dashed border-border bg-white"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const ctx = context();
          const { x, y } = point(event);
          ctx?.beginPath();
          ctx?.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = context();
          const { x, y } = point(event);
          ctx?.lineTo(x, y);
          ctx?.stroke();
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {empty
            ? t.signHere
            : t.signedAs(signer ?? account?.user.name ?? membership.workspace.name)}
        </span>
        {!empty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const element = canvas.current;
              const ctx = context();
              if (element !== null && ctx !== null)
                ctx.clearRect(0, 0, element.width, element.height);
              setEmpty(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t.clearSignature}
          </Button>
        )}
      </div>
    </div>
  );
}
