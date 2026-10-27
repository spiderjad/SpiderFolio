// Inicio (10.6): todo con datos reales y según quién entra.
// - Todos: «Mis pendientes» con acción directa, «Pregúntale a Bian», compartido reciente, favoritos
//   y recientes.
// - Jefes y subjefes: cumplimiento de lectura de su área, revisiones próximas y documentos en revisión.
// - Propietario y administradores: indicadores de la empresa, actividad y más consultados.
// El servidor ya filtra por alcance; la pantalla solo muestra lo que llega. Recharts entra solo con
// esta pantalla (ruta con carga diferida).
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BellRing,
  ClipboardCheck,
  Eye,
  FileCheck2,
  FileClock,
  FilePen,
  HardDrive,
  Medal,
  RefreshCw,
  Share2,
  ShieldCheck,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, Navigate, useParams } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { canSee } from "@/components/nav-items";
import { Button } from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart";
import { AnimatedNumber, KpiCard, ProgressBar, SectionCard } from "@/components/ui/data";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { adminErrorText, loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { BianLogo } from "@/features/bian/bian-brand";
import { useBian } from "@/features/bian/bian-context";
import { documentsApi } from "@/features/documents/documents-api";
import { RecentDocuments, pathOf } from "@/features/documents/my-documents-page";
import { filesApi, filesKeys } from "@/features/files/api";
import { SpaceMark } from "@/features/files/space-mark";
import { KioskHome } from "@/features/kiosk/kiosk-home";
import { api, ApiError, NetworkError } from "@/lib/api";
import { formatBytes, formatDay, formatLongDate, formatShortDate, timeAgo } from "@/lib/utils";
import { useHome, type HomeOverview, type NodeRef } from "./home-api";
import { useMembership } from "./workspace-layout";
import { texts } from "@/i18n";

export { overviewKey } from "./home-api";

function Bars({
  data,
  xKey,
  series,
  formatX,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  series: { key: string; name: string; color: string }[];
  formatX: (value: string) => string;
}) {
  const names = Object.fromEntries(series.map((s) => [s.key, s.name]));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            fontSize={12}
            minTickGap={24}
            tickFormatter={(value: string) => formatX(value)}
            className="fill-muted-foreground"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            fontSize={12}
            allowDecimals={false}
            className="fill-muted-foreground"
          />
          <Tooltip
            cursor={{ className: "fill-muted" }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                names={names}
                formatLabel={formatX}
              />
            )}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={20} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Forma de carga de las listas: filas como las reales, sin saltos al llegar los datos. */
function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Línea de contexto de un KPI: en cero, qué hacer; con datos, qué significa el número. */
function kpiContext(value: number, text: { empty: string; some: string }): string {
  return value === 0 ? text.empty : text.some;
}

function errorText(error: unknown): string {
  if (error instanceof NetworkError) return texts.errors.network;
  if (error instanceof ApiError && error.code === "RATE_LIMITED") return texts.errors.rateLimited;
  return texts.errors.generic;
}

export function DashboardPage() {
  const { account } = useAuth();
  const membership = useMembership();
  // Quien entra con usuario + PIN en una tablet ve una vista simple.
  if (account?.kiosk != null) return <KioskHome />;
  // Quien tiene plaza de lector empieza en Mis documentos (lecturas y novedades).
  if (membership.seatType === "READER") {
    return <Navigate to={`/app/${membership.workspace.slug}/mis-documentos`} replace />;
  }
  return <StandardDashboard />;
}

/** Dónde se abre un documento: páginas y carpetas por su ruta; un archivo, desde Mis documentos. */
function docLink(slug: string, node: NodeRef): string {
  return pathOf(slug, node) ?? `/app/${slug}/mis-documentos`;
}

function StandardDashboard() {
  const t = texts.dashboard;
  const { workspaceSlug = "" } = useParams();
  const { account } = useAuth();
  const membership = useMembership();
  const [resent, setResent] = useState(false);
  const overview = useHome(workspaceSlug);
  const data = overview.data;
  const loading = overview.isPending;

  const resend = async () => {
    try {
      await api("/auth/resend-verification", { method: "POST" });
      setResent(true);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const header = (
    <div className="mb-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      {/* La fecha ya está en la barra superior (10.4); acá, a quién y dónde. */}
      {account !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t.greeting(account.user.name.split(" ")[0] ?? "", membership.workspace.name)}
        </p>
      )}
    </div>
  );

  if (overview.isError && data === undefined) {
    return (
      <div className="grid gap-4">
        {header}
        <Card>
          <EmptyState
            icon={loadErrorIcon(overview.error)}
            title={t.error.title}
            action={
              <Button variant="outline" onClick={() => void overview.refetch()}>
                <RefreshCw strokeWidth={1.75} aria-hidden="true" />
                {texts.common.retry}
              </Button>
            }
          >
            {loadErrorText(overview.error)}
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {header}

      {account !== null && !account.user.emailVerified && (
        <Banner
          action={
            resent ? (
              <Badge tone="success">{texts.auth.unverifiedBanner.sent}</Badge>
            ) : (
              <Button variant="warning" size="sm" onClick={() => void resend()}>
                {texts.auth.unverifiedBanner.action}
              </Button>
            )
          }
        >
          {texts.auth.unverifiedBanner.text}
        </Banner>
      )}

      {data?.company != null && <CompanySection home={data} slug={workspaceSlug} />}

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <PendingCard home={data} slug={workspaceSlug} loading={loading} />
        <BianBox />
      </section>

      {data?.leader != null && <LeaderSection home={data} slug={workspaceSlug} />}

      <section className="grid gap-4 xl:grid-cols-3">
        <SharedCard home={data} slug={workspaceSlug} loading={loading} />
        <FavoritesCard slug={workspaceSlug} />
        <RecentDocuments limit={5} />
      </section>
    </div>
  );
}

// ─── Todos ───────────────────────────────────────────────────────────────────────────────

/** «Mis pendientes»: lo que me falta leer y aprobar, con la acción a un clic. */
function PendingCard({
  home,
  slug,
  loading,
}: {
  home: HomeOverview | undefined;
  slug: string;
  loading: boolean;
}) {
  const t = texts.dashboard.pending;
  const readings = home?.mine.readings;
  const approvals = home?.mine.approvals;
  const none = readings?.total === 0 && approvals?.total === 0;
  return (
    <SectionCard
      title={t.title}
      emptyIcon={ClipboardCheck}
      emptyTitle={t.emptyTitle}
      loading={loading}
      skeleton={<ListSkeleton rows={4} />}
      empty={none ? t.empty : undefined}
    >
      <ul className="-my-2 divide-y divide-border">
        {approvals?.items.map((item) => (
          <li key={`a-${item.node.id}`} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.node.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[item.code, item.node.spaceName, timeAgo(item.submittedAt)].join(" · ")}
              </p>
            </div>
            <Badge tone="warning">{t.kinds.approval}</Badge>
            <Button asChild size="sm" variant="outline">
              <Link to={`/app/${slug}/aprobaciones`}>{t.review}</Link>
            </Button>
          </li>
        ))}
        {readings?.items.map((item) => (
          <li key={`r-${item.node.id}`} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.node.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  item.code,
                  item.node.spaceName,
                  item.dueAt === null ? null : t.due(formatLongDate(item.dueAt)),
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
            </div>
            {item.overdue ? (
              <Badge tone="danger">{t.overdue}</Badge>
            ) : (
              <Badge tone="primary">{t.kinds.reading}</Badge>
            )}
            <Button asChild size="sm">
              <Link to={docLink(slug, item.node)}>{t.read}</Link>
            </Button>
          </li>
        ))}
      </ul>
      {((approvals?.total ?? 0) > (approvals?.items.length ?? 0) ||
        (readings?.total ?? 0) > (readings?.items.length ?? 0)) && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {(approvals?.total ?? 0) > (approvals?.items.length ?? 0) && (
            <Link
              to={`/app/${slug}/aprobaciones`}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:underline"
            >
              {t.viewAllApprovals(approvals?.total ?? 0)}
            </Link>
          )}
          {(readings?.total ?? 0) > (readings?.items.length ?? 0) && (
            <Link
              to={`/app/${slug}/mis-documentos`}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:underline"
            >
              {t.viewAllReadings(readings?.total ?? 0)}
            </Link>
          )}
        </p>
      )}
    </SectionCard>
  );
}

