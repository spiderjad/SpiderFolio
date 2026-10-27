// Piezas compartidas de las vistas agrupadas de Miembros ("Por departamento" y "Organigrama"):
// fila de persona con sus insignias de rol y de cargo, lista con "Ver más" que pide la página
// siguiente al servidor, menú de acciones (nombrar jefe o subjefe, quitar el cargo, mover) y los
// diálogos de cargo y de mover.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  MoreHorizontal,
  Star,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { undoToast } from "@/components/ui/undo-toast";
import { Avatar, Badge } from "@/components/ui/display";
import { InfiniteList } from "@/components/ui/infinite";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { FormField, FormGrid } from "@/components/ui/form";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { adminApi, adminKeys, type DepartmentPosition, type PersonData } from "../api";
import { adminErrorText } from "../admin-utils";
import { useCanEditPeople } from "../guards";
import { memberOption, useDepartmentSource } from "../sources";
import { customRoleName, PositionBadges, RoleBadge } from "./role-badge";
import { texts } from "@/i18n";

/** Personas que trae cada bloque; "Ver más" pide de a tantas. */
export const PREVIEW = 5;

/** Departamento sobre el que se actúa (lo mínimo que necesitan los diálogos). */
export interface DepartmentRef {
  id: string;
  name: string;
}

// ─── Fila de persona ─────────────────────────────────────────────────────────────────────

/**
 * Una persona en una fila de 56 px con su insignia de rol y, aparte, la de cargo (el ámbar queda
 * solo en la insignia "★ Jefe": la fila no se resalta). Con `departmentId` solo se muestra el
 * cargo de ese departamento; sin él, todos los que tenga. `highlight` marca al resultado de una
 * búsqueda.
 */
/** Si hay un proveedor, tocar el nombre de una persona abre su ficha (ej. en Miembros). */
export const PersonOpenContext = createContext<((person: PersonData) => void) | null>(null);

