// /contratas/:accessId — the contractors' portal (docs/spec/cae.md, «Portal de contratas»): no account.
// The person types the code the host gave them and sees only their own company: its status and
// requirements (uploading documents for them), its workers (adding, changing and removing them), the
// site information to read and its work permits. Outside the company's app, like the auditor's page.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, LogOut, Pencil, Plus, Upload, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { AuthLayout, FormAlert } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Badge, Banner, Card, CardTitle, Logo, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { cn, formatDateTime, formatUtcDate } from "@/lib/utils";
import {
  portalApi,
  portalInfoUrl,
  portalKeys,
  portalUpload,
  type PortalOverview,
  type PortalPermit,
  type PortalRequirement,
  type PortalWorker,
} from "./cae-portal-api";
import { texts } from "@/i18n";

const t = texts.cae.contractor;

const failure = (error: unknown): string =>
  error instanceof ApiError ? errorText(error) : t.uploadFailed;

export function CaePortalPage() {
  const { accessId = "" } = useParams();
  const cover = useQuery({
    queryKey: portalKeys.cover(accessId),
    queryFn: () => portalApi.cover(accessId),
    retry: false,
  });
  if (cover.isPending) return <Skeleton className="m-6 h-64" />;
  if (cover.isError) {
    return (
      <AuthLayout title={t.title}>
        <Banner tone="warning">{t.closed}</Banner>
      </AuthLayout>
    );
  }
  return cover.data.signedIn ? <Portal accessId={accessId} /> : <SignIn accessId={accessId} />;
}

function SignIn({ accessId }: { accessId: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enter = useMutation({
    mutationFn: () => portalApi.enter(accessId, code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: portalKeys.all(accessId) });
    },
    onError: (failed) => {
      setCode("");
      setError(failed instanceof ApiError ? errorText(failed) : String(failed));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() !== "") enter.mutate();
  };
  return (
    <AuthLayout title={t.title}>
      <form className="grid gap-4" onSubmit={submit}>
        <p className="text-sm text-muted-foreground">{t.intro}</p>
        {error !== null && <FormAlert tone="danger">{error}</FormAlert>}
        <FormField label={t.code}>
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              className="font-mono tracking-widest"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
              }}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" disabled={code.trim() === "" || enter.isPending}>
          {t.enter}
        </Button>
      </form>
    </AuthLayout>
  );
}

type Tab = "company" | "workers" | "info" | "permits";

function Portal({ accessId }: { accessId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("company");
  const overview = useQuery({
    queryKey: portalKeys.overview(accessId),
    queryFn: () => portalApi.overview(accessId),
    retry: false,
  });
  const leave = useMutation({
    mutationFn: () => portalApi.leave(accessId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: portalKeys.all(accessId) });
    },
  });
  const data = overview.data;
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              leave.mutate();
            }}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t.leave}
          </Button>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-8">
        {overview.isError ? (
          <Banner tone="warning">{t.closed}</Banner>
        ) : data === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.company.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  texts.cae.terms[data.terms].kinds[data.company.kind],
                  t.forHost(data.host),
                  data.company.responsible === null
                    ? null
                    : t.responsible(data.company.responsible),
                ]
                  .filter((value): value is string => value !== null)
                  .join(" · ")}
              </p>
              {data.accessExpiresAt !== null && (
                <p className="text-xs text-muted-foreground">
                  {t.accessUntil(formatDateTime(data.accessExpiresAt))}
                </p>
              )}
            </div>
            <Status overview={data} />
            <nav className="flex flex-wrap gap-1 border-b border-border" aria-label={t.title}>
              {(["company", "workers", "info", "permits"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-current={tab === id ? "page" : undefined}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                    tab === id
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setTab(id);
                  }}
                >
                  {t.tabs[id]}
                </button>
              ))}
            </nav>
            {tab === "company" && (
              <Card className="grid gap-2 p-4 sm:p-5">
                <CardTitle className="text-base">{t.companyDocs}</CardTitle>
                <Requirements accessId={accessId} workerId={null} items={data.requirements} />
              </Card>
            )}
            {tab === "workers" && <Workers accessId={accessId} />}
            {tab === "info" && <Info accessId={accessId} overview={data} />}
            {tab === "permits" && <Permits accessId={accessId} />}
          </>
        )}
      </main>
    </div>
  );
}

