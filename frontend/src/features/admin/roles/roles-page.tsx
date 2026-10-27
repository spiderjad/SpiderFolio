// /app/:slug/admin/roles — Roles y permisos (CLAUDE.md, secciones 9.1 a 9.3): roles de sistema
// (solo lectura) y personalizados, editor con capacidades agrupadas por área y vista de matriz.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import type { SystemRole } from "@/auth/types";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import { Combobox, useStaticSource, type ComboOption } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Switch, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { SearchField } from "@/components/ui/filter-bar";
import { cn } from "@/lib/utils";
import { roleKindChoices } from "../choices";
import { adminApi, adminKeys, type CapabilityInfo, type RoleQuery, type RoleView } from "../api";
import { adminErrorText, loadErrorIcon, loadErrorText } from "../admin-utils";
import { readChoice, useListParams, useSearchParam } from "../list-params";
import { texts } from "@/i18n";

type View = "list" | "matrix";
/** Los roles se piden de a páginas; la matriz muestra los de la página como columnas. */
const ROLES_PER_PAGE = 10;
const customBases = ["ADMIN", "MEMBER", "GUEST"] as const satisfies readonly SystemRole[];

/** Rol base de un rol personalizado: el nombre y, en una línea, lo que implica. */
const baseChoices: ComboOption[] = customBases.map((value) => ({
  id: value,
  label: texts.admin.roles.base[value],
  description: texts.admin.roles.baseHint[value],
}));

type CapabilityText = { label: string; description: string };

/** Texto de una capacidad del núcleo o, si es de un plugin, el que trae el plugin. */
function capabilityText(
  capability: string,
  plugins: readonly ({ id: string } & CapabilityText)[] = [],
): CapabilityText {
  return (
    (texts.capabilities as Record<string, CapabilityText | undefined>)[capability] ??
    plugins.find((p) => p.id === capability) ?? { label: capability, description: "" }
  );
}

function capabilityLabel(
  capability: string,
  plugins?: readonly ({ id: string } & CapabilityText)[],
) {
  return capabilityText(capability, plugins).label;
}

