// «Compartir»: el único camino para dar, cambiar y quitar accesos de un espacio, carpeta, archivo o
// página, y para ver quién puede entrar y por qué. Departamentos primero, personas después. El
// servidor valida todo (nivel mínimo, lectores, herencia); acá solo se muestra.
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Building2, Link2Off, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Avatar, Badge, Skeleton } from "@/components/ui/display";
import { Checkbox, Input } from "@/components/ui/form";
import { LoadMore, ShownCounter } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi } from "@/features/admin/api";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi, type AccessLevel } from "@/features/files/api";
import { formatShortDate } from "@/lib/utils";
import {
  sharingApi,
  sharingKeys,
  type AccessExplanation,
  type GrantView,
  type PersonAccessView,
  type ShareTarget,
} from "./api";
import { reasonLine } from "./reasons";
import { texts } from "@/i18n";

const LEVELS: readonly AccessLevel[] = ["VIEW", "COMMENT", "EDIT", "MANAGE"];

/** Qué se comparte: el espacio o el nodo, con su nombre y el espacio al que pertenece. */
export interface ShareSubject extends ShareTarget {
  name: string;
  spaceId: string;
}

export function ShareDialog({
  subject,
  onClose,
}: {
  subject: ShareSubject | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {subject !== null && <ShareBody key={`${subject.type}:${subject.id}`} subject={subject} />}
    </Dialog>
  );
}

/** A toda la empresa se le da Ver, Comentar o Editar (nunca Gestionar). */
const COMPANY_LEVELS: readonly AccessLevel[] = ["VIEW", "COMMENT", "EDIT"];

function LevelSelect({
  value,
  label,
  disabled,
  levels = LEVELS,
  onChange,
}: {
  value: AccessLevel;
  label: string;
  disabled?: boolean;
  levels?: readonly AccessLevel[];
  onChange: (level: AccessLevel) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = levels.find((level) => level === event.target.value);
        if (next !== undefined) onChange(next);
      }}
      className="h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
    >
      {levels.map((level) => (
        <option key={level} value={level}>
          {texts.sharing.levels[level]}
        </option>
      ))}
    </select>
  );
}

/** «yyyy-mm-dd» del campo de fecha → fin de ese día (hora local) en ISO. */
const endOfDay = (value: string): string => new Date(`${value}T23:59:59`).toISOString();

function ShareBody({ subject }: { subject: ShareSubject }) {
  const t = texts.sharing;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: [...sharingKeys.target(workspaceSlug, subject), search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      sharingApi.explain(workspaceSlug, subject, search, pageParam, signal),
    getNextPageParam: (last) => last.people.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  // Los accesos dados y la herencia vienen en cada página; basta la primera.
  const first = query.data?.pages[0];
  const people = useMemo(
    () => query.data?.pages.flatMap((page) => page.people.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages.at(-1)?.people.total ?? 0;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: sharingKeys.target(workspaceSlug, subject) });

  return (
    <DialogContent
      title={t.title(subject.name)}
      description={t.description}
      size="lg"
      footer={
        <DialogClose asChild>
          <Button variant="outline">{t.close}</Button>
        </DialogClose>
      }
    >
      <div className="grid gap-5">
        <AddAccess subject={subject} onAdded={refresh} />
        {first === undefined ? (
          query.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t.loadError}
            </p>
          ) : (
            <Skeleton className="h-16 w-full" />
          )
        ) : (
          <>
            <Grants data={first} onChanged={refresh} />
            {first.inheritance !== null && subject.type === "node" && (
              <Inheritance subject={subject} data={first} onChanged={refresh} />
            )}
          </>
        )}
        <section className="grid gap-2" aria-labelledby="share-people">
          <h3 id="share-people" className="text-sm font-semibold">
            {t.people.title}
          </h3>
          <Input
            type="search"
            value={search}
            aria-label={t.people.search}
            placeholder={t.people.search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          {query.isPending ? (
            <Skeleton className="h-12 w-full" />
          ) : people.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              {search === "" ? t.people.empty : t.people.none}
            </p>
          ) : (
            <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto p-0">
              {people.map((person) => (
                <PersonRow key={person.membershipId} person={person} />
              ))}
              <li>
                <LoadMore
                  hasNextPage={query.hasNextPage}
                  isFetching={query.isFetchingNextPage}
                  onLoadMore={() => {
                    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
                  }}
                />
              </li>
            </ul>
          )}
          <ShownCounter shown={people.length} total={total} className="static border-t-0 px-0" />
          {first?.people.truncated === true && (
            <p className="text-xs text-muted-foreground">{t.people.truncated}</p>
          )}
        </section>
      </div>
    </DialogContent>
  );
}

// ─── Dar acceso ──────────────────────────────────────────────────────────────────────────

