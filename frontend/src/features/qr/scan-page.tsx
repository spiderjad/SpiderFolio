// /q/:token — lo que abre un código QR escaneado. Con sesión lleva al documento (la versión
// vigente); sin sesión, un QR privado va al inicio de sesión y uno público muestra solo ese
// documento, en lectura.
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { filesApi } from "@/features/files/api";
import { ApiError } from "@/lib/api";
import { qrApi, type ScanResult } from "./qr-api";
import { texts } from "@/i18n";

function Message({ title, text }: { title: string; text?: string }) {
  return (
    <main className="mx-auto grid max-w-md gap-2 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {text !== undefined && <p className="text-xs text-muted-foreground">{text}</p>}
    </main>
  );
}

export function ScanPage() {
  const t = texts.qr.scan;
  const { token = "" } = useParams();
  const { status } = useAuth();
  const navigate = useNavigate();
  const result = useQuery({
    queryKey: ["qr", "scan", token],
    queryFn: () => qrApi.scan(token),
    enabled: status !== "loading",
    retry: false,
    // Cada vuelta a la pantalla cuenta como un escaneo: no se reintenta ni se refresca sola.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data: ScanResult | undefined = result.data;

  useEffect(() => {
    if (data?.kind !== "private") return;
    const base = `/app/${data.workspaceSlug}/files/${data.spaceId}`;
    if (data.nodeType === "PAGE") {
      void navigate(`${base}/p/${data.nodeId}`, { replace: true });
      return;
    }
    // Un archivo se abre (o se descarga) en su versión vigente.
    void filesApi
      .download(data.workspaceSlug, data.nodeId, { inline: false })
      .then((ticket) => {
        window.location.replace(ticket.url);
      })
      .catch(() => {
        void navigate(base, { replace: true });
      });
  }, [data, navigate]);

  if (status === "loading" || result.isPending) {
    return (
      <main className="mx-auto grid max-w-md gap-3 px-4 py-16">
        <p className="text-center text-xs text-muted-foreground">{t.opening}</p>
        <Skeleton className="h-10 w-full" />
      </main>
    );
  }
  if (result.isError) {
    const error = result.error;
    if (error instanceof ApiError && error.status === 401) {
      return <Navigate to={`/login?next=${encodeURIComponent(`/q/${token}`)}`} replace />;
    }
    if (error instanceof ApiError && error.status === 404) {
      return <Message title={t.invalid} text={t.invalidText} />;
    }
    return <Message title={t.error} />;
  }
  if (data?.kind === "public-page") {
    return (
      <main className="mx-auto grid h-dvh max-w-3xl grid-rows-[auto_1fr] gap-2 px-2 py-2">
        <p className="m-0 px-2 text-xs text-muted-foreground">{t.publicNote}</p>
        {/* Sin scripts ni acceso al resto: es solo el texto del documento. */}
        <iframe
          title={data.title}
          sandbox=""
          srcDoc={data.html}
          className="size-full rounded-lg border border-border bg-white"
        />
      </main>
    );
  }
  if (data?.kind === "public-file") {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">{data.title}</h1>
        <p className="text-xs text-muted-foreground">{t.publicNote}</p>
        <Button asChild className="mx-auto">
          <a href={data.url} rel="noopener">
            {t.download}
          </a>
        </Button>
      </main>
    );
  }
  return <Message title={t.opening} />;
}
