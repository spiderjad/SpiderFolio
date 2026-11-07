// What the CAE screens share (docs/spec/cae.md): whether it's on and who manages or only checks, the
// guard that hides it, its sub-navigation, the state badges and the block and archive dialogs.
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COMBO_PAGE_SIZE, type ComboboxSource } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/display";
import { FormField, FormGrid, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { cn } from "@/lib/utils";
import { caeApi, caeKeys, type CaeRequirementState, type CaeState } from "./cae-api";
import { texts } from "@/i18n";

export function useCae() {
  const membership = useMembership();
  const { cae, terms } = membership.workspace.safety;
  const manage = membership.capabilities.includes("cae.manage");
  const check = manage || membership.capabilities.includes("cae.check");
  return {
    enabled: cae,
    /** The tab and the screens: whoever manages CAE or checks it. */
    visible: cae && check,
    manage,
    check,
    terms: texts.cae.terms[terms],
    slug: membership.workspace.slug,
    base: `/app/${membership.workspace.slug}/seguridad/cae`,
  };
}

/** CAE's screens exist only while it's on, for whoever manages or checks it. */
export function RequireCae() {
  const { visible } = useCae();
  return visible ? <Outlet /> : <NotFoundPage />;
}

/** The catalog: only whoever manages CAE. */
export function RequireCaeManager() {
  const { visible, manage } = useCae();
  return visible && manage ? <Outlet /> : <NotFoundPage />;
}

/** Companies and, for whoever manages it, the catalog. */
export function CaeNav() {
  const { base, manage, terms } = useCae();
  if (!manage) return null;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      isActive
        ? "bg-primary-soft font-medium text-primary-soft-foreground"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <nav className="flex flex-wrap gap-1" aria-label={terms.tab}>
      <NavLink end to={base} className={tab}>
        {texts.cae.nav.companies}
      </NavLink>
      <NavLink to={`${base}/catalogo`} className={tab}>
        {texts.cae.nav.catalog}
      </NavLink>
    </nav>
  );
}

const stateTone = {
  authorized: "success",
  incomplete: "warning",
  blocked: "danger",
  archived: "neutral",
} as const;

/** Green «Autorizada», amber «Incompleta», red «Bloqueada». */
export function CaeStateBadge({ state, worker = false }: { state: CaeState; worker?: boolean }) {
  return (
    <Badge tone={stateTone[state]}>
      {worker ? texts.cae.workerStates[state] : texts.cae.states[state]}
    </Badge>
  );
}

const requirementTone = {
  ok: "success",
  due_soon: "warning",
  expired: "danger",
  pending: "primary",
  rejected: "danger",
  missing: "neutral",
} as const;

export function RequirementStateBadge({ state }: { state: CaeRequirementState }) {
  return <Badge tone={requirementTone[state]}>{texts.cae.requirementStates[state]}</Badge>;
}

/** Active contractors, to choose the one a subcontractor works for. */
export function useContractorSource(exceptId?: string): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "contractor-options", exceptId ?? ""],
      search: async (q, cursor, signal) => {
        const page = await caeApi.companies(
          workspaceSlug,
          { q, kind: "CONTRACTOR" },
          cursor,
          signal,
          COMBO_PAGE_SIZE,
        );
        return {
          items: page.items
            .filter((company) => company.id !== exceptId)
            .map((company) => ({ id: company.id, label: company.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await caeApi.companies(workspaceSlug, { ids, status: undefined }, undefined)).items.map(
          (company) => ({ id: company.id, label: company.name }),
        ),
    }),
    [workspaceSlug, exceptId],
  );
}

/** Asks for the reason and blocks (a company or a worker). */
export function BlockDialog({
  name,
  block,
  done,
  onClose,
}: {
  name: string;
  block: (reason: string) => Promise<unknown>;
  done: string;
  onClose: () => void;
}) {
  const t = texts.cae.block;
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => block(reason.trim()),
    onSuccess: () => {
      toast.success(done);
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.title(name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={mutation.isPending || reason.trim().length < 3}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t.action}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.reason} hint={t.reasonHint}>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

/** Confirms archiving (nothing is deleted). */
export function ArchiveDialog({
  name,
  text,
  archive,
  done,
  onClose,
}: {
  name: string;
  text: string;
  archive: () => Promise<unknown>;
  done: string;
  onClose: () => void;
}) {
  const t = texts.cae.archive;
  const mutation = useMutation({
    mutationFn: archive,
    onSuccess: () => {
      toast.success(done);
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.title(name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t.action}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{text}</p>
    </DialogContent>
  );
}
