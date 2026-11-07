// A non-conforming form record and its nonconformity (docs/spec/calidad.md, «Desde un registro de
// formulario»): a link to the one already open for it or, for quality.manage and whoever is in charge of
// the form, «Abrir no conformidad». Only while the module is on; the server checks who may.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { qualityApi, qualityKeys } from "./quality-api";
import { texts } from "@/i18n";

export function RecordNcButton({
  recordId,
  nonConforming,
  canHandle,
}: {
  recordId: string;
  /** The record has non-conforming answers and isn't voided. */
  nonConforming: boolean;
  /** Whoever can void the record is in charge of the form. */
  canHandle: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const on = membership.workspace.quality.enabled && membership.role.base !== "GUEST";
  const manage = membership.capabilities.includes("quality.manage");
  const current = useQuery({
    queryKey: qualityKeys.ofRecord(workspaceSlug, recordId),
    queryFn: () => qualityApi.ofRecord(workspaceSlug, recordId),
    select: (data) => data.nc,
    enabled: on && nonConforming,
  });
  const open = useMutation({
    mutationFn: () => qualityApi.fromRecord(workspaceSlug, recordId),
    onSuccess: async ({ nc }) => {
      toast.success(texts.quality.fromRecord.done);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      await navigate(`/app/${workspaceSlug}/calidad/no-conformidades/${nc.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (!on || !nonConforming || current.isPending) return null;
  const nc = current.data ?? null;
  if (nc !== null) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to={`/app/${workspaceSlug}/calidad/no-conformidades/${nc.id}`}>
          <BadgeCheck className="size-4" aria-hidden="true" />
          {texts.quality.fromRecord.open(nc.code)}
        </Link>
      </Button>
    );
  }
  if (!manage && !canHandle) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={open.isPending}
      onClick={() => {
        open.mutate();
      }}
    >
      <BadgeCheck className="size-4" aria-hidden="true" />
      {texts.quality.fromRecord.action}
    </Button>
  );
}
