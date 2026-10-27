// /app/:slug/admin/members — Miembros (CLAUDE.md, sección 9.3): tabla con búsqueda, filtros, orden
// y paginación del lado del servidor, selección múltiple con acciones masivas, invitar e importar.
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  KeyRound,
  KeySquare,
  MoreHorizontal,
  Pencil,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type SortState } from "@/components/ui/data-table";
import { useInfiniteList } from "@/components/ui/infinite";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui/display";
import { Combobox, useStaticSource, type ComboOption } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoToast } from "@/components/ui/undo-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { useMembership } from "@/features/home/workspace-layout";
import { useAuth } from "@/auth/auth-context";
import { ConfirmCodeDialog } from "@/features/profile/two-factor-section";
import { ApiError } from "@/lib/api";
import { FILTER_SELECT_CLASS, FilterBar, SearchField } from "@/components/ui/filter-bar";
import { formatDateTime } from "@/lib/utils";
import { adminApi, adminKeys, type MemberGroup, type MemberQuery, type MemberView } from "../api";
import {
  adminErrorText,
  loadErrorIcon,
  loadErrorText,
  downloadTextFile,
  limitReachedOf,
  type LimitReachedDetails,
} from "../admin-utils";
import { memberStatusChoices } from "../choices";
import { useCan, useOwnScope } from "../guards";
import { LimitReachedDialog } from "../limit-dialog";
import { baseRank, canAssignRole } from "../lookups";
import { useDepartmentSource, useRoleSource } from "../sources";
import { SeatMeters } from "../seat-meters";
import { BulkBar } from "./bulk-bar";
import { EditMemberDialog } from "./edit-member-dialog";
import { ImportDialog } from "./import-dialog";
import { InvitationsCard } from "./invitations-card";
import { InviteDialog } from "./invite-dialog";
import {
  CreatePinMemberDialog,
  PinRevealDialog,
  ResetPinDialog,
  type RevealedPin,
} from "./pin-dialogs";
import { PinSettingsCard } from "./pin-settings-card";
import { customRoleName, DepartmentChip, RoleBadge } from "./role-badge";
import { RoleSelect } from "./role-select";
import { SummaryCards } from "./summary-cards";
import { PersonOpenContext } from "./people";
import { StructureReview } from "./structure-review";
import { OrgChartScreen } from "../departments/department-workspace";
import { texts } from "@/i18n";

const SORTABLE = ["hierarchy", "name", "status", "lastSeenAt"] as const;
const GROUPS = ["owner", "admins", "managers", "members", "readers"] as const;

/** Valor de la opción "Jefes de departamento" del filtro de rol (es un grupo, no un rol). */
const MANAGERS_OPTION = "group:managers";
const PAGE_SIZE = 25;

