// /app/:slug/calidad/comunicar — anyone reports a nonconformity (docs/spec/calidad.md, «Permisos»): what
// happened, where and when, the product and the immediate correction. Whoever manages quality is told,
// reviews it and sets its cause and actions; whoever reported it sees it under «Comunicadas por mí».
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formReady, NcFields, useNcForm } from "./nc-form";
import { qualityApi } from "./quality-api";
import { texts } from "@/i18n";

const t = texts.quality.form;

export function ReportNcPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const { state, set } = useNcForm();
  const send = useMutation({
    mutationFn: () =>
      qualityApi.report(workspaceSlug, {
        title: state.title.trim(),
        description: state.description.trim(),
        detectedOn: state.detectedOn,
        location: state.location.trim() === "" ? null : state.location.trim(),
        productAffected: state.productAffected,
        productNote:
          state.productAffected && state.productNote.trim() !== ""
            ? state.productNote.trim()
            : null,
        correction: state.correction.trim() === "" ? null : state.correction.trim(),
      }),
    onSuccess: async ({ nc }) => {
      toast.success(t.reported);
      await navigate(`/app/${workspaceSlug}/calidad/no-conformidades/${nc.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.reportTitle}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t.reportSubtitle}</p>
      </div>
      <Card className="grid gap-4 p-4 sm:p-6">
        <NcFields state={state} set={set} full={false} />
        <Button
          className="justify-self-start"
          disabled={!formReady(state, false) || send.isPending}
          onClick={() => {
            send.mutate();
          }}
        >
          {send.isPending ? texts.admin.common.saving : t.send}
        </Button>
      </Card>
    </div>
  );
}
