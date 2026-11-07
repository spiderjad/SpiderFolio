// /app/:slug/seguridad/emergencias — the emergency plan and team (docs/spec/seguridad-salud.md,
// «Emergencias y simulacros»): the PEM document, the last drill and when the next is due, and the
// team's roles with their people and whether each has the training the role requires. For whoever
// manages the module.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Siren, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Banner, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  emergenciesApi,
  emergenciesKeys,
  trainingApi,
  type EmergencyTeam,
  type TrainingStatus,
} from "./safety-api";
import { PpeTabs, usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.emergencies;

/** Team and drills, inside the Emergencias tab. */
export function EmergencyNav() {
  const { workspaceSlug = "" } = useParams();
  const base = `/app/${workspaceSlug}/seguridad/emergencias`;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      isActive
        ? "bg-primary-soft font-medium text-primary-soft-foreground"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <nav className="flex flex-wrap gap-1" aria-label={t.title}>
      <NavLink end to={base} className={tab}>
        {t.nav.team}
      </NavLink>
      <NavLink to={`${base}/simulacros`} className={tab}>
        {t.nav.drills}
      </NavLink>
    </nav>
  );
}

const trainingTone = {
  valid: "success",
  due_soon: "warning",
  expired: "danger",
  pending: "danger",
  none: "neutral",
} as const;

export function TrainingBadge({ status }: { status: TrainingStatus }) {
  if (status === "none") return null;
  return <Badge tone={trainingTone[status]}>{t.training[status]}</Badge>;
}