export function RolesPage() {
  const t = texts.admin.roles;
  const kindSource = useStaticSource("role-kind", roleKindChoices);
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { params, patch } = useListParams();
  const query: RoleQuery = {
    q: params.get("q") ?? "",
    kind: readChoice<"" | "system" | "custom">(params, "kind", ["system", "custom"], ""),
    pageSize: ROLES_PER_PAGE,
    sort: "level",
    dir: "asc",
  };
  const [search, setSearch] = useSearchParam("q", query.q, patch);
  const roles = useInfiniteList<RoleView>({
    queryKey: [...adminKeys.roles(workspaceSlug), query],
    fetchPage: (cursor) => adminApi.roles(workspaceSlug, { ...query, cursor }),
  });
  const info = useQuery({
    queryKey: adminKeys.capabilities(workspaceSlug),
    queryFn: () => adminApi.capabilities(workspaceSlug),
  });
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<RoleView | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);

  const list = roles.items;
  const filtered = query.q !== "" || query.kind !== "";
  const system = list.filter((role) => role.isSystem);
  const custom = list.filter((role) => !role.isSystem);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
            {(["list", "matrix"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => {
                  setView(value);
                }}
                className="h-8 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
              >
                {t.views[value]}
              </button>
            ))}
          </div>
          <Button
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <SearchField
          placeholder={t.searchPlaceholder}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        <Combobox
          clearable
          searchable={false}
          label={t.filters.kind}
          placeholder={t.filters.all}
          source={kindSource}
          value={query.kind === "" ? null : query.kind}
          onChange={(option) => {
            patch({ kind: option?.id ?? "" });
          }}
        />
      </div>

      {roles.query.isError && roles.query.data === undefined ? (
        <Card>
          <EmptyState
            icon={loadErrorIcon(roles.query.error)}
            title={texts.admin.common.loadError}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  void roles.query.refetch();
                }}
              >
                {texts.common.retry}
              </Button>
            }
          >
            {loadErrorText(roles.query.error)}
          </EmptyState>
        </Card>
      ) : roles.query.data === undefined || info.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={Lock} title={filtered ? t.noResults.title : t.customEmpty}>
            {filtered ? t.noResults.text : null}
          </EmptyState>
        </Card>
      ) : view === "matrix" ? (
        <Matrix roles={list} info={info.data} />
      ) : (
        <>
          {system.length > 0 && (
            <RoleSection title={t.system}>
              {system.map((role) => (
                <RoleCard key={role.id} role={role} />
              ))}
            </RoleSection>
          )}
          {(custom.length > 0 || query.kind !== "system") && (
            <RoleSection title={t.custom}>
              {custom.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.customEmpty}</p>
              ) : (
                custom.map((role) => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    onEdit={() => {
                      setEditing(role);
                    }}
                    onDelete={() => {
                      setDeleting(role);
                    }}
                  />
                ))
              )}
            </RoleSection>
          )}
        </>
      )}

      {/* Scroll infinito: al llegar al final se piden más roles; el botón es el respaldo. */}
      <LoadMore
        hasNextPage={roles.query.hasNextPage}
        isFetching={roles.query.isFetchingNextPage}
        onLoadMore={roles.loadMore}
      />
      {list.length > 0 && <ShownCounter shown={list.length} total={roles.total} />}

      <RoleDialog
        target={editing}
        info={info.data}
        onClose={() => {
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        icon={Trash2}
        title={deleting === null ? "" : t.confirmDelete.title(deleting.name)}
        description={deleting === null ? "" : t.confirmDelete.text(deleting.name)}
        confirmLabel={t.confirmDelete.action}
        pendingLabel={t.confirmDelete.pending}
        tone="destructive"
        onConfirm={async () => {
          if (deleting === null) return;
          await adminApi.deleteRole(workspaceSlug, deleting.id);
          toast.success(t.toasts.deleted);
          await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
        }}
      />
    </div>
  );
}

function RoleSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: RoleView;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const t = texts.admin.roles;
  return (
    <Card className="card-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            {role.name}
            {role.isSystem && (
              <Badge className="gap-1">
                <Lock className="size-3" strokeWidth={1.75} aria-hidden="true" />
                {t.systemBadge}
              </Badge>
            )}
          </CardTitle>
          {role.description !== null && (
            <p className="mt-1 text-xs text-muted-foreground">{role.description}</p>
          )}
        </div>
        {(onEdit !== undefined || onDelete !== undefined) && (
          <div className="flex shrink-0 gap-1">
            {onEdit !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${texts.admin.common.edit}: ${role.name}`}
                onClick={onEdit}
              >
                <Pencil strokeWidth={1.75} />
              </Button>
            )}
            {onDelete !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${texts.admin.common.delete}: ${role.name}`}
                onClick={onDelete}
              >
                <Trash2 strokeWidth={1.75} />
              </Button>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t.base[role.base]} · {t.members(role.memberCount)} ·{" "}
        {t.capabilities(role.capabilities.length)}
      </p>
      {role.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {role.capabilities.map((capability) => (
            <Badge key={capability} tone="primary">
              {capabilityLabel(capability)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function Matrix({ roles, info }: { roles: RoleView[]; info: CapabilityInfo | undefined }) {
  const t = texts.admin.roles;
  if (info === undefined) return null;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm" aria-label={t.views.matrix}>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="sticky left-0 bg-background px-4 py-3 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              {t.matrix.capability}
            </th>
            {roles.map((role) => (
              <th key={role.id} scope="col" className="px-3 py-3 text-center font-medium">
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {info.groups.map((group) => (
            <MatrixGroup key={group.id} group={group} roles={roles} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MatrixGroup({
  group,
  roles,
}: {
  group: CapabilityInfo["groups"][number];
  roles: RoleView[];
}) {
  return (
    <>
      <tr className="bg-muted/40">
        <th
          colSpan={roles.length + 1}
          scope="colgroup"
          className="sticky left-0 px-4 py-2 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
        >
          {texts.capabilityGroups[group.id as keyof typeof texts.capabilityGroups]}
        </th>
      </tr>
      {group.capabilities.map((capability) => (
        <tr key={capability} className="border-b border-border last:border-0">
          <th scope="row" className="sticky left-0 bg-background px-4 py-2 text-left font-normal">
            {capabilityLabel(capability)}
          </th>
          {roles.map((role) => {
            const has = role.capabilities.includes(capability);
            return (
              <td key={role.id} className="px-3 py-2 text-center">
                {has ? (
                  <span role="img" aria-label={`${role.name}: ${capabilityLabel(capability)}`}>
                    <Check
                      className="mx-auto size-4 text-primary"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </span>
                ) : (
                  <span aria-hidden="true" className="text-muted-foreground/50">
                    —
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RoleDialog({
  target,
  info,
  onClose,
}: {
  target: RoleView | "new" | null;
  info: CapabilityInfo | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && info !== undefined && (
        <RoleForm
          key={target === "new" ? "new" : target.id}
          role={target === "new" ? null : target}
          info={info}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function RoleForm({
  role,
  info,
  onClose,
}: {
  role: RoleView | null;
  info: CapabilityInfo;
  onClose: () => void;
}) {
  const t = texts.admin.roles;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const baseSource = useStaticSource("role-base", baseChoices);
  const [base, setBase] = useState<SystemRole>(role?.base ?? "MEMBER");
  const [selected, setSelected] = useState(new Set(role?.capabilities ?? []));
  const [error, setError] = useState<string | null>(null);
  const isGuest = base === "GUEST";

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        base,
        capabilities: isGuest ? [] : info.all.filter((capability) => selected.has(capability)),
      };
      return role === null
        ? adminApi.createRole(workspaceSlug, body)
        : adminApi.updateRole(workspaceSlug, role.id, body);
    },
    onSuccess: async () => {
      toast.success(role === null ? t.toasts.created : t.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });

  return (
    <DialogContent
      title={role === null ? t.form.createTitle : t.form.editTitle}
      size="lg"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={mutation.isPending || name.trim().length < 2}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending
              ? texts.admin.common.saving
              : role === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.name} error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.description}>
          {(control) => (
            <Textarea
              {...control}
              value={description}
              rows={2}
              maxLength={200}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.base}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={t.form.base}
              placeholder={t.form.base}
              searchable={false}
              source={baseSource}
              value={base}
              onChange={(option) => {
                if (option !== null) setBase(option.id as SystemRole);
              }}
            />
          )}
        </FormField>

        <div className="grid gap-4">
          <h3 className="text-sm font-medium">{t.form.capabilities}</h3>
          {isGuest && <p className="text-xs text-muted-foreground">{t.form.guestNoCapabilities}</p>}
          {info.groups.map((group) => (
            <fieldset key={group.id} className="grid gap-1" disabled={isGuest}>
              <legend className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {texts.capabilityGroups[group.id as keyof typeof texts.capabilityGroups]}
              </legend>
              {group.capabilities.map((capability) => {
                const grantable = info.grantable.includes(capability);
                const id = `cap-${capability}`;
                const text = capabilityText(capability, info.plugins);
                return (
                  <div
                    key={capability}
                    className={cn(
                      "flex items-start justify-between gap-4 rounded-lg px-2 py-2",
                      !grantable && "opacity-60",
                    )}
                  >
                    <label htmlFor={id} className="min-w-0 cursor-pointer">
                      <span className="block text-sm font-medium">{text.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {grantable ? text.description : t.form.notGrantable}
                      </span>
                    </label>
                    <Switch
                      id={id}
                      checked={!isGuest && selected.has(capability)}
                      disabled={isGuest || !grantable}
                      onCheckedChange={(checked) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(capability);
                          else next.delete(capability);
                          return next;
                        });
                      }}
                    />
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      </FormGrid>
    </DialogContent>
  );
}
