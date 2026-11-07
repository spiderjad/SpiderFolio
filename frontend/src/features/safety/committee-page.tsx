// /app/:slug/seguridad/comite — the health and safety committee (docs/spec/seguridad-salud.md,
// «Consulta y participación»): who's on it with their term, the last ordinary meeting and when the next
// is due. Whoever manages the module edits it; the committee's members only read it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import { NavLink, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  COMMITTEE_ROLES,
  committeeApi,
  committeeKeys,
  type CommitteeMember,
  type CommitteeRole,
} from "./safety-api";
import { PpeTabs, usePeopleSource, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.committee;

/** Members and meetings, inside the Comité tab. */
export function CommitteeNav() {
  const { workspaceSlug = "" } = useParams();
  const base = `/app/${workspaceSlug}/seguridad/comite`;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm transition-colors",
      isActive
        ? "bg-primary-soft font-medium text-primary-soft-foreground"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <nav className="flex flex-wrap gap-1" aria-label={t.tab}>
      <NavLink end to={base} className={tab}>
        {t.nav.members}
      </NavLink>
      <NavLink to={`${base}/reuniones`} className={tab}>
        {t.nav.meetings}
      </NavLink>
    </nav>
  );
}

/** The committee's name and its roles in the company's terms (es or latam). */
export function useCommitteeTerms() {
  const { termsKey } = useSafety();
  return { name: t.names[termsKey], roles: t.roles[termsKey] };
}

const termTone = { valid: "success", due_soon: "warning", expired: "danger" } as const;

export function CommitteePage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const ended = params.get("anteriores") === "1";
  const terms = useCommitteeTerms();
  const [editing, setEditing] = useState<CommitteeMember | "new" | null>(null);
  const query = useQuery({
    queryKey: committeeKeys.committee(workspaceSlug, ended),
    queryFn: () => committeeApi.committee(workspaceSlug, ended),
    select: (data) => data.committee,
  });
  const data = query.data;
  const manage = data?.canManage === true;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{terms.name}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {manage && (
          <Button
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.addMember}
          </Button>
        )}
      </div>
      <PpeTabs />
      <CommitteeNav />
      {data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card className="grid gap-1 p-4 sm:p-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock
                className="size-4 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {t.nav.meetings}
            </CardTitle>
            <p className="text-sm">
              {data.lastMeeting === null
                ? t.noMeeting
                : t.lastMeeting(formatUtcDate(data.lastMeeting.date))}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.nextMeetingBy === null
                ? t.quarterly
                : `${t.nextMeeting(formatUtcDate(data.nextMeetingBy))}. ${t.quarterly}`}
            </p>
          </Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{t.members}</h2>
            {manage && (
              <Checkbox
                label={t.showEnded}
                checked={ended}
                onChange={(event) => {
                  patch({ anteriores: event.target.checked ? "1" : undefined });
                }}
              />
            )}
          </div>
          {data.members.length === 0 ? (
            <Card>
              <EmptyState icon={Users} title={t.noMembers}>
                {null}
              </EmptyState>
            </Card>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-border">
                {data.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{member.person.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {terms.roles[member.role]} ·{" "}
                        {t.term(
                          member.termStart === null ? null : formatUtcDate(member.termStart),
                          member.termEnd === null ? null : formatUtcDate(member.termEnd),
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {member.ended ? (
                        <Badge>{t.ended}</Badge>
                      ) : (
                        member.term !== null && (
                          <Badge tone={termTone[member.term]}>{t.termStates[member.term]}</Badge>
                        )
                      )}
                      {manage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.editMember(member.person.name)}
                          onClick={() => {
                            setEditing(member);
                          }}
                        >
                          <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <MemberDialog
            member={editing === "new" ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function MemberDialog({
  member,
  onClose,
}: {
  member: CommitteeMember | null;
  onClose: () => void;
}) {
  const f = t.memberForm;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const terms = useCommitteeTerms();
  const roles = useStaticSource(
    "committee-roles",
    COMMITTEE_ROLES.map((id) => ({ id, label: terms.roles[id] })),
  );
  const [person, setPerson] = useState<{ id: string; name: string } | null>(member?.person ?? null);
  const [role, setRole] = useState<CommitteeRole>(member?.role ?? "DELEGATE");
  const [termStart, setTermStart] = useState(member?.termStart ?? "");
  const [termEnd, setTermEnd] = useState(member?.termEnd ?? "");
  const done = async () => {
    toast.success(t.saved);
    await queryClient.invalidateQueries({ queryKey: committeeKeys.all(workspaceSlug) });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        role,
        termStart: termStart === "" ? null : termStart,
        termEnd: termEnd === "" ? null : termEnd,
      };
      if (member === null)
        await committeeApi.addMember(workspaceSlug, { ...body, membershipId: person?.id ?? "" });
      else await committeeApi.updateMember(workspaceSlug, member.id, body);
    },
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const end = useMutation({
    mutationFn: () =>
      committeeApi.updateMember(workspaceSlug, member?.id ?? "", { ended: member?.ended !== true }),
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const busy = save.isPending || end.isPending;
  return (
    <DialogContent
      title={member === null ? f.createTitle : f.editTitle}
      footer={
        <>
          {member !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                end.mutate();
              }}
            >
              {member.ended ? f.restore : f.end}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={busy || person === null}
            onClick={() => {
              save.mutate();
            }}
          >
            {member === null ? texts.admin.common.create : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        {member === null ? (
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
        ) : (
          <p className="text-sm font-medium">{member.person.name}</p>
        )}
        <FormField label={f.role}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={f.role}
              placeholder={f.role}
              source={roles}
              value={role}
              onChange={(option) => {
                const next = COMMITTEE_ROLES.find((id) => id === option?.id);
                if (next !== undefined) setRole(next);
              }}
            />
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={f.termStart}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={termStart}
                onChange={(event) => {
                  setTermStart(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.termEnd} hint={f.termHint}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={termEnd}
                onChange={(event) => {
                  setTermEnd(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </FormGrid>
    </DialogContent>
  );
}
