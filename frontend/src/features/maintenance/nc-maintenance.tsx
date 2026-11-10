// A nonconformity's maintenance (docs/spec/mantenimiento.md, section 8): its work orders and how they're
// going, and «Ask maintenance» for whoever handles the NC. With the Maintenance module off, nothing.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Card, CardTitle } from "@/components/ui/display";
import { FormField } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { qualityApi, qualityKeys, type NcDetail } from "@/features/quality/quality-api";
import { StatusBadge, useAssetSource, useAssets } from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.quality;

export function NcMaintenanceCard({ nc, editable }: { nc: NcDetail; editable: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const [asking, setAsking] = useState(false);
  if (!nc.maintenanceEnabled) return null;
  if (nc.maintenance.length === 0 && !editable) return null;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
        </div>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAsking(true);
            }}
          >
            <Wrench className="size-4" aria-hidden="true" />
            {t.ask}
          </Button>
        )}
      </div>
      {nc.maintenance.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {nc.maintenance.map((order) => (
            <li key={order.id} className="grid gap-1 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/app/${workspaceSlug}/mantenimiento/ot/${order.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {order.code}
                </Link>
                <StatusBadge status={order.status} />
                {order.asset !== null && (
                  <span className="text-muted-foreground">
                    {order.asset.code} · {order.asset.name}
                  </span>
                )}
              </div>
              <p className="min-w-0 break-words">{order.title}</p>
              {order.solution !== "" && (
                <p className="text-xs text-muted-foreground">{t.solution(order.solution)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <AskDialog
          ncId={nc.id}
          onClose={() => {
            setAsking(false);
          }}
        />
      )}
    </Card>
  );
}

function AskDialog({ ncId, onClose }: { ncId: string; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const assets = useAssets();
  const source = useAssetSource("nc", assets.data ?? []);
  const [assetId, setAssetId] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => qualityApi.askMaintenance(workspaceSlug, ncId, assetId),
    onSuccess: async ({ nc }) => {
      queryClient.setQueryData(qualityKeys.one(workspaceSlug, ncId), { nc });
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "maintenance"] });
      const latest = nc.maintenance.at(-1);
      if (latest !== undefined) toast.success(t.sent(latest.code));
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        title={t.askTitle}
        description={t.askHint}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={ask.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={ask.isPending}
              onClick={() => {
                ask.mutate();
              }}
            >
              {t.send}
            </Button>
          </>
        }
      >
        <FormField label={t.asset}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={t.asset}
              placeholder={t.assetPlaceholder}
              source={source}
              value={assetId}
              onChange={(option) => {
                setAssetId(option?.id ?? null);
              }}
            />
          )}
        </FormField>
      </DialogContent>
    </Dialog>
  );
}