/** The module's courses, to require one for a role. */
function useCourseSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...emergenciesKeys.all(workspaceSlug), "courses"],
      // The courses list has no search: it's paged by the server and shown as it comes.
      search: async (_q, cursor, signal) => {
        const page = await trainingApi.list(
          workspaceSlug,
          cursor,
          signal ?? new AbortController().signal,
        );
        return {
          items: page.items.map((course) => ({
            id: course.id,
            label: course.document.name,
            description: course.document.code,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

export function EmergenciesPage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const archived = params.get("archivados") === "1";
  const [editing, setEditing] = useState<EmergencyTeam["roles"][number] | "new" | null>(null);
  const [adding, setAdding] = useState<EmergencyTeam["roles"][number] | null>(null);
  const queryClient = useQueryClient();
  const team = useQuery({
    queryKey: emergenciesKeys.team(workspaceSlug, archived),
    queryFn: () => emergenciesApi.team(workspaceSlug, archived),
    select: (data) => data.team,
  });
  const remove = useMutation({
    mutationFn: (id: string) => emergenciesApi.removeMember(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: emergenciesKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = team.data;
  const missing =
    data?.roles
      .filter((role) => !role.archived)
      .flatMap((role) => role.members)
      .filter(
        (member) =>
          member.training !== "none" &&
          member.training !== "valid" &&
          member.training !== "due_soon",
      ).length ?? 0;
  const plan = data?.plan;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setEditing("new");
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.addRole}
        </Button>
      </div>
      <PpeTabs />
      <EmergencyNav />
      {data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="grid gap-2 p-4 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                {t.plan}
              </CardTitle>
              {plan == null ? (
                <p className="text-sm text-muted-foreground">{t.planNone}</p>
              ) : (
                <Link
                  to={
                    plan.type === "PAGE"
                      ? `/app/${workspaceSlug}/files/${plan.spaceId}/p/${plan.id}`
                      : `/app/${workspaceSlug}/files/${plan.spaceId}`
                  }
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {plan.code} · {plan.name}
                </Link>
              )}
            </Card>
            <Card className="grid gap-2 p-4 sm:p-5">
              <CardTitle className="flex items-center gap-2 text-base">
                <Siren className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
                {t.nav.drills}
              </CardTitle>
              <p className="text-sm">
                {data.lastDrill === null
                  ? t.noDrill
                  : t.lastDrill(formatUtcDate(data.lastDrill.date))}
              </p>
              {data.nextDrillBy !== null && (
                <p className="text-xs text-muted-foreground">
                  {t.nextDrill(formatUtcDate(data.nextDrillBy))}
                </p>
              )}
            </Card>
          </div>
          {missing > 0 && <Banner tone="warning">{t.missing(missing)}</Banner>}
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t.roles}</h2>
            <Checkbox
              label={t.showArchived}
              checked={archived}
              onChange={(event) => {
                patch({ archivados: event.target.checked ? "1" : undefined });
              }}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.roles.map((role) => (
              <Card key={role.id} className="grid content-start gap-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {role.name}
                      {role.archived && <Badge>{t.archived}</Badge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {role.course === null ? t.noCourse : t.course(role.course.name)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t.editRole(role.name)}
                      onClick={() => {
                        setEditing(role);
                      }}
                    >
                      <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {role.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noMembers}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {role.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{member.person.name}</p>
                          {member.location !== null && (
                            <p className="text-xs text-muted-foreground">{member.location}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <TrainingBadge status={member.training} />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.removeMember(member.person.name)}
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate(member.id);
                            }}
                          >
                            <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {!role.archived && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => {
                      setAdding(role);
                    }}
                  >
                    <Plus strokeWidth={1.75} aria-hidden="true" />
                    {t.addMember}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <RoleDialog
            role={editing === "new" ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
      >
        {adding !== null && (
          <MemberDialog
            role={adding}
            onClose={() => {
              setAdding(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function RoleDialog({
  role,
  onClose,
}: {
  role: EmergencyTeam["roles"][number] | null;
  onClose: () => void;
}) {
  const f = t.roleForm;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const courses = useCourseSource();
  const [name, setName] = useState(role?.name ?? "");
  const [course, setCourse] = useState<{ id: string; name: string } | null>(role?.course ?? null);
  const done = async () => {
    toast.success(t.saved);
    await queryClient.invalidateQueries({ queryKey: emergenciesKeys.all(workspaceSlug) });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), courseId: course?.id ?? null };
      if (role === null) await emergenciesApi.createRole(workspaceSlug, body);
      else await emergenciesApi.updateRole(workspaceSlug, role.id, body);
    },
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      emergenciesApi.updateRole(workspaceSlug, role?.id ?? "", {
        archived: role?.archived !== true,
      }),
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const busy = save.isPending || archive.isPending;
  return (
    <DialogContent
      title={role === null ? f.createTitle : f.editTitle}
      footer={
        <>
          {role !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                archive.mutate();
              }}
            >
              {role.archived ? f.restore : f.archive}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={busy || name.trim().length < 2}
            onClick={() => {
              save.mutate();
            }}
          >
            {role === null ? texts.admin.common.create : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              maxLength={80}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.course}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              searchable={false}
              label={f.course}
              placeholder={f.coursePlaceholder}
              source={courses}
              value={course?.id ?? null}
              valueLabel={course?.name}
              onChange={(option) => {
                setCourse(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function MemberDialog({
  role,
  onClose,
}: {
  role: EmergencyTeam["roles"][number];
  onClose: () => void;
}) {
  const f = t.memberForm;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  const [location, setLocation] = useState("");
  const add = useMutation({
    mutationFn: () =>
      emergenciesApi.addMember(workspaceSlug, role.id, {
        membershipId: person?.id ?? "",
        location: location.trim() === "" ? null : location.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: emergenciesKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={f.title(role.name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={add.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={person === null || add.isPending}
            onClick={() => {
              add.mutate();
            }}
          >
            {t.addMember}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.person}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={f.person}
              placeholder={f.personPlaceholder}
              source={people}
              value={person?.id ?? null}
              valueLabel={person?.name}
              onChange={(option) => {
                setPerson(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
        <FormField label={f.location}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              placeholder={f.locationPlaceholder}
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

/** Someone's emergency roles, on their sheet (each person sees their own). */
export function PersonEmergencyCard({ membershipId, own }: { membershipId: string; own: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: emergenciesKeys.person(workspaceSlug, membershipId),
    queryFn: () => emergenciesApi.person(workspaceSlug, membershipId),
    select: (data) => data.items,
  });
  if (query.data === undefined || query.data.length === 0) return null;
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <CardTitle className="flex items-center gap-2 text-base">
        <Siren className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {own ? t.mine : t.theirs}
      </CardTitle>
      <ul className="grid gap-2">
        {query.data.map((item) => (
          <li
            key={`${item.role}-${item.location ?? ""}`}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <p className="text-sm font-medium">{item.role}</p>
              <p className="text-xs text-muted-foreground">
                {[item.location, item.course === null ? null : t.course(item.course)]
                  .filter((part): part is string => part !== null)
                  .join(" · ")}
              </p>
            </div>
            <TrainingBadge status={item.training} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