export function PersonRow({
  member,
  departmentId,
  trailing,
  highlight = false,
}: {
  member: PersonData;
  departmentId?: string;
  trailing?: ReactNode;
  highlight?: boolean;
}) {
  const t = texts.admin.members;
  const custom = customRoleName(member);
  const openPerson = useContext(PersonOpenContext);
  return (
    <div
      data-highlight={highlight || undefined}
      className={cn(
        "flex min-h-14 items-center justify-between gap-3 px-4 py-1.5 sm:px-6",
        highlight && "bg-primary-soft/40 ring-1 ring-inset ring-primary/40",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={member.name} src={member.avatarUrl} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {openPerson === null ? (
              <span className="truncate">{member.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  openPerson(member);
                }}
                className="truncate rounded-md text-left hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {member.name}
              </button>
            )}
            {member.isSelf && <Badge tone="primary">{t.you}</Badge>}
            {member.status === "SUSPENDED" && <Badge tone="warning">{t.status.SUSPENDED}</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[member.jobTitle, custom, member.status === null ? null : (member.email ?? t.noEmail)]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <PositionBadges member={member} {...(departmentId === undefined ? {} : { departmentId })} />
        {member.roleBase !== null && member.seatType !== null && (
          <RoleBadge member={{ roleBase: member.roleBase, seatType: member.seatType }} />
        )}
        {trailing}
      </div>
    </div>
  );
}

// ─── Lista con scroll infinito ───────────────────────────────────────────────────────────

/**
 * Personas de un área o de "Sin departamento": las primeras ya vienen en el bloque y el resto se
 * pide por cursor (carga automática al llegar al final, "Cargar más" de respaldo y "Mostrando N
 * de M"). Con muchas filas se virtualizan.
 */
export function MoreList({
  initial,
  total,
  nextCursor,
  fetchPage,
  renderRow,
}: {
  initial: PersonData[];
  total: number;
  nextCursor: string | null;
  fetchPage: (cursor: string) => Promise<{ items: PersonData[]; nextCursor: string | null }>;
  renderRow: (member: PersonData) => ReactNode;
}) {
  const [extra, setExtra] = useState<PersonData[]>([]);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const loadMore = async () => {
    if (cursor === null || loading) return;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setExtra((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      toast.error(adminErrorText(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <InfiniteList
      items={[...initial, ...extra]}
      getKey={(member) => member.id}
      renderItem={renderRow}
      maxHeightClass="max-h-[28rem]"
      paging={{
        total,
        hasNextPage: cursor !== null,
        isFetchingNextPage: loading,
        onLoadMore: () => void loadMore(),
      }}
    />
  );
}

// ─── Acciones ────────────────────────────────────────────────────────────────────────────

export interface PersonActionHandlers {
  onPosition: (target: {
    department: DepartmentRef;
    position: "HEAD" | "DEPUTY";
    member: PersonData | null;
  }) => void;
  onMove: (target: { member: PersonData; from: DepartmentRef }) => void;
}

/** Menú de una persona dentro de un departamento: cargo y mover. Solo con departments.manage. */
export function PersonActions({
  member,
  department,
  handlers,
}: {
  member: PersonData;
  department: DepartmentRef;
  handlers: PersonActionHandlers;
}) {
  const t = texts.admin.members.byDepartment;
  const c = t.confirmRemovePosition;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const canManage = useCanEditPeople();
  const current = member.departments.find((d) => d.id === department.id)?.position ?? "MEMBER";

  const [confirming, setConfirming] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
  const setPosition = (position: DepartmentPosition) =>
    adminApi.setDepartmentPosition(workspaceSlug, department.id, member.id, { position });
  const clearPosition = async () => {
    if (current === "MEMBER") return;
    const previous = current;
    await setPosition("MEMBER");
    await refresh();
    undoToast(t.assign.removed, async () => {
      await setPosition(previous);
      await refresh();
    });
  };

  if (!canManage) return null;
  const item = (icon: LucideIcon, label: string, run: () => void, disabled = false) => {
    const Icon = icon;
    return (
      <DropdownMenuItem disabled={disabled} onSelect={run}>
        <Icon aria-hidden="true" />
        {label}
      </DropdownMenuItem>
    );
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={texts.admin.members.rowActions(member.name)}>
            <MoreHorizontal strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {current !== "HEAD" &&
            item(Star, t.makeHead, () => {
              handlers.onPosition({ department, position: "HEAD", member });
            })}
          {current === "MEMBER" &&
            item(UserPlus, t.makeDeputy, () => {
              handlers.onPosition({ department, position: "DEPUTY", member });
            })}
          {current !== "MEMBER" &&
            item(UserMinus, t.removePosition, () => {
              setConfirming(true);
            })}
          {item(ArrowRightLeft, t.move, () => {
            handlers.onMove({ member, from: department });
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {current !== "MEMBER" && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          icon={UserMinus}
          tone="warning"
          title={c.title(member.name, current, department.name)}
          description={c.text(current)}
          confirmLabel={c.action(current)}
          pendingLabel={c.pending}
          onConfirm={clearPosition}
        />
      )}
    </>
  );
}

// ─── Diálogo de cargo ────────────────────────────────────────────────────────────────────

export interface PositionTarget {
  department: DepartmentRef;
  position: "HEAD" | "DEPUTY";
  /** La persona ya elegida (desde su menú); sin ella se elige de la lista del departamento. */
  member: PersonData | null;
}

export function PositionDialog({
  target,
  onClose,
}: {
  target: PositionTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && (
        <PositionForm
          key={`${target.department.id}:${target.position}:${target.member?.id ?? ""}`}
          target={target}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function PositionForm({ target, onClose }: { target: PositionTarget; onClose: () => void }) {
  const t = texts.admin.members.byDepartment.assign;
  const { department, position } = target;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<PersonData | null>(target.member);

  // Las personas del departamento, buscadas en el servidor y de a páginas. Se recuerdan las que
  // llegaron para tener sus datos (plaza, rol) al elegir.
  const seen = useRef(new Map<string, PersonData>());
  const source = useMemo<ComboboxSource>(
    () => ({
      key: [...adminKeys.department(workspaceSlug, department.id), "candidates", position],
      search: async (q, cursor) => {
        const result = await adminApi.departmentMembers(workspaceSlug, department.id, {
          q,
          cursor,
          pageSize: COMBO_PAGE_SIZE,
        });
        const items = result.items.filter(
          (member) =>
            member.status === "ACTIVE" &&
            !member.managedDepartments.some(
              (d) => d.id === department.id && d.position === position,
            ),
        );
        for (const member of items) seen.current.set(member.id, member);
        return {
          items: items.map(memberOption),
          nextCursor: result.nextCursor,
        };
      },
      byIds: (ids) =>
        Promise.resolve(
          ids.flatMap((id) => {
            const member = seen.current.get(id);
            return member === undefined ? [] : [memberOption(member)];
          }),
        ),
    }),
    [workspaceSlug, department.id, position],
  );

  const assign = useMutation({
    mutationFn: (member: PersonData) =>
      adminApi.setDepartmentPosition(workspaceSlug, department.id, member.id, { position }),
    onSuccess: async (result, member) => {
      toast.success(position === "HEAD" ? t.doneHead(member.name) : t.doneDeputy(member.name));
      // Un lector no puede tener capacidades: se avisa que hace falta plaza completa.
      if (result.needsFullSeat) toast.warning(t.needsFullSeat(member.name));
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const title = position === "HEAD" ? t.titleHead(department.name) : t.titleDeputy(department.name);
  return (
    <DialogContent
      title={title}
      description={target.member === null ? t.description : target.member.name}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={assign.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={assign.isPending || picked === null}
            onClick={() => {
              if (picked !== null) assign.mutate(picked);
            }}
          >
            {assign.isPending ? t.pending : t.submit}
          </Button>
        </>
      }
    >
      <FormGrid>
        {target.member === null && (
          <FormField label={t.person}>
            {(control) => (
              <Combobox
                id={control.id}
                label={t.person}
                placeholder={t.search}
                source={source}
                value={picked?.id ?? null}
                valueLabel={picked?.name}
                onChange={(option) => {
                  setPicked(option === null ? null : (seen.current.get(option.id) ?? null));
                }}
              />
            )}
          </FormField>
        )}
        {picked !== null && picked.seatType === "READER" && (
          <p
            role="status"
            className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground"
          >
            {t.readerWarning(picked.name)}
          </p>
        )}
      </FormGrid>
    </DialogContent>
  );
}

// ─── Diálogo de mover ────────────────────────────────────────────────────────────────────

export interface MoveTarget {
  member: PersonData;
  from: DepartmentRef;
}

export function MoveMemberDialog({
  target,
  onClose,
}: {
  target: MoveTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && (
        <MoveMemberForm member={target.member} from={target.from} onClose={onClose} />
      )}
    </Dialog>
  );
}

function MoveMemberForm({
  member,
  from,
  onClose,
}: {
  member: PersonData;
  from: DepartmentRef;
  onClose: () => void;
}) {
  const t = texts.admin.members.byDepartment.moveDialog;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const source = useDepartmentSource(workspaceSlug, { exclude: [from.id] });
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
  const value = target?.id ?? "";

  const move = useMutation({
    mutationFn: () => adminApi.moveDepartmentMember(workspaceSlug, from.id, member.id, value),
    onSuccess: async () => {
      toast.success(t.done(member.name, target?.label ?? ""));
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <DialogContent
      title={t.title(member.name)}
      description={t.description(from.name)}
      size="md"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={move.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={move.isPending || value === ""}
            onClick={() => {
              move.mutate();
            }}
          >
            {move.isPending ? t.pending : t.submit}
          </Button>
        </>
      }
    >
      <FormField label={t.to}>
        {(control) => (
          <Combobox
            id={control.id}
            aria-invalid={control["aria-invalid"]}
            aria-describedby={control["aria-describedby"]}
            label={t.to}
            placeholder={t.toPlaceholder}
            source={source}
            value={target?.id ?? null}
            valueLabel={target?.label}
            onChange={(option) => {
              setTarget(option === null ? null : { id: option.id, label: option.label });
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

/** Estado de los diálogos de las vistas agrupadas, para no repetirlo en cada vista. */
export function usePeopleDialogs() {
  const [positioning, setPositioning] = useState<PositionTarget | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const handlers: PersonActionHandlers = {
    onPosition: setPositioning,
    onMove: setMoving,
  };
  const dialogs = (
    <>
      <PositionDialog
        target={positioning}
        onClose={() => {
          setPositioning(null);
        }}
      />
      <MoveMemberDialog
        target={moving}
        onClose={() => {
          setMoving(null);
        }}
      />
    </>
  );
  return { handlers, dialogs, openPosition: setPositioning };
}

export type { DepartmentPosition };
