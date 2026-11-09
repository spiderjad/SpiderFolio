// Admin › Templates (docs/spec/plantillas.md): the company's templates and the industry packs. The
// templates plugin shows it as its admin section; the server answers 404 without the plugin and 403
// without templates:manage.
import type { PluginScreenProps } from "@spiderfolio/plugin-sdk/frontend";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Check,
  Factory,
  LayoutTemplate,
  Package,
  Pencil,
  Trash2,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { Checkbox, FormField } from "@/components/ui/form";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { canEdit, filesApi, type SpaceView } from "@/features/files/api";
import { useMembership } from "@/features/home/workspace-layout";
import { errorText } from "@/lib/error-text";
import { cn, formatShortDate } from "@/lib/utils";
import { TemplateFields, TemplateOutline, type TemplateFieldsValue } from "./template-dialogs";
import {
  createdPath,
  templateKeys,
  templatesApi,
  type PackView,
  type TemplateKind,
  type TemplateSummary,
} from "./templates-api";
import { texts } from "@/i18n";

export function TemplatesAdmin({ slug }: PluginScreenProps) {
  const t = texts.templates;
  const [params, setParams] = useSearchParams();
  const tab = params.get("pestana") === "paquetes" ? "packs" : "mine";
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
      </header>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {(["mine", "packs"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (id === "packs") next.set("pestana", "paquetes");
              else next.delete("pestana");
              setParams(next, { replace: true });
            }}
          >
            {t.tabs[id]}
          </button>
        ))}
      </div>
      {tab === "packs" ? <Packs slug={slug} /> : <CompanyTemplates slug={slug} />}
    </div>
  );
}

// ─── The company's templates ───