function readQuery(params: URLSearchParams): MemberQuery {
  const status = params.get("status");
  const sort = params.get("sort") ?? "hierarchy";
  const group = GROUPS.find((candidate) => candidate === params.get("group"));
  return {
    q: params.get("q") ?? "",
    role: params.get("role") ?? "",
    department: params.get("department") ?? "",
    group: group ?? "",
    status: status === "ACTIVE" || status === "SUSPENDED" ? status : "",
    pageSize: PAGE_SIZE,
    sort: (SORTABLE as readonly string[]).includes(sort) ? sort : "hierarchy",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
}

/** Email o, para quien entra con PIN, su usuario. */
function contactOf(member: MemberView): string {
  if (member.email !== null) return member.email;
  return member.loginName === null ? texts.admin.members.noEmail : `@${member.loginName}`;
}

type ConfirmKind = "suspend" | "reactivate" | "revokeSessions" | "resetTwoFactor" | "remove";

export function MembersPage() {
  const t = texts.admin.members;
  const { workspaceSlug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const membership = useMembership();
  // Jefe y subjefe invitan a su área si el workspace lo permite (el servidor decide).
  const ownScope = useOwnScope();
  const canInvite = useCan("members.invite") || ownScope;
  const canImport = useCan("members.invite") && !ownScope;
  const canManage = useCan("members.manage");
  const canSuspend = useCan("members.suspend");
  const canPin = useCan("members.pin");
  const { account } = useAuth();
  const ownTwoFactor = account?.user.twoFactor === true;
  const [resetAfterCode, setResetAfterCode] = useState<MemberView | null>(null);
  // La opción "Jefes de departamento" es un grupo, no un rol: va fija arriba del filtro de rol.
  const pinnedGroups = useMemo<ComboOption[]>(
    () => [{ id: MANAGERS_OPTION, label: t.filters.managers }],
    [t],
  );
  const roleSource = useRoleSource(workspaceSlug, { pinned: pinnedGroups });
  const departmentSource = useDepartmentSource(workspaceSlug);
  // El selector de rol de cada fila solo ofrece los roles que quien mira puede asignar.
  const actor = useMemo(
    () => ({ base: membership.role.base, capabilities: membership.capabilities }),
    [membership.role.base, membership.capabilities],
  );
  const assignRoleSource = useRoleSource(workspaceSlug, {
    accept: (role) => canAssignRole(role, actor),
  });
  const statusSource = useStaticSource("member-status", memberStatusChoices);

  // Lista (por defecto) u organigrama (el mismo de Departamentos), en la URL.
  const view = params.get("vista") === "organigrama" ? "organigrama" : "lista";
  const openFicha = async (person: { id: string }) => {
    try {
      setEditing((await adminApi.member(workspaceSlug, person.id)).member);
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };

  const query = readQuery(params);
  const [search, setSearch] = useState(query.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MemberView | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; member: MemberView } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creatingPin, setCreatingPin] = useState(false);
  const [resettingPin, setResettingPin] = useState<MemberView | null>(null);
  const [revealed, setRevealed] = useState<RevealedPin | null>(null);
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  const update = (changes: Partial<Record<keyof MemberQuery, string | number>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === "") next.delete(key);
      else next.set(key, String(value));
    }
    // Cualquier cambio que no sea de página vuelve a la primera.
    if (changes.page === undefined) next.delete("page");
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(() => {
      update({ q: search.trim() });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
    // update depende de params: solo reaccionamos al texto de búsqueda.
  }, [search]);

  // Scroll infinito por cursor: los filtros y el orden (en la URL) arman la clave, y al cambiarlos
  // la lista vuelve a empezar.
  const list = useInfiniteList<MemberView>({
    queryKey: adminKeys.members(workspaceSlug, query),
    fetchPage: (cursor, signal) => adminApi.members(workspaceSlug, { ...query, cursor }, signal),
  });

  const exportCsv = useMutation({
    mutationFn: () => adminApi.exportMembers(workspaceSlug, query),
    onSuccess: (result) => {
      downloadTextFile(result.filename, result.csv);
      toast.success(t.exportDone(result.rows));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
  const actorRank = baseRank[membership.role.base];
  // Igual que el servidor: el propietario puede con todos; el resto, solo con quien está por debajo.
  const manageable = (member: MemberView) =>
    membership.role.base === "OWNER" || baseRank[member.roleBase] < actorRank;

  const runConfirm = async () => {
    if (confirm === null) return;
    const { kind, member } = confirm;
    try {
      if (kind === "suspend") {
        await adminApi.suspendMember(workspaceSlug, member.id);
        undoToast(t.toasts.suspended, async () => {
          await adminApi.reactivateMember(workspaceSlug, member.id);
          await refresh();
        });
      } else if (kind === "reactivate") {
        await adminApi.reactivateMember(workspaceSlug, member.id);
        toast.success(t.toasts.reactivated);
      } else if (kind === "remove") {
        await adminApi.removeMember(workspaceSlug, member.id);
        toast.success(t.toasts.removed);
      } else if (kind === "resetTwoFactor") {
        try {
          await adminApi.resetTwoFactor(workspaceSlug, member.id);
        } catch (error) {
          // Hay que confirmar el código propio: se pide y se reintenta.
          if (error instanceof ApiError && error.code === "MFA_RECENT_REQUIRED") {
            setConfirm(null);
            setResetAfterCode(member);
            return;
          }
          throw error;
        }
        toast.success(t.toasts.twoFactorReset);
      } else {
        const { revoked } = await adminApi.revokeSessions(workspaceSlug, member.id);
        toast.success(t.toasts.sessionsRevoked(revoked));
      }
      await refresh();
    } catch (error) {
      // Si el servidor respondiera con un límite: se cierra la confirmación y sale el diálogo.
      const reached = limitReachedOf(error);
      if (reached === null) throw error;
      setLimit(reached);
    }
  };

  const columns = useMemo<ColumnDef<MemberView>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        enableSorting: true,
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={member.name} src={member.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {member.name}
                  {member.isSelf && (
                    <Badge tone="primary" className="ml-2 align-middle">
                      {t.you}
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.jobTitle === null
                    ? contactOf(member)
                    : `${member.jobTitle} · ${contactOf(member)}`}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: t.columns.role,
        enableSorting: true,
        cell: ({ row }) => {
          const member = row.original;
          if (canManage && manageable(member) && !member.isSelf) {
            return <RoleSelect member={member} source={assignRoleSource} onChanged={refresh} />;
          }
          const custom = customRoleName(member);
          return (
            <div className="flex flex-col items-start gap-1">
              <RoleBadge member={member} />
              {custom !== null && <span className="text-xs text-muted-foreground">{custom}</span>}
            </div>
          );
        },
      },
      {
        id: "departments",
        header: t.columns.departments,
        cell: ({ row }) =>
          row.original.departments.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.departments.map((department) => (
                <DepartmentChip key={department.id} department={department} />
              ))}
            </div>
          ),
      },
      {
        id: "seat",
        header: t.columns.seat,
        cell: ({ row }) => (
          <Badge tone={row.original.seatType === "FULL" ? "primary" : "neutral"}>
            {t.seat[row.original.seatType]}
          </Badge>
        ),
      },
      {
        id: "status",
        header: t.columns.status,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Badge tone={row.original.status === "ACTIVE" ? "success" : "warning"}>
              {t.status[row.original.status]}
            </Badge>
            {row.original.pinLocked && <Badge tone="danger">{texts.admin.pin.locked}</Badge>}
          </div>
        ),
      },
      {
        id: "twoFactor",
        header: t.columns.twoFactor,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.twoFactor ? (
            <Badge tone="success" title={t.twoFactor.onLabel}>
              {t.twoFactor.on}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{t.twoFactor.off}</span>
          ),
      },
      {
        id: "lastSeenAt",
        header: t.columns.lastSeen,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.lastSeenAt === null
              ? texts.admin.common.never
              : formatDateTime(row.original.lastSeenAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{texts.admin.common.actions}</span>,
        cell: ({ row }) => {
          const member = row.original;
          const canEdit = canManage && manageable(member);
          const canToggle = canSuspend && manageable(member) && !member.isSelf;
          const canRemove = canManage && manageable(member) && !member.isSelf;
          const canRevoke = canSuspend && manageable(member);
          const canResetPin = canPin && member.kind === "PIN" && manageable(member);
          const canResetTwoFactor =
            canManage && member.twoFactor && !member.isSelf && manageable(member);
          if (
            !canEdit &&
            !canToggle &&
            !canRemove &&
            !canRevoke &&
            !canResetPin &&
            !canResetTwoFactor
          ) {
            return null;
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t.rowActions(member.name)}>
                  <MoreHorizontal strokeWidth={1.75} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(member);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    {t.actions.edit}
                  </DropdownMenuItem>
                )}
                {canToggle && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setConfirm({
                        kind: member.status === "ACTIVE" ? "suspend" : "reactivate",
                        member,
                      });
                    }}
                  >
                    {member.status === "ACTIVE" ? (
                      <UserX aria-hidden="true" />
                    ) : (
                      <UserCheck aria-hidden="true" />
                    )}
                    {member.status === "ACTIVE" ? t.actions.suspend : t.actions.reactivate}
                  </DropdownMenuItem>
                )}
                {canResetPin && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setResettingPin(member);
                    }}
                  >
                    <KeySquare aria-hidden="true" />
                    {texts.admin.pin.resetAction}
                  </DropdownMenuItem>
                )}
                {canResetTwoFactor && (
                  <DropdownMenuItem
                    disabled={!ownTwoFactor}
                    title={ownTwoFactor ? undefined : t.actions.resetTwoFactorNeedsOwn}
                    onSelect={() => {
                      setConfirm({ kind: "resetTwoFactor", member });
                    }}
                  >
                    <ShieldOff aria-hidden="true" />
                    {t.actions.resetTwoFactor}
                  </DropdownMenuItem>
                )}
                {canRevoke && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setConfirm({ kind: "revokeSessions", member });
                    }}
                  >
                    <KeyRound aria-hidden="true" />
                    {t.actions.revokeSessions}
                  </DropdownMenuItem>
                )}
                {canRemove && (
                  <DropdownMenuItem
                    className="text-danger"
                    onSelect={() => {
                      setConfirm({ kind: "remove", member });
                    }}
                  >
                    <UserMinus aria-hidden="true" />
                    {t.actions.remove}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // manageable depende de actorRank
    [t, canManage, canSuspend, canPin, actorRank, assignRoleSource, ownTwoFactor],
  );

  // La columna Rol ordena por jerarquía (propietario, administradores, jefes y el resto).
  const sort: SortState = {
    id: query.sort === "hierarchy" ? "role" : query.sort,
    desc: query.dir === "desc",
  };
  const filtered =
    query.q !== "" ||
    query.role !== "" ||
    query.department !== "" ||
    query.group !== "" ||
    query.status !== "";
  const confirmText = confirm === null ? null : t.confirm[confirm.kind];

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ownScope ? t.teamTitle : t.title}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {ownScope ? t.teamSubtitle : t.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={exportCsv.isPending}
            onClick={() => {
              exportCsv.mutate();
            }}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            {t.exportCsv}
          </Button>
          {canPin && (
            <Button
              variant="outline"
              onClick={() => {
                setCreatingPin(true);
              }}
            >
              <KeySquare strokeWidth={1.75} aria-hidden="true" />
              {texts.admin.pin.createButton}
            </Button>
          )}
          {canImport && (
            <Button
              variant="outline"
              onClick={() => {
                setImporting(true);
              }}
            >
              <Upload strokeWidth={1.75} aria-hidden="true" />
              {t.importCsv}
            </Button>
          )}
          {canInvite && (
            <>
              <Button
                onClick={() => {
                  setInviting(true);
                }}
              >
                <UserPlus strokeWidth={1.75} aria-hidden="true" />
                {t.invite}
              </Button>
            </>
          )}
        </div>
      </div>

      <div
        role="group"
        aria-label={t.views.label}
        className="inline-flex w-fit rounded-lg border border-border p-0.5"
      >
        {(["lista", "organigrama"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => {
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  if (value === "lista") next.delete("vista");
                  else next.set("vista", value);
                  return next;
                },
                { replace: true },
              );
            }}
            className="h-8 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
          >
            {value === "lista" ? t.views.list : t.views.orgChart}
          </button>
        ))}
      </div>

      {view === "organigrama" ? (
        <PersonOpenContext.Provider value={(person) => void openFicha(person)}>
          <StructureReview />
          <OrgChartScreen />
        </PersonOpenContext.Provider>
      ) : (
        <>
          {!ownScope && <SeatMeters />}

          <SummaryCards
            active={query.group === "" ? "" : (query.group as MemberGroup)}
            onSelect={(group) => {
              update({ group, role: "" });
            }}
          />

          <Card className="overflow-hidden">
            <FilterBar className="border-b border-border p-4">
              <SearchField
                placeholder={t.searchPlaceholder}
                label={texts.admin.common.search}
                value={search}
                onChange={setSearch}
              />
              <Combobox
                compact
                className={FILTER_SELECT_CLASS}
                clearable
                label={t.filters.role}
                placeholder={`${t.filters.role}: ${texts.admin.common.all}`}
                source={roleSource}
                value={
                  query.group === "managers"
                    ? MANAGERS_OPTION
                    : query.role === ""
                      ? null
                      : query.role
                }
                onChange={(option) => {
                  if (option === null) update({ role: "", group: "" });
                  else if (option.id === MANAGERS_OPTION) update({ group: "managers", role: "" });
                  else update({ role: option.id, group: "" });
                }}
              />
              <Combobox
                compact
                className={FILTER_SELECT_CLASS}
                clearable
                label={t.filters.department}
                placeholder={`${t.filters.department}: ${texts.admin.common.all}`}
                source={departmentSource}
                value={query.department === "" ? null : query.department}
                onChange={(option) => {
                  update({ department: option?.id ?? "" });
                }}
              />
              <Combobox
                compact
                className={FILTER_SELECT_CLASS}
                clearable
                searchable={false}
                label={t.filters.status}
                placeholder={`${t.filters.status}: ${texts.admin.common.all}`}
                source={statusSource}
                value={query.status === "" ? null : query.status}
                onChange={(option) => {
                  update({ status: option?.id ?? "" });
                }}
              />
            </FilterBar>

            {selected.size > 0 && (
              <BulkBar
                selectedIds={selected}
                onDone={() => {
                  setSelected(new Set());
                }}
              />
            )}

            {list.query.isError && list.query.data === undefined ? (
              <EmptyState
                icon={loadErrorIcon(list.query.error)}
                title={texts.admin.common.loadError}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      void list.query.refetch();
                    }}
                  >
                    {texts.common.retry}
                  </Button>
                }
              >
                {loadErrorText(list.query.error)}
              </EmptyState>
            ) : (
              <>
                <DataTable
                  label={t.title}
                  columns={columns}
                  data={list.items}
                  getRowId={(member) => member.id}
                  loading={list.query.isPending}
                  paging={{
                    total: list.total,
                    hasNextPage: list.query.hasNextPage,
                    isFetchingNextPage: list.query.isFetchingNextPage,
                    onLoadMore: list.loadMore,
                  }}
                  sort={sort}
                  onSortChange={(next) => {
                    update({
                      sort: next.id === "role" ? "hierarchy" : next.id,
                      dir: next.desc ? "desc" : "asc",
                    });
                  }}
                  {...(canManage || canSuspend
                    ? {
                        selection: {
                          selectedIds: selected,
                          onChange: setSelected,
                          rowLabel: (member: MemberView) => t.selectRow(member.name),
                        },
                      }
                    : {})}
                  empty={
                    <EmptyState icon={Users} title={filtered ? t.noResults.title : t.empty.title}>
                      {filtered ? t.noResults.text : t.empty.text}
                    </EmptyState>
                  }
                />
              </>
            )}
          </Card>

          <InvitationsCard />

          {canPin && <PinSettingsCard />}
        </>
      )}

      <EditMemberDialog
        member={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
      <InviteDialog
        open={inviting}
        onClose={() => {
          setInviting(false);
        }}
      />
      <CreatePinMemberDialog
        open={creatingPin}
        onClose={() => {
          setCreatingPin(false);
        }}
        onCreated={setRevealed}
      />
      <ResetPinDialog
        member={resettingPin}
        onClose={() => {
          setResettingPin(null);
        }}
        onReset={setRevealed}
      />
      <PinRevealDialog
        revealed={revealed}
        onClose={() => {
          setRevealed(null);
        }}
      />
      <ImportDialog
        open={importing}
        onClose={() => {
          setImporting(false);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        icon={
          confirm?.kind === "reactivate"
            ? UserCheck
            : confirm?.kind === "revokeSessions"
              ? KeyRound
              : confirm?.kind === "resetTwoFactor"
                ? ShieldOff
                : UserMinus
        }
        title={
          confirm === null || confirmText === null ? "" : confirmText.title(confirm.member.name)
        }
        description={
          confirm === null || confirmText === null ? "" : confirmText.text(confirm.member.name)
        }
        confirmLabel={confirmText?.action ?? ""}
        pendingLabel={confirmText?.pending ?? ""}
        tone={
          confirm?.kind === "reactivate"
            ? "primary"
            : confirm?.kind === "remove"
              ? "destructive"
              : "warning"
        }
        {...(confirm?.kind === "remove" ? { requireText: confirm.member.name } : {})}
        onConfirm={runConfirm}
      />
      {resetAfterCode !== null && (
        <ConfirmCodeDialog
          onClose={() => {
            setResetAfterCode(null);
          }}
          onConfirmed={() => {
            const member = resetAfterCode;
            setResetAfterCode(null);
            void adminApi
              .resetTwoFactor(workspaceSlug, member.id)
              .then(async () => {
                toast.success(t.toasts.twoFactorReset);
                await refresh();
              })
              .catch((error: unknown) => {
                toast.error(adminErrorText(error));
              });
          }}
        />
      )}
      <LimitReachedDialog
        limit={limit}
        onClose={() => {
          setLimit(null);
        }}
      />
    </div>
  );
}