function AddAccess({
  subject,
  onAdded,
}: {
  subject: ShareSubject;
  onAdded: () => Promise<unknown>;
}) {
  const t = texts.sharing.add;
  const { workspaceSlug = "" } = useParams();
  const [kind, setKind] = useState<"department" | "person" | "company">("department");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [level, setLevel] = useState<AccessLevel>("VIEW");
  const [expires, setExpires] = useState("");
  const [subareas, setSubareas] = useState(false);

  const departmentSource = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "files", "department-options", subject.spaceId],
      search: async (q, cursor, signal) => {
        const page = await filesApi.departmentOptions(
          workspaceSlug,
          subject.spaceId,
          q,
          cursor,
          signal,
        );
        return {
          items: page.items.map((d) => ({ id: d.id, label: d.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug, subject.spaceId],
  );
  const personSource = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "files", "person-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((p) => ({
            id: p.id,
            label: p.name,
            description: p.jobTitle ?? undefined,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );

  const add = useMutation({
    mutationFn: () =>
      sharingApi.set(workspaceSlug, subject, {
        ...(kind === "company"
          ? { everyone: true }
          : kind === "department"
            ? { departmentId: picked?.id ?? "" }
            : { membershipId: picked?.id ?? "" }),
        level,
        expiresAt: expires === "" ? null : endOfDay(expires),
        ...(kind === "department" ? { includeSubareas: subareas } : {}),
      }),
    onSuccess: async () => {
      toast.success(texts.sharing.saved);
      setPicked(null);
      setExpires("");
      setSubareas(false);
      await onAdded();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <section className="grid gap-3 rounded-xl border border-border p-3" aria-label={t.title}>
      <div
        role="group"
        aria-label={t.title}
        className="inline-flex w-fit rounded-lg border border-border p-0.5"
      >
        {(["department", "person", "company"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setPicked(null);
              // A toda la empresa no se le da Gestionar.
              if (value === "company" && level === "MANAGE") setLevel("EDIT");
            }}
            className="h-8 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
          >
            {value === "department" ? t.department : value === "person" ? t.person : t.company}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {kind === "company" ? (
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">{t.companyHint}</p>
        ) : (
          <div className="min-w-0 flex-1 basis-48">
            <Combobox
              key={kind}
              label={kind === "department" ? t.pickDepartment : t.pickPerson}
              placeholder={kind === "department" ? t.searchDepartment : t.searchPerson}
              source={kind === "department" ? departmentSource : personSource}
              value={picked?.id ?? null}
              valueLabel={picked?.label}
              onChange={(option) => {
                setPicked(option === null ? null : { id: option.id, label: option.label });
              }}
            />
          </div>
        )}
        <LevelSelect
          value={level}
          label={t.level}
          levels={kind === "company" ? COMPANY_LEVELS : LEVELS}
          onChange={setLevel}
        />
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.expires}
          <Input
            type="date"
            value={expires}
            onChange={(event) => {
              setExpires(event.target.value);
            }}
            className="h-9"
          />
        </label>
        <Button
          disabled={(kind !== "company" && picked === null) || add.isPending}
          onClick={() => {
            add.mutate();
          }}
        >
          {add.isPending ? t.submitting : t.submit}
        </Button>
      </div>
      {kind === "department" && (
        <div className="grid gap-1">
          <Checkbox
            checked={subareas}
            label={t.includeSubareas}
            onChange={(event) => {
              setSubareas(event.target.checked);
            }}
          />
          <p className="pl-6 text-xs text-muted-foreground">{t.includeSubareasHint}</p>
        </div>
      )}
      {kind === "person" && (
        <p className="text-xs text-muted-foreground">
          {t.limitedHint} {t.emailHint}
        </p>
      )}
    </section>
  );
}

// ─── Accesos dados ───────────────────────────────────────────────────────────────────────

function Grants({
  data,
  onChanged,
}: {
  data: AccessExplanation;
  onChanged: () => Promise<unknown>;
}) {
  const t = texts.sharing.grants;
  const { workspaceSlug = "" } = useParams();
  const target: ShareTarget = { type: data.target.type, id: data.target.id };
  const change = useMutation({
    mutationFn: (input: { grant: GrantView; level: AccessLevel }) =>
      sharingApi.set(workspaceSlug, target, {
        ...(input.grant.subject.type === "company"
          ? { everyone: true }
          : input.grant.subject.type === "department"
            ? { departmentId: input.grant.subject.id }
            : { membershipId: input.grant.subject.id }),
        level: input.level,
        expiresAt: input.grant.expiresAt,
        ...(input.grant.subject.type === "department"
          ? { includeSubareas: input.grant.includeSubareas }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(texts.sharing.saved);
      await onChanged();
    },
    onError: async (error) => {
      toast.error(adminErrorText(error));
      await onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: (grant: GrantView) => sharingApi.remove(workspaceSlug, grant.id),
    onSuccess: async () => {
      toast.success(texts.sharing.removed);
      await onChanged();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <section className="grid gap-2" aria-labelledby="share-grants">
      <h3 id="share-grants" className="text-sm font-semibold">
        {t.title}
      </h3>
      {data.grants.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="m-0 max-h-64 list-none divide-y divide-border overflow-y-auto p-0">
          {data.grants.map((grant) => (
            <li key={grant.id} className="flex flex-wrap items-center gap-3 py-2">
              {grant.subject.type === "company" ? (
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground"
                >
                  <Building2 className="size-4" strokeWidth={1.75} />
                </span>
              ) : (
                <Avatar name={grant.subject.name} className="size-8 text-xs" />
              )}
              <div className="min-w-0 flex-1 basis-32">
                <p className="truncate text-sm font-medium">{grant.subject.name}</p>
                <p className="text-xs text-muted-foreground">
                  {grant.subject.type === "company"
                    ? t.company
                    : grant.subject.type === "department"
                      ? t.department
                      : t.person}
                  {grant.expiresAt !== null && ` · ${t.expires(formatShortDate(grant.expiresAt))}`}
                  {grant.subject.type === "department" &&
                    grant.includeSubareas &&
                    ` · ${t.subareas}`}
                  {grant.from !== null && ` · ${t.inheritedFrom(grant.from.name)}`}
                  {grant.grantedBy !== null && grant.from === null && ` · ${t.by(grant.grantedBy)}`}
                </p>
              </div>
              {grant.from === null ? (
                <>
                  <LevelSelect
                    value={grant.level}
                    label={t.level(grant.subject.name)}
                    disabled={change.isPending}
                    levels={grant.subject.type === "company" ? COMPANY_LEVELS : LEVELS}
                    onChange={(level) => {
                      change.mutate({ grant, level });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.remove(grant.subject.name)}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate(grant);
                    }}
                  >
                    <Trash2 strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <Badge>{texts.sharing.levels[grant.level]}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Herencia ────────────────────────────────────────────────────────────────────────────

function Inheritance({
  subject,
  data,
  onChanged,
}: {
  subject: ShareSubject;
  data: AccessExplanation;
  onChanged: () => Promise<unknown>;
}) {
  const t = texts.sharing.inheritance;
  const { workspaceSlug = "" } = useParams();
  const [confirming, setConfirming] = useState(false);
  const inheritance = data.inheritance;
  const toggle = useMutation({
    mutationFn: (inheritAccess: boolean) =>
      sharingApi.setInheritance(workspaceSlug, subject.id, inheritAccess),
    onSuccess: async (result) => {
      toast.success(result.inheritAccess ? t.restored : t.cutDone);
      if (result.keptAccess) toast.info(t.keptAccess, { duration: 12_000 });
      await onChanged();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (inheritance === null) return null;
  const confirm = inheritance.inherits ? t.confirmCut : t.confirmRestore;
  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
      aria-labelledby="share-inheritance"
    >
      <div className="min-w-0 flex-1 basis-56">
        <h3 id="share-inheritance" className="text-sm font-semibold">
          {t.title}
        </h3>
        <p className="text-xs text-muted-foreground">
          {inheritance.inherits ? t.inherits(inheritance.from.name) : t.cut(inheritance.from.name)}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={toggle.isPending}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {inheritance.inherits ? (
          <Link2Off strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Undo2 strokeWidth={1.75} aria-hidden="true" />
        )}
        {inheritance.inherits ? t.cutAction : t.restoreAction}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={inheritance.inherits ? Link2Off : Undo2}
        tone={inheritance.inherits ? "warning" : "primary"}
        title={confirm.title}
        description={confirm.text}
        confirmLabel={confirm.action}
        pendingLabel={confirm.pending}
        onConfirm={async () => {
          await toggle.mutateAsync(!inheritance.inherits);
        }}
      />
    </section>
  );
}

// ─── Quién puede entrar y por qué ────────────────────────────────────────────────────────

export function PersonRow({ person }: { person: PersonAccessView }) {
  const [first, ...rest] = person.reasons;
  return (
    <li className="flex flex-wrap items-start gap-3 py-2">
      <Avatar name={person.name} className="size-8 text-xs" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">
          {person.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{person.role}</span>
        </p>
        {first !== undefined && (
          <p className="text-xs text-muted-foreground">{reasonLine(first)}</p>
        )}
        {rest.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {texts.sharing.people.reasonsMore(rest.length)}
            </summary>
            <ul className="m-0 list-none p-0">
              {rest.map((view, index) => (
                <li key={index}>{reasonLine(view)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Badge>{texts.sharing.levels[person.level]}</Badge>
    </li>
  );
}
