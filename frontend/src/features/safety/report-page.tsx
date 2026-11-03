// /app/:slug/seguridad/comunicar — reporting an accident, an incident or a near miss inside Prevención
// (docs/spec/seguridad-salud.md): the base form, with today and the time now already filled in; once sent
// it goes back to where the person came from.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/display";
import { FormFillPage } from "@/features/forms/form-fill-page";
import { incidentsApi, incidentsKeys } from "./safety-api";
import { useSafety } from "./safety-common";
import { texts } from "@/i18n";

const pad = (n: number) => String(n).padStart(2, "0");

export function ReportPage() {
  const { workspaceSlug = "" } = useParams();
  const safety = useSafety();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from ??
    `/app/${workspaceSlug}/seguridad/personas/${safety.membershipId}`;
  const form = useQuery({
    queryKey: incidentsKeys.form(workspaceSlug),
    queryFn: () => incidentsApi.form(workspaceSlug),
    select: (data) => data.form,
  });
  const initial = useMemo(() => {
    const now = new Date();
    return {
      sst_fecha: `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      sst_hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    };
  }, []);
  return (
    <div className="grid gap-4">
      <Link
        to={from}
        className="mx-auto inline-flex w-full max-w-xl items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {texts.safety.back}
      </Link>
      {form.data == null ? (
        <Skeleton className="mx-auto h-96 w-full max-w-xl" />
      ) : (
        <FormFillPage
          formId={form.data.formId}
          initial={initial}
          timeFields={["sst_hora"]}
          onDone={() => {
            toast.success(texts.safety.incidents.reported);
            void navigate(from);
          }}
        />
      )}
    </div>
  );
}