/** Caja «Pregúntale a Bian»: abre el panel del asistente con la pregunta. */
function BianBox() {
  const t = texts.dashboard.bian;
  const bian = useBian();
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    bian.open({ kind: "ask", question: question.trim() });
    setQuestion("");
  };
  return (
    <Card className="card-hover flex flex-col gap-3 p-4 sm:p-5">
      <BianLogo className="h-8 self-start" />
      <h2 className="text-base font-semibold">{t.title}</h2>
      <p className="text-xs text-muted-foreground">{t.text}</p>
      <form onSubmit={submit} className="mt-auto grid gap-2">
        <Input
          value={question}
          maxLength={500}
          aria-label={t.title}
          placeholder={t.placeholder}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
        <Button type="submit" className="bian-wiggle">
          {t.submit}
        </Button>
      </form>
    </Card>
  );
}

function SharedCard({
  home,
  slug,
  loading,
}: {
  home: HomeOverview | undefined;
  slug: string;
  loading: boolean;
}) {
  const t = texts.dashboard.shared;
  return (
    <SectionCard
      title={t.title}
      emptyIcon={Share2}
      emptyTitle={t.emptyTitle}
      loading={loading}
      skeleton={<ListSkeleton rows={3} />}
      empty={home?.shared.length === 0 ? t.empty : undefined}
    >
      <ul className="-my-1 grid">
        {home?.shared.map((item) => (
          <li key={item.node.id}>
            <Link
              to={docLink(slug, item.node)}
              className="block rounded-lg px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="block truncate text-sm font-medium">{item.node.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  item.sharedBy === null ? null : t.by(item.sharedBy),
                  item.node.spaceName,
                  timeAgo(item.sharedAt),
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to={`/app/${slug}/files/shared`}
        className="mt-3 block text-xs text-primary hover:underline focus-visible:outline-none focus-visible:underline"
      >
        {t.all}
      </Link>
    </SectionCard>
  );
}

function FavoritesCard({ slug }: { slug: string }) {
  const t = texts.dashboard.favorites;
  const favorites = useQuery({
    queryKey: [...filesKeys.favoriteSpaces(slug), "home"],
    queryFn: () => filesApi.spaces(slug, { filter: "favorites", sort: "favorite", pageSize: 5 }),
    staleTime: 30_000,
  });
  const items = favorites.data?.items ?? [];
  return (
    <SectionCard
      title={t.title}
      emptyIcon={Star}
      emptyTitle={t.emptyTitle}
      loading={favorites.isPending}
      skeleton={<ListSkeleton rows={3} />}
      empty={favorites.isPending || items.length > 0 ? undefined : t.empty}
    >
      <ul className="-my-1 grid">
        {items.map((space) => (
          <li key={space.id}>
            <Link
              to={`/app/${slug}/files/${space.id}`}
              className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <SpaceMark space={space} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{space.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {space.department?.name ?? texts.files.spaces.company}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {(favorites.data?.total ?? 0) > items.length && (
        <Link
          to={`/app/${slug}/files?filtro=favoritos`}
          className="mt-3 block text-xs text-primary hover:underline focus-visible:outline-none focus-visible:underline"
        >
          {t.all}
        </Link>
      )}
    </SectionCard>
  );
}

// ─── Jefes y subjefes ────────────────────────────────────────────────────────────────────

function LeaderSection({ home, slug }: { home: HomeOverview; slug: string }) {
  const t = texts.dashboard.leader;
  const leader = home.leader;
  const remind = useMutation({
    mutationFn: (nodeId: string) => documentsApi.remindReaders(slug, nodeId),
    onSuccess: ({ sent }) => {
      toast.success(t.compliance.reminded(sent));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (leader === null) return null;
  return (
    <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <SectionCard
        title={t.compliance.title}
        emptyIcon={ShieldCheck}
        emptyTitle={t.compliance.emptyTitle}
        empty={leader.compliance.length === 0 ? t.compliance.empty : undefined}
      >
        <ul className="-my-2 divide-y divide-border">
          {leader.compliance.map((item) => (
            <li key={item.node.id} className="grid gap-2 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to={docLink(slug, item.node)}
                  className="min-w-0 flex-1 truncate font-medium hover:underline focus-visible:outline-none focus-visible:underline"
                >
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                    {item.code}
                  </span>
                  {item.node.name}
                </Link>
                {item.overdue > 0 && (
                  <Badge tone="danger">{t.compliance.overdue(item.overdue)}</Badge>
                )}
                {item.pending + item.overdue > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remind.isPending}
                    onClick={() => {
                      remind.mutate(item.node.id);
                    }}
                  >
                    <BellRing strokeWidth={1.75} aria-hidden="true" />
                    {t.compliance.remind}
                  </Button>
                ) : (
                  <Badge tone="success">{t.compliance.allRead}</Badge>
                )}
              </div>
              <ProgressBar
                value={item.read}
                max={Math.max(1, item.total - item.noAccess)}
                label={item.code}
                tone={item.overdue > 0 ? "danger" : "primary"}
              />
              <p className="text-xs text-muted-foreground">
                {[
                  t.compliance.of(item.read, item.total - item.noAccess),
                  item.noAccess > 0 ? t.compliance.noAccess(item.noAccess) : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </SectionCard>
      <div className="grid gap-4 self-start">
        <SectionCard
          title={t.reviewDue.title}
          emptyIcon={FileClock}
          emptyTitle={t.reviewDue.emptyTitle}
          empty={leader.reviewDue.items.length === 0 ? t.reviewDue.empty : undefined}
        >
          <ul className="-my-1 grid">
            {leader.reviewDue.items.map((item) => (
              <li key={item.node.id}>
                <Link
                  to={docLink(slug, item.node)}
                  className="block rounded-lg px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="block truncate text-sm font-medium">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                      {item.code}
                    </span>
                    {item.node.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t.reviewDue.on(formatShortDate(item.at))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard
          title={t.inReview.title}
          emptyIcon={FilePen}
          emptyTitle={t.inReview.emptyTitle}
          empty={leader.inReview.items.length === 0 ? t.inReview.empty : undefined}
        >
          <ul className="-my-1 grid">
            {leader.inReview.items.map((item) => (
              <li key={item.node.id}>
                <Link
                  to={docLink(slug, item.node)}
                  className="block rounded-lg px-1 py-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="block truncate text-sm font-medium">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                      {item.code}
                    </span>
                    {item.node.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t.inReview.since(timeAgo(item.at))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </section>
  );
}

// ─── Propietario y administradores ───────────────────────────────────────────────────────

function CompanySection({ home, slug }: { home: HomeOverview; slug: string }) {
  const t = texts.dashboard;
  const membership = useMembership();
  const company = home.company;
  if (company === null) return null;
  const { kpis, storage } = company;
  const documentsAdmin = canSee(membership, "documents")
    ? `/app/${slug}/admin/documents`
    : undefined;
  const link = (query: string): string | undefined =>
    documentsAdmin === undefined ? undefined : `${documentsAdmin}${query}`;
  const members = canSee(membership, "members") ? `/app/${slug}/admin/members` : undefined;
  const withTo = (to: string | undefined) => (to === undefined ? {} : { to });
  return (
    <>
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
        aria-label={t.title}
      >
        <KpiCard
          label={t.kpis.publishedDocuments}
          icon={FileCheck2}
          value={<AnimatedNumber id="publishedDocuments" value={kpis.publishedDocuments} />}
          detail={kpiContext(kpis.publishedDocuments, t.kpiContext.publishedDocuments)}
          {...withTo(link("?estado=PUBLISHED"))}
        />
        <KpiCard
          label={t.kpis.inReview}
          icon={FileClock}
          value={<AnimatedNumber id="inReview" value={kpis.inReview} />}
          detail={kpiContext(kpis.inReview, t.kpiContext.inReview)}
          {...withTo(link("?estado=IN_REVIEW"))}
        />
        <KpiCard
          label={t.kpis.drafts}
          icon={FilePen}
          value={<AnimatedNumber id="drafts" value={kpis.drafts} />}
          detail={kpiContext(kpis.drafts, t.kpiContext.drafts)}
          {...withTo(link("?estado=DRAFT"))}
        />
        <KpiCard
          label={t.kpis.readingCompliance}
          icon={Eye}
          value={
            kpis.readingCompliance === null ? (
              "—"
            ) : (
              <>
                <AnimatedNumber id="readingCompliance" value={kpis.readingCompliance} />
                {" %"}
              </>
            )
          }
          detail={kpiContext(
            kpis.readingCompliance === null ? 0 : 1,
            t.kpiContext.readingCompliance,
          )}
          {...withTo(link("?tab=compliance"))}
        />
        <KpiCard
          label={t.kpis.activePeople}
          icon={Users}
          value={<AnimatedNumber id="activePeople" value={kpis.activePeople} />}
          detail={kpiContext(kpis.activePeople, t.kpiContext.activePeople)}
          {...withTo(members)}
        />
        <KpiCard
          label={t.kpis.storage}
          icon={HardDrive}
          value={formatBytes(storage.usedBytes)}
          detail={
            storage.limitBytes === null ? (
              storage.usedBytes === 0 ? (
                t.kpiContext.storage.empty
              ) : (
                t.kpiContext.storage.unlimited
              )
            ) : (
              <>
                <ProgressBar
                  value={storage.usedBytes}
                  max={storage.limitBytes}
                  label={t.kpis.storage}
                  className="mb-2 mt-2"
                />
                {t.storageOf(formatBytes(storage.usedBytes), formatBytes(storage.limitBytes))}
              </>
            )
          }
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <SectionCard
          title={t.activity.title}
          emptyIcon={TrendingUp}
          emptyTitle={t.activity.emptyTitle}
          empty={
            company.activity.every((day) => day.uploads + day.publications + day.reads === 0)
              ? t.activity.empty
              : undefined
          }
        >
          <Bars
            data={company.activity}
            xKey="date"
            formatX={formatDay}
            series={[
              { key: "uploads", name: t.activity.series.uploads, color: "hsl(var(--primary))" },
              {
                key: "publications",
                name: t.activity.series.publications,
                color: "hsl(var(--warning))",
              },
              { key: "reads", name: t.activity.series.reads, color: "hsl(var(--success))" },
            ]}
          />
        </SectionCard>
        <SectionCard
          title={t.top.title}
          emptyIcon={Medal}
          emptyTitle={t.top.emptyTitle}
          empty={company.topDocuments.length === 0 ? t.top.empty : undefined}
        >
          <ol className="grid gap-1">
            {company.topDocuments.map((doc, index) => (
              <li key={doc.node.id}>
                <Link
                  to={docLink(slug, doc.node)}
                  className="flex min-h-10 items-center gap-3 rounded-lg px-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {doc.code !== null && (
                      <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                        {doc.code}
                      </span>
                    )}
                    {doc.node.name}
                  </span>
                  <Badge tone="primary" className="tabular-nums">
                    {t.top.people(doc.people)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ol>
        </SectionCard>
      </section>
    </>
  );
}