function Status({ overview }: { overview: PortalOverview }) {
  const ok = overview.company.authorized;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon
          className={ok ? "size-5 shrink-0 text-success" : "size-5 shrink-0 text-danger"}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-medium">{ok ? t.authorized : t.notAuthorized}</p>
          {overview.company.reasons.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {overview.company.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

const stateTone = {
  ok: "success",
  due_soon: "warning",
  expired: "danger",
  pending: "primary",
  rejected: "danger",
  missing: "neutral",
} as const;

/** The requirements of the company or of one worker, each with its state and «Subir». */
function Requirements({
  accessId,
  workerId,
  items,
}: {
  accessId: string;
  workerId: string | null;
  items: PortalRequirement[];
}) {
  const [uploading, setUploading] = useState<PortalRequirement | null>(null);
  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.validUntil === null
                  ? null
                  : texts.cae.documents.validUntilShort(formatUtcDate(item.validUntil))}
              </p>
              {item.latest?.status === "REJECTED" && item.latest.rejectReason !== null && (
                <p className="text-xs text-danger">{t.rejected(item.latest.rejectReason)}</p>
              )}
              {item.latest?.status === "PENDING" && (
                <p className="text-xs text-muted-foreground">{t.pending}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={stateTone[item.state]}>{texts.cae.requirementStates[item.state]}</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setUploading(item);
                }}
              >
                <Upload className="size-4" strokeWidth={1.75} aria-hidden="true" />
                {t.upload}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={uploading !== null}
        onOpenChange={(open) => {
          if (!open) setUploading(null);
        }}
      >
        {uploading !== null && (
          <UploadDialog
            accessId={accessId}
            workerId={workerId}
            requirement={uploading}
            onClose={() => {
              setUploading(null);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function UploadDialog({
  accessId,
  workerId,
  requirement,
  onClose,
}: {
  accessId: string;
  workerId: string | null;
  requirement: PortalRequirement;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const upload = useMutation({
    mutationFn: async () => {
      if (file === null) return;
      await portalUpload(accessId, file, {
        requirementId: requirement.id,
        workerId,
        validUntil: validUntil === "" ? null : validUntil,
      });
    },
    onSuccess: async () => {
      toast.success(t.uploaded);
      await queryClient.invalidateQueries({ queryKey: portalKeys.all(accessId) });
      onClose();
    },
    onError: (error) => {
      toast.error(failure(error));
    },
  });
  return (
    <DialogContent
      title={t.uploadTitle(requirement.name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={upload.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={file === null || upload.isPending}
            onClick={() => {
              upload.mutate();
            }}
          >
            {t.upload}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.file} hint={t.fileHint}>
          {(control) => (
            <Input
              {...control}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          )}
        </FormField>
        <FormField label={t.validUntil}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={validUntil}
              onChange={(event) => {
                setValidUntil(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function Workers({ accessId }: { accessId: string }) {
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<PortalWorker | "new" | null>(null);
  const [removing, setRemoving] = useState<PortalWorker | null>(null);
  const list = useInfiniteList<PortalWorker>({
    queryKey: portalKeys.workers(accessId, archived),
    fetchPage: (cursor, signal) => portalApi.workers(accessId, archived, cursor, signal),
  });
  const remove = useMutation({
    mutationFn: (worker: PortalWorker) => portalApi.archiveWorker(accessId, worker.id),
    onSuccess: async () => {
      toast.success(t.workerArchived);
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: portalKeys.all(accessId) });
    },
    onError: (error) => {
      toast.error(failure(error));
    },
  });
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t.workers}</CardTitle>
        <Button
          size="sm"
          onClick={() => {
            setEditing("new");
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.addWorker}
        </Button>
      </div>
      <Checkbox
        label={t.showArchived}
        checked={archived}
        onChange={(event) => {
          setArchived(event.target.checked);
        }}
      />
      {!list.query.isPending && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noWorkers}</p>
      ) : (
        <ul className="grid gap-3">
          {list.items.map((worker) => (
            <li key={worker.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {worker.name}
                    <Badge tone={worker.authorized ? "success" : "warning"}>
                      {worker.authorized
                        ? texts.cae.workerStates.authorized
                        : worker.archived
                          ? texts.cae.workerStates.archived
                          : texts.cae.workerStates.incomplete}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[worker.idNumber, worker.task]
                      .filter((value): value is string => value !== null && value !== "")
                      .join(" · ")}
                  </p>
                </div>
                {!worker.archived && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(worker);
                      }}
                    >
                      <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                      {t.editWorker}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRemoving(worker);
                      }}
                    >
                      {t.archiveWorker}
                    </Button>
                  </div>
                )}
              </div>
              {!worker.archived && worker.requirements.length > 0 && (
                <Requirements
                  accessId={accessId}
                  workerId={worker.id}
                  items={worker.requirements}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <WorkerDialog
            accessId={accessId}
            worker={editing === "new" ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        {removing !== null && (
          <DialogContent
            title={t.archiveWorker}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="outline">{texts.admin.common.cancel}</Button>
                </DialogClose>
                <Button
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(removing);
                  }}
                >
                  {t.archiveWorker}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">{t.archiveConfirm(removing.name)}</p>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

function WorkerDialog({
  accessId,
  worker,
  onClose,
}: {
  accessId: string;
  worker: PortalWorker | null;
  onClose: () => void;
}) {
  const f = texts.cae.workerForm;
  const queryClient = useQueryClient();
  const [name, setName] = useState(worker?.name ?? "");
  const [idNumber, setIdNumber] = useState(worker?.idNumber ?? "");
  const [task, setTask] = useState(worker?.task ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        idNumber: idNumber.trim() === "" ? null : idNumber.trim(),
        task: task.trim() === "" ? null : task.trim(),
      };
      if (worker === null) await portalApi.createWorker(accessId, body);
      else await portalApi.updateWorker(accessId, worker.id, body);
    },
    onSuccess: async () => {
      toast.success(t.workerSaved);
      await queryClient.invalidateQueries({ queryKey: portalKeys.all(accessId) });
      onClose();
    },
    onError: (error) => {
      toast.error(failure(error));
    },
  });
  return (
    <DialogContent
      title={worker === null ? f.createTitle : f.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending || name.trim() === ""}
            onClick={() => {
              save.mutate();
            }}
          >
            {texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.idNumber}>
          {(control) => (
            <Input
              {...control}
              maxLength={20}
              autoComplete="off"
              value={idNumber}
              onChange={(event) => {
                setIdNumber(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.task}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={task}
              onChange={(event) => {
                setTask(event.target.value);
              }}
            />
          )}
        </FormField>
        <p className="text-xs text-muted-foreground">{f.privacy}</p>
      </FormGrid>
    </DialogContent>
  );
}

function Info({ accessId, overview }: { accessId: string; overview: PortalOverview }) {
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle className="text-base">{t.tabs.info}</CardTitle>
      <p className="text-xs text-muted-foreground">{t.infoText}</p>
      {overview.info.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.infoNone}</p>
      ) : (
        <ul className="divide-y divide-border">
          {overview.info.map((doc) => (
            <li key={doc.nodeId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{doc.code}</span> · {doc.title}{" "}
                <span className="text-xs text-muted-foreground">
                  ({texts.cae.info.version(doc.version)})
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={doc.delivered ? "success" : "warning"}>
                  {doc.delivered ? t.received : t.notReceived}
                </Badge>
                <Button size="sm" variant="outline" asChild>
                  <a href={portalInfoUrl(accessId, doc.nodeId)} target="_blank" rel="noopener">
                    <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    {t.open}
                  </a>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Permits({ accessId }: { accessId: string }) {
  const list = useInfiniteList<PortalPermit>({
    queryKey: portalKeys.permits(accessId),
    fetchPage: (cursor, signal) => portalApi.permits(accessId, cursor, signal),
  });
  const p = texts.cae.permits;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle className="text-base">{t.tabs.permits}</CardTitle>
      {!list.query.isPending && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.permitsNone}</p>
      ) : (
        <ul className="grid gap-3">
          {list.items.map((permit) => (
            <li key={permit.id} className="rounded-xl border border-border p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {permit.type === "OTHER"
                  ? (permit.customName ?? p.types.OTHER)
                  : p.types[permit.type]}
                <Badge>{p.states[permit.state]}</Badge>
              </p>
              <p className="text-sm text-muted-foreground">
                {permit.location} ·{" "}
                {p.validity(formatDateTime(permit.validFrom), formatDateTime(permit.validTo))}
              </p>
              {permit.description !== "" && <p className="mt-1 text-sm">{permit.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {permit.workers.map((worker) => worker.name).join(", ")}
                {permit.ownStaff > 0 && ` ${t.ownStaff(permit.ownStaff)}`}
              </p>
              {permit.precautions.length > 0 && (
                <ul className="mt-2 grid gap-0.5 text-sm">
                  {permit.precautions.map((item, index) => (
                    <li key={`${String(index)}-${item.label}`}>
                      <span aria-hidden="true">{item.done ? "✓ " : "○ "}</span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </Card>
  );
}
