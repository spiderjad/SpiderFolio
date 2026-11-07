// /app/:slug/seguridad/cae/permisos/:permitId — one work permit (docs/spec/cae.md, «Permisos de
// trabajo»): its data, people and precautions; while a draft, edit it or approve it with a signature
// (every precaution checked); once active, close it; cancel it at any time before; its PDF.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Pencil, ServerCrash } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatDateTime } from "@/lib/utils";
import { caeApi, caeKeys, type CaePermit, type CaePrecaution } from "./cae-api";
import { dataUrlOf, useCae } from "./cae-common";
import { PermitForm, PrecautionsList } from "./cae-permit-form";
import { permitName, PermitStateBadge } from "./cae-permits-page";
import { texts } from "@/i18n";

const t = texts.cae.permits;
const d = t.detail;

type Action = "edit" | "approve" | "close" | "cancel" | null;

export function CaePermitPage() {
  const { workspaceSlug = "", permitId = "" } = useParams();
  const cae = useCae();
  const [action, setAction] = useState<Action>(null);
  const permit = useQuery({
    queryKey: caeKeys.permit(workspaceSlug, permitId),
    queryFn: () => caeApi.permit(workspaceSlug, permitId),
    select: (data) => data.permit,
  });
  const pdf = useMutation({
    mutationFn: async (name: string) => {
      downloadBlobFile(`${name}.pdf`, await caeApi.permitPdf(workspaceSlug, permitId));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const close = () => {
    setAction(null);
  };
  if (permit.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(permit.error)}
        </EmptyState>
      </Card>
    );
  }
  const data = permit.data;
  if (data === undefined) return <Skeleton className="h-64 w-full" />;
  const name = permitName(data);
  const manage = data.canManage;

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4">
      <Link
        to={`${cae.base}/permisos`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {d.back}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {name}
            <PermitStateBadge state={data.state} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.location} · {data.company?.name ?? t.ownStaff}
          </p>
          <p className="text-sm text-muted-foreground">
            {t.validity(formatDateTime(data.validFrom), formatDateTime(data.validTo))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pdf.isPending}
            onClick={() => {
              pdf.mutate(name);
            }}
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {d.pdf}
          </Button>
          {manage && data.status === "DRAFT" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setAction("edit");
                }}
              >
                <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                {d.edit}
              </Button>
              <Button
                onClick={() => {
                  setAction("approve");
                }}
              >
                {d.approve}
              </Button>
            </>
          )}
          {manage && data.status === "ACTIVE" && (
            <Button
              onClick={() => {
                setAction("close");
              }}
            >
              {d.close}
            </Button>
          )}
          {manage && (data.status === "DRAFT" || data.status === "ACTIVE") && (
            <Button
              variant="ghost"
              onClick={() => {
                setAction("cancel");
              }}
            >
              {d.cancel}
            </Button>
          )}
        </div>
      </div>
      <Card className="grid gap-2 p-4 sm:p-5">
        {data.description !== "" && <p className="text-sm">{data.description}</p>}
        <p className="text-xs text-muted-foreground">
          {[
            d.issuedBy(data.issuedBy.name),
            data.approved === null
              ? null
              : d.approvedBy(data.approved.by.name, formatDateTime(data.approved.at)),
            data.closed === null
              ? null
              : data.status === "CANCELLED"
                ? d.cancelledBy(data.closed.by.name, formatDateTime(data.closed.at))
                : d.closedBy(data.closed.by.name, formatDateTime(data.closed.at)),
          ]
            .filter((value): value is string => value !== null)
            .join(" · ")}
        </p>
        {data.closed?.note != null && <p className="text-sm">{data.closed.note}</p>}
      </Card>
      <Card className="grid gap-2 p-4 sm:p-5">
        <CardTitle className="text-base">{d.people}</CardTitle>
        <ul className="grid gap-1 text-sm">
          {data.workers.map((worker) => (
            <li key={worker.id}>
              <Link
                to={`${cae.base}/trabajadores/${worker.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {worker.name}
              </Link>{" "}
              <span className="text-muted-foreground">({worker.company})</span>
            </li>
          ))}
          {data.members.map((member) => (
            <li key={member.id}>
              {member.name} <span className="text-muted-foreground">({t.ownStaff})</span>
            </li>
          ))}
        </ul>
      </Card>
      {data.precautions.length > 0 && (
        <Card className="grid gap-2 p-4 sm:p-5">
          <CardTitle className="text-base">{d.precautions}</CardTitle>
          <ul className="grid gap-1 text-sm">
            {data.precautions.map((item, index) => (
              <li key={`${String(index)}-${item.label}`} className="flex gap-2">
                <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {action === "edit" && <PermitForm permit={data} onClose={close} />}
        {action === "approve" && <ApproveDialog permit={data} onClose={close} />}
        {action === "close" && <EndDialog permit={data} kind="close" onClose={close} />}
        {action === "cancel" && <EndDialog permit={data} kind="cancel" onClose={close} />}
      </Dialog>
    </div>
  );
}

function ApproveDialog({ permit, onClose }: { permit: CaePermit; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [precautions, setPrecautions] = useState<CaePrecaution[]>(permit.precautions);
  const readSignature = useRef<() => Promise<Blob | null>>(() => Promise.resolve(null));
  const approve = useMutation({
    mutationFn: async () => {
      const blob = await readSignature.current();
      if (blob === null) throw new Error(d.signatureMissing);
      return await caeApi.approvePermit(workspaceSlug, permit.id, {
        signature: await dataUrlOf(blob),
        precautions,
      });
    },
    onSuccess: async () => {
      toast.success(d.approved);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      size="lg"
      title={d.approveTitle}
      description={d.approveHint}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={approve.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={approve.isPending || precautions.some((item) => !item.done)}
            onClick={() => {
              approve.mutate();
            }}
          >
            {d.approve}
          </Button>
        </>
      }
    >
      <FormGrid>
        <PrecautionsList precautions={precautions} onChange={setPrecautions} />
        <SignaturePad
          label={d.signature}
          register={(read) => {
            readSignature.current = read;
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}

function EndDialog({
  permit,
  kind,
  onClose,
}: {
  permit: CaePermit;
  kind: "close" | "cancel";
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const end = useMutation({
    mutationFn: () =>
      kind === "close"
        ? caeApi.closePermit(workspaceSlug, permit.id, text.trim())
        : caeApi.cancelPermit(workspaceSlug, permit.id, text.trim()),
    onSuccess: async () => {
      toast.success(kind === "close" ? d.closed : d.cancelled);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={kind === "close" ? d.closeTitle : d.cancelTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={end.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            variant={kind === "cancel" ? "destructive" : "primary"}
            disabled={end.isPending || (kind === "cancel" && text.trim().length < 3)}
            onClick={() => {
              end.mutate();
            }}
          >
            {kind === "close" ? d.close : d.cancel}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={kind === "close" ? d.closeNote : d.cancelReason}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={kind === "close" ? 1000 : 500}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
