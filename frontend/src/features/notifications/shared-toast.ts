// Al entrar, si hay elementos compartidos sin abrir: un aviso con enlace a la lista. Una vez por
// carga de la app y workspace (no cada vez que se cambia de pantalla).
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { filesApi, filesKeys } from "@/features/files/api";
import { texts } from "@/i18n";

/** Workspaces ya avisados en esta carga de la app (en memoria: no se guarda nada en el navegador). */
const announced = new Set<string>();

export function useSharedToast(slug: string): void {
  const navigate = useNavigate();
  const summary = useQuery({
    queryKey: [...filesKeys.all(slug), "shared", "summary"],
    queryFn: () => filesApi.sharedSummary(slug),
    staleTime: 20_000,
  });
  const unseen = summary.data?.unseen ?? 0;
  useEffect(() => {
    if (unseen === 0) return;
    if (announced.has(slug)) return;
    announced.add(slug);
    toast.info(texts.notifications.sharedToast(unseen), {
      duration: 10_000,
      action: {
        label: texts.notifications.sharedToastAction,
        onClick: () => {
          void navigate(`/app/${slug}/files/shared`);
        },
      },
    });
  }, [unseen, slug, navigate]);
}