function CompanyTemplates({ slug }: { slug: string }) {
  const t = texts.templates;
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("categoria") ?? "";
  const kindParam = params.get("tipo");
  const kind: TemplateKind | undefined =
    kindParam === "PAGE" || kindParam === "FOLDER" ? kindParam : undefined;
  const [search, setSearch] = useState(q);
  const filter = useMemo(
    () => ({
      ...(q === "" ? {} : { q }),
      ...(category === "" ? {} : { category }),
      ...(kind === undefined ? {} : { kind }),
    }),
    [q, category, kind],
  );
  const patch = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const list = useInfiniteList<TemplateSummary>({
    queryKey: templateKeys.list(slug, filter),
    fetchPage: (cursor, signal) => templatesApi.list(slug, filter, cursor, signal),
  });
  const categories = useQuery({
    queryKey: templateKeys.categories(slug),
    queryFn: () => templatesApi.categories(slug),
  });
  const categorySource = useStaticSource(
    `template-categories-${(categories.data?.categories ?? []).join("|")}`,
    useMemo(
      () => (categories.data?.categories ?? []).map((name) => ({ id: name, label: name })),
      [categories.data],
    ),
  );
  const kindSource = useStaticSource(
    "template-kinds",
    useMemo(
      () => (["PAGE", "FOLDER"] as const).map((id) => ({ id, label: t.kinds[id] })),
      [t.kinds],
    ),
  );
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const queryClient = useQueryClient();
  const filtered = q !== "" || category !== "" || kind !== undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="w-full max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            patch({ q: search.trim() });
          }}
        >
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              if (value === "") patch({ q: undefined });
            }}
            placeholder={t.search}
            label={t.search}
          />
        </form>
        <Combobox
          compact
          clearable
          searchable={false}
          className="w-48"
          label={t.fields.category}
          placeholder={t.allCategories}
          source={categorySource}
          value={category === "" ? null : category}
          valueLabel={category}
          onChange={(option) => {
            patch({ categoria: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          className="w-48"
          label={t.allKinds}
          placeholder={t.allKinds}
          source={kindSource}
          value={kind ?? null}
          onChange={(option) => {
            patch({ tipo: option?.id });
          }}
        />
      </div>
      {list.query.isPending ? (
        <Skeleton className="h-40" />
      ) : list.query.isError ? (
        <Banner tone="warning">{errorText(list.query.error)}</Banner>
      ) : list.items.length === 0 ? (
        <EmptyState icon={LayoutTemplate} {...(filtered ? {} : { title: t.empty.title })}>
          {filtered ? t.noResults : t.empty.text}
        </EmptyState>
      ) : (
        <Card className="p-0">
          <InfiniteList
            items={list.items}
            getKey={(item) => item.id}
            label={t.title}
            maxHeightClass="max-h-[70vh]"
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
            renderItem={(item) => (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{item.name}</span>
                    <Badge>{t.kinds[item.kind]}</Badge>
                    {item.category !== null && <Badge tone="primary">{item.category}</Badge>}
                    {item.packKey !== null && <Badge>{t.fromPack}</Badge>}
                  </p>
                  {item.description !== "" && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      t.count(item.nodeCount),
                      item.skippedFiles > 0 ? t.skipped(item.skippedFiles) : null,
                      item.createdBy === null ? null : t.by(item.createdBy.name),
                      formatShortDate(item.createdAt),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t.edit}: ${item.name}`}
                  title={t.edit}
                  onClick={() => {
                    setEditing(item);
                  }}
                >
                  <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t.delete}: ${item.name}`}
                  title={t.delete}
                  onClick={() => {
                    setDeleting(item);
                  }}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
            )}
          />
        </Card>
      )}
      {editing !== null && (
        <EditTemplateDialog
          slug={slug}
          template={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        icon={Trash2}
        title={t.deleteTitle(deleting?.name ?? "")}
        description={t.deleteText}
        confirmLabel={t.delete}
        pendingLabel={t.deleting}
        onConfirm={async () => {
          if (deleting === null) return;
          await templatesApi.remove(slug, deleting.id);
          void queryClient.invalidateQueries({ queryKey: templateKeys.all(slug) });
          toast.success(t.deleted);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function EditTemplateDialog({
  slug,
  template,
  onClose,
}: {
  slug: string;
  template: TemplateSummary;
  onClose: () => void;
}) {
  const t = texts.templates;
  const queryClient = useQueryClient();
  const [value, setValue] = useState<TemplateFieldsValue>({
    name: template.name,
    description: template.description,
    category: template.category ?? "",
  });
  const save = useMutation({
    mutationFn: () => templatesApi.update(slug, template.id, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.all(slug) });
      toast.success(t.saved);
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
        title={t.edit}
        description={template.name}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" form="edit-template" disabled={save.isPending}>
              {save.isPending ? t.saving : texts.admin.common.save}
            </Button>
          </>
        }
      >
        <form id="edit-template" onSubmit={submit}>
          <TemplateFields value={value} onChange={setValue} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Industry packs ───

/** An icon per industry; a pack from another plugin gets the generic one. */
const packIcons: Record<string, LucideIcon> = {
  alimentacion: UtensilsCrossed,
  industria: Factory,
  servicios: Briefcase,
};

function Packs({ slug }: { slug: string }) {
  const t = texts.templates.packs;
  const packs = useQuery({
    queryKey: templateKeys.packs(slug),
    queryFn: () => templatesApi.packs(slug),
  });
  const [installing, setInstalling] = useState<PackView | null>(null);
  if (packs.isPending) return <Skeleton className="h-40" />;
  if (packs.isError) return <Banner tone="warning">{errorText(packs.error)}</Banner>;
  const list = packs.data.packs;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      {list.length === 0 ? (
        <EmptyState icon={Package}>{t.none}</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((pack) => {
            const Icon = packIcons[pack.id] ?? Package;
            const installed = pack.installedAt !== null;
            const counts = [
              { value: pack.folders, label: t.folders(pack.folders) },
              { value: pack.pages, label: t.pages(pack.pages) },
              { value: pack.controlled, label: t.controlled(pack.controlled) },
              { value: pack.templates, label: t.templates(pack.templates) },
            ].filter((count) => count.value > 0);
            return (
              <Card key={`${pack.pluginId}/${pack.id}`} className="flex flex-col p-0">
                <div className="grid flex-1 content-start gap-3 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground">
                      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold leading-tight">{pack.name}</h2>
                      {installed && (
                        <Badge tone="success" className="mt-1.5 inline-flex items-center gap-1">
                          <Check className="size-3" aria-hidden="true" />
                          {t.installedAt(formatShortDate(pack.installedAt ?? ""))}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{pack.description}</p>
                  <ul className="flex flex-wrap gap-1.5" aria-label={t.contents}>
                    {counts.map((count) => (
                      <li key={count.label} className="v-badge">
                        {count.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex justify-end border-t border-border px-4 py-3 sm:px-5">
                  <Button
                    size="sm"
                    variant={installed ? "outline" : "primary"}
                    onClick={() => {
                      setInstalling(pack);
                    }}
                  >
                    {installed ? t.installAgain : t.install}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {installing !== null && (
        <InstallPackDialog
          slug={slug}
          pack={installing}
          onClose={() => {
            setInstalling(null);
          }}
        />
      )}
    </div>
  );
}

function useWritableSpaces(slug: string): ComboboxSource {
  return useMemo<ComboboxSource>(() => {
    const optionOf = (space: SpaceView) => ({
      id: space.id,
      label: space.name,
      disabled: !canEdit(space.level),
      ...(space.department === null ? {} : { description: space.department.name }),
    });
    return {
      key: ["w", slug, "templates", "space-options"],
      search: async (q, cursor, signal) => {
        const page = await filesApi.spaces(
          slug,
          { ...(q === "" ? {} : { q }), ...(cursor === undefined ? {} : { cursor }), sort: "name" },
          signal,
        );
        return { items: page.items.map(optionOf), nextCursor: page.nextCursor };
      },
      byIds: async () => Promise.resolve([]),
    };
  }, [slug]);
}

function InstallPackDialog({
  slug,
  pack,
  onClose,
}: {
  slug: string;
  pack: PackView;
  onClose: () => void;
}) {
  const t = texts.templates.packs;
  const membership = useMembership();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const spaces = useWritableSpaces(slug);
  const [space, setSpace] = useState<{ id: string; label: string } | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);
  const canDepartments = membership.capabilities.includes("departments.manage");
  const canTypes = membership.capabilities.includes("workspace.settings");
  const missingTypes = pack.documentTypes.filter((type) => !type.exists);
  const install = useMutation({
    mutationFn: (spaceId: string) =>
      templatesApi.install(slug, pack, { spaceId, parentId: null, departments }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: templateKeys.all(slug) });
      void queryClient.invalidateQueries({ queryKey: ["w", slug, "files"] });
      toast.success(t.done(pack.name), {
        ...(created.controlledSkipped > 0
          ? { description: texts.templates.use.controlledSkipped(created.controlledSkipped) }
          : {}),
      });
      onClose();
      void navigate(createdPath(slug, created.node));
    },
    onError: (error) => {
      toast.error(errorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.installTitle(pack.name)}
        description={pack.description}
        size="lg"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={install.isPending}>
                {texts.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={install.isPending || space === null}
              onClick={() => {
                if (space !== null) install.mutate(space.id);
              }}
            >
              {install.isPending ? texts.templates.installing : t.submit}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {pack.installedAt !== null && <Banner tone="info">{t.again}</Banner>}
          <FormField label={t.space} hint={t.spaceHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                label={t.space}
                placeholder={t.space}
                source={spaces}
                value={space?.id ?? null}
                valueLabel={space?.label}
                onChange={(option) => {
                  setSpace(option === null ? null : { id: option.id, label: option.label });
                }}
              />
            )}
          </FormField>
          {pack.documentTypes.length > 0 && (
            <div>
              <p className="v-label mb-1">{t.types}</p>
              <ul className="grid gap-1 text-sm">
                {pack.documentTypes.map((type) => (
                  <li key={type.code}>
                    <span className="font-medium">{type.code}</span> {type.name}{" "}
                    <span className="text-muted-foreground">
                      ({type.exists ? t.typeExists : t.typeNew})
                    </span>
                  </li>
                ))}
              </ul>
              {missingTypes.length > 0 && !canTypes && (
                <p className="mt-1 text-sm text-muted-foreground">{t.typesNoPermission}</p>
              )}
            </div>
          )}
          {pack.departments.length > 0 && (
            <fieldset className="grid gap-2">
              <legend className="v-label mb-1">{t.departments}</legend>
              <p className="text-sm text-muted-foreground">
                {canDepartments ? t.departmentsHint : t.departmentsNoPermission}
              </p>
              {pack.departments.map((department) => (
                <Checkbox
                  key={department.name}
                  disabled={!canDepartments || department.exists}
                  checked={departments.includes(department.name)}
                  onChange={(event) => {
                    setDepartments((current) =>
                      event.target.checked
                        ? [...current, department.name]
                        : current.filter((name) => name !== department.name),
                    );
                  }}
                  label={
                    department.exists
                      ? `${department.name} (${t.departmentExists})`
                      : department.name
                  }
                />
              ))}
            </fieldset>
          )}
          <div>
            <p className="v-label mb-1">{texts.templates.use.preview}</p>
            <ul className="max-h-64 overflow-auto rounded-md border border-border p-2">
              <TemplateOutline node={pack.outline} />
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
