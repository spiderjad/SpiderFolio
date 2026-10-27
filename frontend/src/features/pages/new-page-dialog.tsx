// «Nueva página»: se elige cómo empezar (en blanco o una plantilla con su estructura armada y textos
// de ejemplo en gris). La plantilla viaja como contenido inicial y el servidor la valida igual que
// cualquier texto de página.
import { pageTemplates, type PageTemplate } from "@spiderfolio/content";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ClipboardList,
  FileText,
  ListChecks,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { pagesApi } from "@/features/files/api";
import { bianApi, bianKeys } from "@/features/bian/bian-api";
import { useMembership } from "@/features/home/workspace-layout";
import { locale, texts } from "@/i18n";

const ICONS: Record<PageTemplate["id"], LucideIcon> = {
  blank: FileText,
  procedure: ClipboardList,
  "work-instruction": ListChecks,
  "meeting-minutes": Users,
  welcome: BookOpen,
};

export function NewPageDialog({
  open,
  spaceId,
  parentId,
  onClose,
}: {
  open: boolean;
  spaceId: string;
  /** Carpeta o página donde queda; null = la raíz del espacio. */
  parentId: string | null;
  onClose: () => void;
}) {
  const t = texts.pages.newPageDialog;
  const { workspaceSlug = "" } = useParams();
  // Se eligen en el idioma de la app, pero la página nace en el de la empresa (es suya).
  const shown = pageTemplates(locale);
  const companyTemplates = pageTemplates(useMembership().workspace.locale);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // «Redactar con Bian»: elige tipo de documento y escribe notas; Bian arma el borrador.
  const [view, setView] = useState<"templates" | "ai">("templates");
  const [templateId, setTemplateId] = useState<PageTemplate["id"]>("procedure");
  const [notes, setNotes] = useState("");
  const typeSource = useStaticSource(
    "bian-draft-types",
    shown.map((template) => ({
      id: template.id,
      label: template.id === "blank" ? texts.bian.draft.free : template.title,
    })),
  );
  const draft = useMutation({
    mutationFn: () => bianApi.draft(workspaceSlug, { spaceId, parentId, templateId, notes }),
    onSuccess: ({ page }) => {
      void queryClient.invalidateQueries({ queryKey: bianKeys.usage(workspaceSlug) });
      toast.success(texts.bian.draft.created);
      onClose();
      void navigate(`/app/${workspaceSlug}/files/${spaceId}/p/${page.node.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const create = useMutation({
    mutationFn: (chosen: PageTemplate) => {
      const template = companyTemplates.find((item) => item.id === chosen.id) ?? chosen;
      return pagesApi.create(workspaceSlug, spaceId, {
        parentId,
        name: template.name,
        ...(template.id === "blank" ? {} : { content: template.content }),
      });
    },
    onSuccess: ({ page }) => {
      toast.success(texts.pages.newPageCreated);
      onClose();
      void navigate(`/app/${workspaceSlug}/files/${spaceId}/p/${page.node.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setView("templates");
          onClose();
        }
      }}
    >
      <DialogContent
        title={view === "ai" ? texts.bian.draft.title : t.title}
        description={view === "ai" ? texts.bian.draft.description : t.description}
        size="lg"
        footer={
          view === "ai" ? (
            <>
              <Button
                variant="outline"
                disabled={draft.isPending}
                onClick={() => {
                  setView("templates");
                }}
              >
                {texts.bian.draft.back}
              </Button>
              <Button
                disabled={draft.isPending || notes.trim() === ""}
                onClick={() => {
                  draft.mutate();
                }}
              >
                <Sparkles strokeWidth={1.75} aria-hidden="true" />
                {draft.isPending ? texts.bian.draft.submitting : texts.bian.draft.submit}
              </Button>
            </>
          ) : (
            <DialogClose asChild>
              <Button variant="outline" disabled={create.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
          )
        }
      >
        {view === "ai" ? (
          <FormGrid>
            <FormField label={texts.bian.draft.type}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={texts.bian.draft.type}
                  placeholder={texts.bian.draft.type}
                  searchable={false}
                  disabled={draft.isPending}
                  source={typeSource}
                  value={templateId}
                  onChange={(option) => {
                    const next = shown.find((template) => template.id === option?.id);
                    if (next !== undefined) setTemplateId(next.id);
                  }}
                />
              )}
            </FormField>
            <FormField label={texts.bian.draft.notes} hint={texts.bian.draft.notesHint}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={8}
                  maxLength={4000}
                  value={notes}
                  disabled={draft.isPending}
                  placeholder={texts.bian.draft.notesPlaceholder}
                  onChange={(event) => {
                    setNotes(event.target.value);
                  }}
                />
              )}
            </FormField>
            <p className="text-xs text-muted-foreground">{texts.bian.draft.cost}</p>
          </FormGrid>
        ) : (
          <>
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => {
                setView("ai");
              }}
              className="mb-2 flex w-full items-start gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-3 text-left transition-colors hover:bg-primary-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{texts.bian.draft.open}</span>
                <span className="block text-xs text-muted-foreground">{texts.bian.draft.openHint}</span>
              </span>
            </button>
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
              {shown.map((template) => {
                const Icon = ICONS[template.id];
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      disabled={create.isPending}
                      onClick={() => {
                        create.mutate(template);
                      }}
                      className="flex h-full w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{template.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {template.description}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">{t.note}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
