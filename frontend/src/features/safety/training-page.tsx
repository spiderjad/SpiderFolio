// /app/:slug/seguridad/formacion — courses (docs/spec/seguridad-salud.md, «Formación»): each one a
// controlled document; whoever manages the module creates them; everyone sees the ones that concern them.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { documentsApi } from "@/features/documents/documents-api";
import { trainingApi, trainingKeys, type Course } from "./safety-api";
import { PpeTabs, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.training;

export function TrainingPage() {
  const { workspaceSlug = "" } = useParams();
  const safety = useSafety();
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Course>({
    queryKey: trainingKeys.all(workspaceSlug),
    fetchPage: (cursor, signal) => trainingApi.list(workspaceSlug, cursor, signal),
  });
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {safety.canManage ? t.subtitle : t.subtitleOwn}
          </p>
        </div>
        {safety.canManage && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        )}
      </div>
      <PpeTabs />
      {list.query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.items.length === 0 ? (
        <Card>
          <EmptyState icon={GraduationCap} title={t.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {list.items.map((course) => {
              const total = Object.values(course.counts).reduce((a, b) => a + b, 0);
              return (
                <li
                  key={course.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/app/${workspaceSlug}/seguridad/formacion/${course.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {course.document.code}
                      </span>{" "}
                      {course.document.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {course.validityMonths === null
                        ? t.noValidity
                        : t.validity(course.validityMonths)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {course.counts.expired + course.counts.pending > 0 && (
                      <Badge tone="danger">
                        {t.states.pending}: {course.counts.expired + course.counts.pending}
                      </Badge>
                    )}
                    {course.counts.due_soon > 0 && (
                      <Badge tone="warning">
                        {t.states.due_soon}: {course.counts.due_soon}
                      </Badge>
                    )}
                    <Badge tone="success">{t.counts(course.counts.valid, total)}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
          <LoadMore
            hasNextPage={list.query.hasNextPage}
            isFetching={list.query.isFetchingNextPage}
            onLoadMore={list.loadMore}
          />
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <NewCourse
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function NewCourse({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [months, setMonths] = useState("");
  const source = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "safety", "course-documents"],
      search: async (q, cursor, signal) => {
        const page = await documentsApi.adminDocuments(
          workspaceSlug,
          { q, status: "PUBLISHED", cursor },
          signal,
        );
        return {
          items: page.items.slice(0, COMBO_PAGE_SIZE).map((row) => ({
            id: row.node.id,
            label: `${row.code} ${row.node.name}`,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
  const create = useMutation({
    mutationFn: () => {
      const value = Number.parseInt(months, 10);
      return trainingApi.create(workspaceSlug, {
        nodeId: nodeId ?? "",
        validityMonths: Number.isInteger(value) && value > 0 ? value : null,
      });
    },
    onSuccess: async () => {
      toast.success(t.toasts.created);
      await queryClient.invalidateQueries({ queryKey: trainingKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.form.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline">{texts.admin.common.cancel}</Button>
          </DialogClose>
          <Button
            disabled={nodeId === null || create.isPending}
            onClick={() => {
              create.mutate();
            }}
          >
            {texts.admin.common.create}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.document}>
          {(control) => (
            <Combobox
              id={control.id}
              label={t.form.document}
              placeholder={t.form.documentPlaceholder}
              source={source}
              value={nodeId}
              valueLabel={label}
              onChange={(option) => {
                setNodeId(option?.id ?? null);
                setLabel(option?.label);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.validity} hint={t.form.validityHint}>
          {(control) => (
            <Input
              {...control}
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              value={months}
              onChange={(event) => {
                setMonths(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}
