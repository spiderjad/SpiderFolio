// /app/:slug/seguridad/formacion/:courseId — a course (docs/spec/seguridad-salud.md): who has to do it
// and how each one stands, in-person attendance for whoever manages the module and, for the person,
// confirming again once it expired.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, ServerCrash } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { SignaturePad } from "@/components/signature-pad";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { formatDay } from "@/lib/utils";
import { trainingApi, trainingKeys, type TrainingState } from "./safety-api";
import { usePeopleSource, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.training;

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(new Error("signature"));
    };
    reader.readAsDataURL(blob);
  });
}
const tone: Record<TrainingState, "success" | "warning" | "danger"> = {
  valid: "success",
  due_soon: "warning",
  expired: "danger",
  pending: "danger",
};

export function CoursePage() {
  const { workspaceSlug = "", courseId = "" } = useParams();
  const safety = useSafety();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: trainingKeys.course(workspaceSlug, courseId),
    queryFn: () => trainingApi.get(workspaceSlug, courseId),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trainingKeys.all(workspaceSlug) });
  const peopleSource = usePeopleSource();
  const [attendees, setAttendees] = useState<string[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [date, setDate] = useState("");
  // Each attendee signs on the same screen, one after another.
  const signatures = useRef(new Map<string, () => Promise<Blob | null>>());
  const record = useMutation({
    mutationFn: async () => {
      const signed = [];
      for (const membershipId of attendees) {
        const blob = await signatures.current.get(membershipId)?.();
        if (blob == null) throw new Error(t.needSignature(names.get(membershipId) ?? ""));
        signed.push({ membershipId, signature: await dataUrlOf(blob) });
      }
      await trainingApi.attendance(workspaceSlug, courseId, {
        attendees: signed,
        completedOn: date,
      });
    },
    onSuccess: async () => {
      toast.success(t.toasts.recorded);
      setAttendees([]);
      await refresh();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? adminErrorText(error) : error.message);
    },
  });
  const pdf = useMutation({
    mutationFn: async () => {
      const blob = await trainingApi.attendancePdf(workspaceSlug, courseId, date);
      downloadBlobFile(`${t.attendancePdf} ${date}.pdf`, blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const confirm = useMutation({
    mutationFn: () => trainingApi.confirm(workspaceSlug, courseId),
    onSuccess: async () => {
      toast.success(t.toasts.confirmed);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  if (query.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(query.error)}
        </EmptyState>
      </Card>
    );
  }
  if (query.data === undefined) return <Skeleton className="h-64 w-full" />;
  const { course, people, canRecord } = query.data;
  const mine = people.find((person) => person.membershipId === safety.membershipId);
  const documentPath =
    course.document.type === "PAGE"
      ? `/app/${workspaceSlug}/files/${course.document.spaceId}/p/${course.document.id}`
      : `/app/${workspaceSlug}/files/${course.document.spaceId}`;

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <Link
        to={`/app/${workspaceSlug}/seguridad/formacion`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="font-mono text-base text-muted-foreground">
              {course.document.code}
            </span>{" "}
            {course.document.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {course.validityMonths === null ? t.noValidity : t.validity(course.validityMonths)}
          </p>
          <Link
            to={documentPath}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t.openDocument}
          </Link>
        </div>
        {mine !== undefined && (mine.state === "expired" || mine.state === "due_soon") && (
          <Button
            disabled={confirm.isPending}
            onClick={() => {
              confirm.mutate();
            }}
          >
            {t.confirm}
          </Button>
        )}
      </div>
      <Card className="p-4 sm:p-5">
        <CardTitle className="text-base">{t.people}</CardTitle>
        {people.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.noPeople}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {people.map((person) => (
              <li
                key={person.membershipId}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">{person.name}</p>
                  {person.completedAt !== null && (
                    <p className="text-xs text-muted-foreground">
                      {formatDay(person.completedAt.slice(0, 10))}
                      {person.source === null ? "" : ` · ${t.via[person.source]}`}
                      {person.validUntil === null
                        ? ""
                        : ` · ${t.until(formatDay(person.validUntil))}`}
                    </p>
                  )}
                </div>
                <Badge tone={tone[person.state]}>{t.states[person.state]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canRecord && (
        <Card className="grid gap-3 p-4 sm:p-5">
          <CardTitle className="text-base">{t.attendance}</CardTitle>
          <FormField label={t.attendees}>
            {(control) => (
              <Combobox
                id={control.id}
                multiple
                label={t.attendees}
                placeholder={t.attendeesPlaceholder}
                source={peopleSource}
                values={attendees}
                valueLabels={names}
                onChange={(ids, labels) => {
                  setAttendees(ids);
                  setNames(new Map([...names, ...labels]));
                }}
              />
            )}
          </FormField>
          {attendees.map((membershipId) => (
            <div key={membershipId} className="grid gap-1">
              <p className="text-sm font-medium">{t.signatureOf(names.get(membershipId) ?? "")}</p>
              <SignaturePad
                label={t.signatureOf(names.get(membershipId) ?? "")}
                signer={names.get(membershipId)}
                register={(read) => {
                  signatures.current.set(membershipId, read);
                }}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t.date}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              )}
            </FormField>
            <Button
              disabled={attendees.length === 0 || date === "" || record.isPending}
              onClick={() => {
                record.mutate();
              }}
            >
              {t.save}
            </Button>
            <Button
              variant="outline"
              disabled={date === "" || pdf.isPending}
              onClick={() => {
                pdf.mutate();
              }}
            >
              <Download className="size-4" aria-hidden="true" />
              {t.attendancePdf}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
