// Company templates (docs/spec/plantillas.md): «Save as template» on a page or folder and «From a
// company template» in the explorer's New button. The templates plugin puts them in those menus; the
// server decides who may do each thing.
import type { PluginFolderContext, PluginNodeContext } from "@spiderfolio/plugin-sdk/frontend";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, FileText, Folder } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Banner } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { errorText } from "@/lib/error-text";
import {
  createdPath,
  templateKeys,
  templatesApi,
  type OutlineNode,
  type TemplateSummary,
} from "./templates-api";
import { texts } from "@/i18n";

export interface TemplateFieldsValue {
  name: string;
  description: string;
  category: string;
}

/** Name, description and category, shared by saving and editing. */
export function TemplateFields({
  value,
  onChange,
}: {
  value: TemplateFieldsValue;
  onChange: (next: TemplateFieldsValue) => void;
}) {
  const t = texts.templates.fields;
  return (
    <FormGrid>
      <FormField label={t.name}>
        {(control) => (
          <Input
            {...control}
            required
            maxLength={120}
            value={value.name}
            onChange={(event) => {
              onChange({ ...value, name: event.target.value });
            }}
          />
        )}
      </FormField>
      <FormField label={t.description} hint={t.descriptionHint}>
        {(control) => (
          <Textarea
            {...control}
            maxLength={1000}
            value={value.description}
            onChange={(event) => {
              onChange({ ...value, description: event.target.value });
            }}
          />
        )}
      </FormField>
      <FormField label={t.category} hint={t.categoryHint}>
        {(control) => (
          <Input
            {...control}
            maxLength={60}
            value={value.category}
            onChange={(event) => {
              onChange({ ...value, category: event.target.value });
            }}
          />
        )}
      </FormField>
    </FormGrid>
  );
}

/** The tree of a template or a pack, without its texts. */
export function TemplateOutline({ node, depth = 0 }: { node: OutlineNode; depth?: number }) {
  const Icon = node.type === "FOLDER" ? Folder : node.controlled ? FileCheck2 : FileText;
  return (
    <li>
      <span
        className="flex items-center gap-2 py-0.5 text-sm"
        style={{ paddingLeft: `${String(depth * 16)}px` }}
      >
        <Icon
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="truncate">{node.name}</span>
        {node.controlled && (
          <span className="sr-only">{` (${texts.templates.use.controlled})`}</span>
        )}
      </span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child, index) => (
            <TemplateOutline
              key={`${child.name}-${String(index)}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SaveAsTemplateDialog({
  ctx,
  onClose,
}: {
  ctx: PluginNodeContext;
  onClose: () => void;
}) {
  const t = texts.templates;
  const queryClient = useQueryClient();
  const [value, setValue] = useState<TemplateFieldsValue>({
    name: ctx.node.name,
    description: "",
    category: "",
  });
  const save = useMutation({
    mutationFn: () => templatesApi.save(ctx.slug, ctx.node.id, value),
    onSuccess: ({ template }) => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.all(ctx.slug) });
      toast.success(t.save.done(template.name), {
        ...(template.skippedFiles > 0
          ? { description: t.save.skipped(template.skippedFiles) }
          : {}),
      });
      onClose();
    },
    onError: (error) => {
      toast.error(errorText(error));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.name.trim() !== "") save.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.save.title}
        description={ctx.node.type === "FOLDER" ? t.save.folder : t.save.page}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" form="save-template" disabled={save.isPending}>
              {save.isPending ? t.saving : t.save.submit}
            </Button>
          </>
        }
      >
        <form id="save-template" onSubmit={submit} className="grid gap-4">
          <TemplateFields value={value} onChange={setValue} />
          <p className="text-sm text-muted-foreground">{t.save.noComments}</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useTemplateSource(slug: string): ComboboxSource {
  return useMemo<ComboboxSource>(() => {
    const optionOf = (item: TemplateSummary) => ({
      id: item.id,
      label: item.name,
      description: [
        texts.templates.kinds[item.kind],
        item.category,
        texts.templates.count(item.nodeCount),
      ]
        .filter((part) => part !== null && part !== "")
        .join(" · "),
    });
    return {
      key: ["w", slug, "templates", "options"],
      search: async (q, cursor, signal) => {
        const page = await templatesApi.list(slug, { q }, cursor, signal);
        return { items: page.items.map(optionOf), nextCursor: page.nextCursor };
      },
      byIds: async (ids) => {
        const found = await Promise.all(ids.map((id) => templatesApi.get(slug, id)));
        return found.map(({ template }) => optionOf(template));
      },
    };
  }, [slug]);
}

export function UseTemplateDialog({
  ctx,
  onClose,
}: {
  ctx: PluginFolderContext;
  onClose: () => void;
}) {
  const t = texts.templates.use;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const source = useTemplateSource(ctx.slug);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: templateKeys.detail(ctx.slug, templateId ?? ""),
    queryFn: () => templatesApi.get(ctx.slug, templateId ?? ""),
    enabled: templateId !== null,
  });
  const create = useMutation({
    mutationFn: (id: string) =>
      templatesApi.use(ctx.slug, id, { spaceId: ctx.spaceId, parentId: ctx.folderId }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["w", ctx.slug, "files"] });
      toast.success(t.created(created.node.name), {
        ...(created.controlledSkipped > 0
          ? { description: t.controlledSkipped(created.controlledSkipped) }
          : {}),
      });
      onClose();
      void navigate(createdPath(ctx.slug, created.node));
    },
    onError: (error) => {
      toast.error(errorText(error));
    },
  });
  const template = detail.data?.template;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.text}
        size="lg"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={create.isPending}>
                {texts.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={create.isPending || templateId === null || template?.outline === null}
              onClick={() => {
                if (templateId !== null) create.mutate(templateId);
              }}
            >
              {create.isPending ? texts.templates.creating : t.submit}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField label={t.pick}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                label={t.pick}
                placeholder={t.pick}
                source={source}
                value={templateId}
                onChange={(option) => {
                  setTemplateId(option?.id ?? null);
                }}
              />
            )}
          </FormField>
          {template !== undefined && (
            <div className="grid gap-2">
              {template.description !== "" && (
                <p className="text-sm text-muted-foreground">{template.description}</p>
              )}
              {template.outline === null ? (
                <Banner tone="warning">{t.invalid}</Banner>
              ) : (
                <div>
                  <p className="v-label mb-1">{t.preview}</p>
                  <ul className="max-h-64 overflow-auto rounded-md border border-border p-2">
                    <TemplateOutline node={template.outline} />
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
