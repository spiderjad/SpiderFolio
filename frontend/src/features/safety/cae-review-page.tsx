// /app/:slug/seguridad/cae/revisar — «Por revisar» (docs/spec/cae.md, «Pantallas»): the PENDING
// documents of every company, oldest first, to open, accept (with its validity) or reject with a reason.
// Only whoever manages CAE.
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, ExternalLink, Inbox, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Card, EmptyState } from "@/components/ui/display";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import { caeApi, caeKeys, type CaeDocument } from "./cae-api";
import { CaeNav, useCae } from "./cae-common";
import { AcceptDocumentDialog, openCaeFile, RejectDocumentDialog } from "./cae-documents";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.review;
const d = texts.cae.documents;
const FILTERS = { status: "pending" } as const;

export function CaeReviewPage() {
  const { workspaceSlug = "" } = useParams();
  const cae = useCae();
  const [action, setAction] = useState<{ kind: "accept" | "reject"; doc: CaeDocument } | null>(
    null,
  );
  const list = useInfiniteList<CaeDocument>({
    queryKey: caeKeys.documents(workspaceSlug, FILTERS),
    fetchPage: (cursor, signal) => caeApi.documents(workspaceSlug, FILTERS, cursor, signal),
  });
  const columns = useMemo<ColumnDef<CaeDocument>[]>(
    () => [
      {
        id: "document",
        header: t.columns.document,
        cell: ({ row }) => {
          const doc = row.original;
          return (
            <div className="grid min-w-0 gap-0.5">
              <p className="font-medium">{doc.requirement.name}</p>
              {doc.file.name === null ? (
                <span className="text-xs text-muted-foreground">{d.trashed}</span>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 text-left text-xs font-medium text-primary underline-offset-4 hover:underline"
                  aria-label={d.view(doc.file.name)}
                  onClick={() => {
                    void openCaeFile(workspaceSlug, doc.file.id);
                  }}
                >
                  <ExternalLink
                    className="size-3.5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="truncate">{doc.file.name}</span>
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {doc.validUntil === null
                  ? d.noExpiry
                  : d.validUntilShort(formatUtcDate(doc.validUntil))}
              </span>
            </div>
          );
        },
      },
      {
        id: "subject",
        header: t.columns.subject,
        cell: ({ row }) => {
          const doc = row.original;
          return (
            <div className="grid min-w-0 gap-0.5">
              <Link
                to={`${cae.base}/empresas/${doc.company.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {doc.company.name}
              </Link>
              {doc.worker !== null && (
                <Link
                  to={`${cae.base}/trabajadores/${doc.worker.id}`}
                  className="text-xs underline-offset-4 hover:underline"
                >
                  {doc.worker.name}
                </Link>
              )}
            </div>
          );
        },
      },
      {
        id: "given",
        header: t.columns.given,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.fromPortal
              ? `${texts.cae.portal.fromPortal} · ${formatDateTime(row.original.createdAt)}`
              : d.givenBy(row.original.createdBy.name, formatDateTime(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t.columns.actions}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAction({ kind: "accept", doc: row.original });
              }}
            >
              <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {d.accept}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAction({ kind: "reject", doc: row.original });
              }}
            >
              <XCircle className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {d.reject}
            </Button>
          </div>
        ),
      },
    ],
    [cae.base, workspaceSlug],
  );
  const close = () => {
    setAction(null);
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <PpeTabs />
      <CaeNav />
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={t.empty.title}>
            {t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(doc) => doc.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        </Card>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {action?.kind === "accept" && (
          <AcceptDocumentDialog
            documentId={action.doc.id}
            requirement={action.doc.requirement.name}
            validUntil={action.doc.validUntil}
            onClose={close}
          />
        )}
        {action?.kind === "reject" && (
          <RejectDocumentDialog
            documentId={action.doc.id}
            requirement={action.doc.requirement.name}
            onClose={close}
          />
        )}
      </Dialog>
    </div>
  );
}
