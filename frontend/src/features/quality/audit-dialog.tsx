// An audit, new or edited (docs/spec/calidad.md, «Fase 3»): its type, title, scope, date, auditor, who
// leads it, the chapters an internal one covers (of the company's standards) and an audit room for the
// external auditor.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  COMBO_PAGE_SIZE,
  useStaticSource,
  type ComboboxSource,
} from "@/components/ui/combobox";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { roomsApi } from "@/features/audit-rooms/audit-rooms-api";
import { useMembership } from "@/features/home/workspace-layout";
import {
  AUDIT_SCHEMES,
  auditKeys,
  auditsApi,
  qualityKeys,
  type Audit,
  type AuditInput,
} from "./quality-api";
import { todayDay, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.audits;

function useRoomSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "audit-rooms"],
      search: async (q, cursor, signal) => {
        const page = await roomsApi.list(
          workspaceSlug,
          cursor,
          signal ?? new AbortController().signal,
        );
        const needle = q.trim().toLowerCase();
        return {
          items: page.items
            .filter((room) => room.name.toLowerCase().includes(needle))
            .slice(0, COMBO_PAGE_SIZE)
            .map((room) => ({ id: room.id, label: room.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

export function AuditDialog({ audit, onClose }: { audit?: Audit; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const sharesRooms = membership.capabilities.includes("audit.share");
  const people = usePeopleSource();
  const rooms = useRoomSource();
  const schemes = useStaticSource(
    "quality-audit-schemes",
    AUDIT_SCHEMES.map((id) => ({ id, label: t.schemes[id] })),
  );
  const f = t.form;
  const [state, setState] = useState({
    scheme: audit?.scheme ?? "INTERNAL",
    title: audit?.title ?? "",
    scope: audit?.scope ?? "",
    plannedOn: audit?.plannedOn ?? todayDay(),
    auditor: audit?.auditor ?? "",
    lead: audit?.lead ?? null,
    chapters: audit?.chapters ?? [],
    room: audit?.room ?? null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  const year = Number(state.plannedOn.slice(0, 4)) || new Date().getFullYear();
  // The company's standards come with the coverage (only those it's audited against).
  const coverage = useQuery({
    queryKey: auditKeys.coverage(workspaceSlug, year),
    queryFn: () => auditsApi.coverage(workspaceSlug, year),
    select: (data) => data.standards,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body: AuditInput = {
        scheme: state.scheme,
        title: state.title.trim(),
        scope: state.scope.trim() === "" ? null : state.scope.trim(),
        plannedOn: state.plannedOn,
        auditor: state.auditor.trim() === "" ? null : state.auditor.trim(),
        leadId: state.lead?.id ?? null,
        chapters: state.scheme === "INTERNAL" ? state.chapters : [],
        auditRoomId: state.room?.id ?? null,
      };
      return audit === undefined
        ? await auditsApi.create(workspaceSlug, body)
        : await auditsApi.update(workspaceSlug, audit.id, body);
    },
    onSuccess: async () => {
      toast.success(audit === undefined ? f.created : f.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.title.trim() !== "" && state.plannedOn !== "";
  return (
    <DialogContent
      size="lg"
      title={audit === undefined ? f.createTitle : f.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!ready || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending
              ? texts.admin.common.saving
              : audit === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.scheme}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.scheme}
                placeholder={f.scheme}
                source={schemes}
                value={state.scheme}
                onChange={(option) => {
                  const next = AUDIT_SCHEMES.find((id) => id === option?.id);
                  if (next !== undefined) set({ scheme: next });
                }}
              />
            )}
          </FormField>
          <FormField label={f.plannedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.plannedOn}
                onChange={(event) => {
                  set({ plannedOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.title}>
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              placeholder={f.titlePlaceholder}
              value={state.title}
              onChange={(event) => {
                set({ title: event.target.value });
              }}
            />
          )}
        </FormField>
        <FormField label={f.scope}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={2000}
              value={state.scope}
              onChange={(event) => {
                set({ scope: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.auditor}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                placeholder={f.auditorPlaceholder}
                value={state.auditor}
                onChange={(event) => {
                  set({ auditor: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.lead}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.lead}
                placeholder={f.leadPlaceholder}
                source={people}
                value={state.lead?.id ?? null}
                valueLabel={state.lead?.name}
                onChange={(option) => {
                  set({ lead: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
        </div>
        {state.scheme === "INTERNAL" && (coverage.data ?? []).length > 0 && (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{f.chapters}</legend>
            {(coverage.data ?? []).map((standard) => (
              <div key={standard.standard} className="grid gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t.standards[standard.standard]}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {standard.chapters.map((chapter) => {
                    const key = `${standard.standard}:${String(chapter.number)}`;
                    return (
                      <Checkbox
                        key={key}
                        label={`${String(chapter.number)}. ${t.chapterNames[standard.standard][chapter.number - 1] ?? ""}`}
                        checked={state.chapters.includes(key)}
                        onChange={(event) => {
                          set({
                            chapters: event.target.checked
                              ? [...state.chapters, key]
                              : state.chapters.filter((item) => item !== key),
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
        )}
        {state.scheme !== "INTERNAL" && sharesRooms && (
          <FormField label={f.room} hint={f.roomHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.room}
                placeholder={f.roomPlaceholder}
                source={rooms}
                value={state.room?.id ?? null}
                valueLabel={state.room?.name}
                onChange={(option) => {
                  set({ room: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </DialogContent>
  );
}
