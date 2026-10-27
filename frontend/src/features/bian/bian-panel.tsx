// Panel de Bian: entra desde la derecha (en móvil, pantalla completa desde abajo) con chat de
// respuesta en streaming palabra por palabra, citas [n] vinculadas a tarjetas de fuente, acciones por
// respuesta (copiar, 👍, 👎, preguntar de nuevo) y el contador de consultas. La conversación vive en
// la pestaña (no se guarda en el servidor); la valoración guarda solo el voto y los ids citados.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUp,
  CalendarClock,
  ClipboardList,
  ChevronRight,
  Copy,
  FileText,
  Gauge,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Banner, Skeleton } from "@/components/ui/display";
import { Textarea } from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { documentsApi } from "@/features/documents/documents-api";
import { BianAvatar } from "./bian-brand";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";
import {
  askBian,
  bianApi,
  bianKeys,
  docPath,
  FEEDBACK_REASONS,
  runBianTask,
  sourcePath,
  type BianDone,
  type BianOutcome,
  type BianRequest,
  type BianTask,
  type BianSource,
  type FeedbackReason,
  type BianUsageResponse,
  type HistoryTurn,
} from "./bian-api";
import { texts } from "@/i18n";

/** Lo que se pidió, para poder preguntar de nuevo. */
type Asked = { kind: "ask"; question: string; history: HistoryTurn[] } | BianTask;

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources: BianSource[];
  status: "streaming" | "done" | "error" | "limit";
  /** Mientras no llega texto: buscando en los documentos o ya redactando. */
  phase: "searching" | "writing";
  outcome?: BianOutcome;
  rated?: "UP" | "DOWN" | undefined;
  /** Id de la valoración en el servidor (para cambiarla o quitarla). */
  feedbackId?: string | undefined;
  reason?: FeedbackReason | undefined;
  /** Documento sobre el que trabajó Bian (resumir, qué cambió). */
  doc?: BianDone["doc"];
  notice?: string;
  /** Solo en las respuestas: qué se pidió. */
  asked?: Asked;
  /** Si se agotó el límite: el personal (o sin acceso) o el total de la empresa. */
  limit?: { scope: "person" | "workspace"; blocked: boolean };
}

const MAX_HISTORY = 6;

function useBianChat(slug: string) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  const patch = useCallback((id: number, change: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...change } : message)),
    );
  }, []);

  const run = useCallback(
    async (
      label: string,
      asked: Asked,
      call: (
        handlers: { onDelta: (text: string) => void; onStatus: (phase: "writing") => void },
        signal: AbortSignal,
      ) => Promise<BianDone>,
    ) => {
      const userId = nextId.current++;
      const answerId = nextId.current++;
      setMessages((current) => [
        ...current,
        { id: userId, role: "user", text: label, sources: [], status: "done", phase: "writing" },
        {
          id: answerId,
          role: "assistant",
          text: "",
          sources: [],
          status: "streaming",
          // Resumir y «qué cambió» no buscan: arrancan redactando.
          phase: asked.kind === "ask" ? "searching" : "writing",
          asked,
        },
      ]);
      setPending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const done = await call(
          {
            onDelta: (delta) => {
              setMessages((current) =>
                current.map((message) =>
                  message.id === answerId
                    ? { ...message, text: message.text + delta, phase: "writing" }
                    : message,
                ),
              );
            },
            onStatus: (phase) => {
              patch(answerId, { phase });
            },
          },
          controller.signal,
        );
        patch(answerId, {
          text: done.answer,
          sources: done.sources,
          status: "done",
          outcome: done.outcome,
          ...(done.doc === undefined ? {} : { doc: done.doc }),
          ...(done.notice === undefined ? {} : { notice: done.notice }),
        });
        queryClient.setQueryData<BianUsageResponse>(bianKeys.usage(slug), (old) =>
          old === undefined ? old : { ...old, usage: done.usage },
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          patch(answerId, { status: "done" });
        } else if (error instanceof ApiError && error.code === "LIMIT_REACHED") {
          const details = error.details as { scope?: string; blocked?: boolean } | undefined;
          patch(answerId, {
            status: "limit",
            limit: {
              scope: details?.scope === "person" ? "person" : "workspace",
              blocked: details?.blocked === true,
            },
          });
          void queryClient.invalidateQueries({ queryKey: bianKeys.usage(slug) });
        } else {
          patch(answerId, { status: "error", text: errorText(error) });
        }
      } finally {
        setPending(false);
        abortRef.current = null;
      }
    },
    [slug, patch, queryClient],
  );

  const send = useCallback(
    (question: string, history: HistoryTurn[]) => {
      const text = question.trim();
      if (text === "") return Promise.resolve();
      return run(text, { kind: "ask", question: text, history }, (handlers, signal) =>
        askBian(slug, { question: text, history }, handlers, signal),
      );
    },
    [run, slug],
  );

  const runTask = useCallback(
    (task: BianTask) =>
      run(
        task.kind === "summarize"
          ? texts.bian.summarizeLabel(task.name)
          : texts.bian.changesLabel(task.name),
        task,
        (handlers, signal) => runBianTask(slug, task, handlers, signal),
      ),
    [run, slug],
  );

  const again = useCallback(
    (message: ChatMessage) => {
      if (message.asked === undefined) return Promise.resolve();
      return message.asked.kind === "ask"
        ? send(message.asked.question, message.asked.history)
        : runTask(message.asked);
    },
    [send, runTask],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  // Cada valoración en curso (para que un segundo toque rápido espere el id del primero).
  const saving = useRef(new Map<number, Promise<string>>());

  /**
   * Tocar 👍 o 👎 guarda la valoración en el servidor; tocar el elegido otra vez la quita; tocar el
   * otro la cambia. Se ve al instante y, si falla, vuelve atrás.
   */
  const rate = useCallback(
    (message: ChatMessage, rating: "UP" | "DOWN") => {
      const before = {
        rated: message.rated,
        reason: message.reason,
        feedbackId: message.feedbackId,
      };
      const pendingId = saving.current.get(message.id);
      const fail = () => {
        patch(message.id, before);
        toast.error(texts.bian.rateError);
      };
      const idOf = async (): Promise<string | undefined> =>
        pendingId === undefined ? message.feedbackId : await pendingId;
      if (message.rated === rating) {
        patch(message.id, { rated: undefined, reason: undefined, feedbackId: undefined });
        saving.current.delete(message.id);
        void idOf()
          .then((id) => (id === undefined ? undefined : bianApi.feedbackRemove(slug, id)))
          .catch(fail);
        return;
      }
      patch(message.id, { rated: rating, reason: undefined });
      const existing = message.feedbackId;
      if (existing === undefined && pendingId === undefined) {
        const request = bianApi
          .feedback(
            slug,
            rating,
            message.sources.map((source) => source.nodeId),
          )
          .then((result) => {
            patch(message.id, { feedbackId: result.id });
            return result.id;
          });
        saving.current.set(message.id, request);
        request.then(
          () => {
            toast.success(texts.bian.thanks);
          },
          () => {
            saving.current.delete(message.id);
            fail();
          },
        );
      } else {
        void idOf()
          .then((id) =>
            id === undefined ? undefined : bianApi.feedbackUpdate(slug, id, { rating }),
          )
          .then(() => {
            toast.success(texts.bian.thanks);
          })
          .catch(fail);
      }
    },
    [slug, patch],
  );

  /** El motivo (opcional) de un 👎. */
  const giveReason = useCallback(
    (message: ChatMessage, reason: FeedbackReason) => {
      patch(message.id, { reason });
      const pendingId = saving.current.get(message.id);
      void (async () => {
        const id = pendingId === undefined ? message.feedbackId : await pendingId;
        if (id !== undefined) await bianApi.feedbackUpdate(slug, id, { reason });
      })().catch(() => {
        patch(message.id, { reason: undefined });
        toast.error(texts.bian.rateError);
      });
    },
    [slug, patch],
  );

  return { messages, pending, send, runTask, again, stop, reset, rate, giveReason };
}

// ─── Texto que aparece palabra por palabra ───────────────────────────────────────────────

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Muestra el texto de a una palabra (más rápido si se acumula atraso). Con movimiento reducido, todo
 * junto. Si el texto cambia (la respuesta final reemplaza al borrador), sigue desde donde estaba.
 */
function useRevealed(target: string): string {
  const [count, setCount] = useState(0);
  const behind = count < target.length;
  useEffect(() => {
    if (!behind) return;
    if (prefersReducedMotion()) {
      setCount(target.length);
      return;
    }
    const id = window.setInterval(() => {
      setCount((current) => {
        let next = current;
        const words = 1 + Math.floor((target.length - current) / 160);
        for (let i = 0; i < words && next < target.length; i += 1) {
          const rest = /^\s*\S+\s*/.exec(target.slice(next));
          next += rest === null ? target.length - next : rest[0].length;
        }
        return Math.min(next, target.length);
      });
    }, 32);
    return () => {
      window.clearInterval(id);
    };
  }, [behind, target]);
  return target.slice(0, count);
}

// ─── Mensajes ────────────────────────────────────────────────────────────────────────────

/** El texto de la respuesta con las citas [n] como pastillas numeradas (se resaltan en pareja). */
function AnswerText({
  text,
  message,
  slug,
  active,
  onActive,
  onNavigate,
}: {
  text: string;
  message: ChatMessage;
  slug: string;
  active: number | null;
  onActive: (n: number | null) => void;
  onNavigate: () => void;
}) {
  const parts: ReactNode[] = [];
  const pattern = /\s?\[(\d+)\]/g;
  let last = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    parts.push(text.slice(last, match.index));
    const n = Number(match[1]);
    const source = message.sources.find((candidate) => candidate.n === n);
    const pill =
      "mx-0.5 inline-flex size-[18px] -translate-y-px items-center justify-center rounded-full text-[11px] font-semibold leading-none align-middle";
    parts.push(
      source === undefined ? (
        <span key={match.index} className={cn(pill, "bg-muted text-muted-foreground")}>
          {n}
        </span>
      ) : (
        <Link
          key={match.index}
          to={sourcePath(slug, source)}
          onClick={onNavigate}
          onMouseEnter={() => {
            onActive(n);
          }}
          onMouseLeave={() => {
            onActive(null);
          }}
          onFocus={() => {
            onActive(n);
          }}
          onBlur={() => {
            onActive(null);
          }}
          aria-label={texts.bian.sourceLabel(n)}
          className={cn(
            pill,
            "bg-primary-soft text-primary-soft-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            active === n && "bg-primary text-primary-foreground",
          )}
        >
          {n}
        </Link>
      ),
    );
    last = match.index + match[0].length;
    match = pattern.exec(text);
  }
  parts.push(text.slice(last));
  return <p className="whitespace-pre-wrap break-words text-sm leading-[1.6]">{parts}</p>;
}

/** Las filas de una tabla citada: encabezado y solo lo que importa para la pregunta. */
function SourceTable({ table }: { table: NonNullable<BianSource["table"]> }) {
  return (
    <div className="mt-1.5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col" className="px-2 py-1 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((value, column) => (
                <td key={column} className="px-2 py-1 align-top text-foreground">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.omitted > 0 && (
        <p className="border-t border-border px-2 py-1 text-muted-foreground">
          {texts.bian.moreRows(table.omitted)}
        </p>
      )}
    </div>
  );
}

/** Las fuentes agrupadas por documento: una tarjeta por documento, desplegable, con sus fragmentos. */
function Sources({
  sources,
  slug,
  active,
  onActive,
  onNavigate,
}: {
  sources: BianSource[];
  slug: string;
  active: number | null;
  onActive: (n: number | null) => void;
  onNavigate: () => void;
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  if (sources.length === 0) return null;

  // Un grupo por documento, en el orden de su primera cita; los fragmentos conservan su número [n].
  const groups = new Map<string, BianSource[]>();
  for (const source of sources) {
    groups.set(source.nodeId, [...(groups.get(source.nodeId) ?? []), source]);
  }
  const toggle = (nodeId: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(nodeId)) next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {texts.bian.sources}
      </p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {[...groups].map(([nodeId, items]) => {
          const first = items[0];
          if (first === undefined) return null;
          const isOpen = opened.has(nodeId);
          const hasActive = items.some((item) => item.n === active);
          // «CÓDIGO · vN · vigente · N fragmentos» (las fuentes son siempre la versión vigente).
          const head = [
            first.code,
            first.version === null ? null : texts.bian.version(first.version),
            first.code === null && first.version === null ? null : texts.bian.current,
            texts.bian.fragments(items.length),
          ].filter((part) => part !== null);
          const panelId = `bian-doc-${nodeId}`;
          return (
            <li
              key={nodeId}
              className={cn(
                "rounded-xl border border-border text-xs transition-colors",
                hasActive && "border-primary/40 bg-primary-soft",
              )}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                title={isOpen ? texts.bian.hideFragments : texts.bian.showFragments}
                onClick={() => {
                  toggle(nodeId);
                }}
                className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <ChevronRight
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">
                    {head.join(" · ")}
                  </span>
                  <span className="block truncate text-muted-foreground">{first.title}</span>
                </span>
              </button>
              {isOpen && (
                <ol id={panelId} className="m-0 grid list-none gap-1.5 px-2 pb-2 pl-3 pt-0">
                  {items.map((source) => (
                    <li key={source.n}>
                      <Link
                        to={sourcePath(slug, source)}
                        onClick={onNavigate}
                        onMouseEnter={() => {
                          onActive(source.n);
                        }}
                        onMouseLeave={() => {
                          onActive(null);
                        }}
                        onFocus={() => {
                          onActive(source.n);
                        }}
                        onBlur={() => {
                          onActive(null);
                        }}
                        title={texts.bian.seeSource}
                        className={cn(
                          "flex gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                          active === source.n && "border-primary/40 bg-background",
                        )}
                      >
                        <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-soft-foreground">
                          {source.n}
                        </span>
                        <span className="min-w-0 flex-1">
                          {source.heading !== null && (
                            <span className="block truncate font-medium text-foreground">
                              {source.heading}
                            </span>
                          )}
                          {source.table !== undefined ? (
                            <SourceTable table={source.table} />
                          ) : (
                            source.quote !== "" && (
                              <span className="mt-0.5 line-clamp-3 block text-muted-foreground">
                                «{source.quote}»
                              </span>
                            )
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** El documento sobre el que trabajó Bian, con enlace para abrirlo. */
function DocChip({
  doc,
  slug,
  onNavigate,
}: {
  doc: NonNullable<BianDone["doc"]>;
  slug: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={docPath(slug, doc)}
      onClick={onNavigate}
      className="mt-3 block rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="font-medium text-foreground">
        {[doc.code, doc.version === null ? null : texts.bian.version(doc.version), doc.title]
          .filter((part) => part !== null)
          .join(" · ")}
      </span>
    </Link>
  );
}

const iconButton =
  "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 disabled:hover:bg-transparent";

/** «Pedir más consultas»: avisa a los administradores de Bian (una vez por mes). */
function RequestMore({ slug }: { slug: string }) {
  const request = useMutation({
    mutationFn: () => bianApi.requestMore(slug),
    onSuccess: ({ notified }) => {
      toast.success(notified > 0 ? texts.bian.requestSent : texts.bian.requestAlready);
    },
    onError: () => {
      toast.error(texts.bian.rateError);
    },
  });
  return (
    <button
      type="button"
      disabled={request.isPending || request.isSuccess}
      onClick={() => {
        request.mutate();
      }}
      className="w-fit rounded-lg border border-current px-2.5 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
    >
      {texts.bian.requestMore}
    </button>
  );
}

function Message({
  message,
  slug,
  onNavigate,
  onRate,
  onReason,
  onAgain,
  busy,
}: {
  message: ChatMessage;
  slug: string;
  onNavigate: () => void;
  onRate: (rating: "UP" | "DOWN") => void;
  onReason: (reason: FeedbackReason) => void;
  onAgain: () => void;
  busy: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const shown = useRevealed(message.role === "assistant" ? message.text : "");
  if (message.role === "user") {
    // La pregunta de la persona, a la derecha.
    return (
      <div className="bian-fade-in ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary-soft px-3.5 py-2 text-sm leading-[1.6] text-primary-soft-foreground">
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    );
  }
  if (message.status === "limit") {
    const personal = message.limit?.scope === "person";
    const blocked = message.limit?.blocked === true;
    return (
      <div className="bian-fade-in grid gap-2 rounded-xl border border-warning/40 bg-warning-soft p-4 text-warning-soft-foreground">
        <div className="flex items-center gap-2">
          <Gauge className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-sm font-semibold">
            {blocked ? texts.bian.blockedTitle : personal ? texts.bian.limitPersonTitle : texts.bian.limitTitle}
          </p>
        </div>
        <p className="text-sm">
          {blocked ? texts.bian.blockedText : personal ? texts.bian.limitPersonText : texts.bian.limitText}
        </p>
        {/* El total de la empresa o el propio: se les avisa a quienes administran Bian. */}
        <RequestMore slug={slug} />
      </div>
    );
  }
  if (message.status === "error") {
    return (
      <div className="bian-fade-in grid gap-2 rounded-xl border border-danger/40 bg-danger-soft p-4 text-danger-soft-foreground">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-sm font-semibold">{texts.bian.errorTitle}</p>
        </div>
        <p className="text-sm">{message.text === "" ? texts.bian.error : message.text}</p>
        <p className="text-xs">{texts.bian.error}</p>
        {message.asked !== undefined && (
          <button
            type="button"
            disabled={busy}
            onClick={onAgain}
            className="flex w-fit items-center gap-1.5 rounded-lg border border-current px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            {texts.bian.retry}
          </button>
        )}
      </div>
    );
  }
  const waiting = message.status === "streaming" && message.text === "";
  const complete = message.status === "done" && shown.length >= message.text.length;
  // La respuesta de Bian, a la izquierda y sin burbuja, con su avatar chico (la coleta se mueve
  // mientras trabaja).
  return (
    <div className="bian-fade-in flex gap-2.5 pr-3">
      <BianAvatar busy={message.status === "streaming"} className="mt-0.5 h-6 shrink-0" />
      <div className="min-w-0 flex-1">
        {waiting ? (
          <p role="status" className="bian-shimmer w-fit text-sm">
            {message.phase === "writing" ? texts.bian.writing : texts.bian.thinking}
          </p>
        ) : (
          <AnswerText
            text={shown}
            message={message}
            slug={slug}
            active={active}
            onActive={setActive}
            onNavigate={onNavigate}
          />
        )}
        {complete && (
          <>
            {message.notice !== undefined && (
              <p className="mt-2 text-xs text-muted-foreground">{message.notice}</p>
            )}
            {message.doc !== undefined && (
              <DocChip doc={message.doc} slug={slug} onNavigate={onNavigate} />
            )}
            <Sources
              sources={message.sources}
              slug={slug}
              active={active}
              onActive={setActive}
              onNavigate={onNavigate}
            />
            {/* Acciones discretas: solo íconos. */}
            <div className="mt-2 flex items-center gap-0.5">
              <button
                type="button"
                aria-label={texts.bian.copy}
                title={texts.bian.copy}
                className={iconButton}
                onClick={() => {
                  navigator.clipboard.writeText(message.text).then(
                    () => {
                      toast.success(texts.bian.copied);
                    },
                    () => {
                      toast.error(texts.errors.generic);
                    },
                  );
                }}
              >
                <Copy className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
              {message.outcome === "answered" && (
                <>
                  <button
                    type="button"
                    aria-label={texts.bian.helpful}
                    aria-pressed={message.rated === "UP"}
                    title={texts.bian.helpful}
                    onClick={() => {
                      setReasonOpen(false);
                      onRate("UP");
                    }}
                    className={cn(
                      iconButton,
                      message.rated === "UP" && "bg-primary-soft text-primary hover:text-primary",
                    )}
                  >
                    <ThumbsUp className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  {/* 👎: guarda al tocar y ofrece, sin obligar, el motivo. */}
                  <DropdownMenu
                    open={reasonOpen}
                    onOpenChange={(next) => {
                      if (!next) setReasonOpen(false);
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={texts.bian.notHelpful}
                        aria-pressed={message.rated === "DOWN"}
                        title={texts.bian.notHelpful}
                        onClick={() => {
                          setReasonOpen(message.rated !== "DOWN");
                          onRate("DOWN");
                        }}
                        className={cn(
                          iconButton,
                          message.rated === "DOWN" &&
                            "bg-primary-soft text-primary hover:text-primary",
                        )}
                      >
                        <ThumbsDown className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start" className="w-56">
                      <DropdownMenuLabel>{texts.bian.reasonTitle}</DropdownMenuLabel>
                      {FEEDBACK_REASONS.map((reason) => (
                        <DropdownMenuItem
                          key={reason}
                          onSelect={() => {
                            onReason(reason);
                          }}
                        >
                          <span
                            className={cn(message.reason === reason && "font-medium text-primary")}
                          >
                            {texts.bian.reasons[reason]}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              {message.asked !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onAgain}
                  aria-label={texts.bian.askAgain}
                  title={texts.bian.askAgain}
                  className={iconButton}
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Bienvenida ──────────────────────────────────────────────────────────────────────────

/** Preguntas sugeridas a partir de los documentos recientes de la persona (sin llamar a la IA). */
/** Un título más largo que esto no entra en una sugerencia. */
const SHORT_TITLE = 40;

function useSuggestions(slug: string, enabled: boolean): string[] {
  const recent = useQuery({
    queryKey: [...bianKeys.usage(slug), "recent-docs"],
    queryFn: () => documentsApi.recent(slug, 4),
    enabled,
    staleTime: 60_000,
    select: (page) => page.items,
  });
  // Nunca se corta un título: se usa el código (si es controlado) o el título entero, y un título
  // largo no se sugiere (cortado, la pregunta se volvería confusa).
  const chips = recent.data?.flatMap((item, index) => {
    const make = texts.bian.recentChips[index % texts.bian.recentChips.length];
    if (make === undefined) return [];
    if (item.code !== null) return [make.code(item.code)];
    return item.node.name.length <= SHORT_TITLE ? [make.title(item.node.name)] : [];
  });
  return chips === undefined || chips.length === 0 ? [...texts.bian.suggestions] : chips;
}

/** Un ícono distinto para cada sugerencia (siempre en el color primario). */
const SUGGESTION_ICONS = [FileText, ClipboardList, ShieldCheck, CalendarClock] as const;

function Welcome({
  name,
  suggestions,
  onPick,
}: {
  name: string;
  suggestions: string[];
  onPick: (question: string) => void;
}) {
  const t = texts.bian;
  return (
    <div className="bian-fade-in -mx-4 -mt-4 grid gap-5 pb-2">
      {/* Zona superior con un fondo violeta muy suave. */}
      <div className="grid justify-items-center gap-1.5 bg-primary-soft/50 px-4 pb-6 pt-8 text-center">
        <BianAvatar className="bian-sway h-16 w-auto" />
        <p className="mt-2 text-[18px] font-semibold leading-7">{t.greeting(name)}</p>
        <p className="max-w-[16rem] text-sm text-muted-foreground">{t.welcomeSubtitle}</p>
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 px-4">
        {suggestions.slice(0, 4).map((suggestion, index) => {
          const Icon = SUGGESTION_ICONS[index % SUGGESTION_ICONS.length] ?? FileText;
          return (
            <li key={suggestion} className="min-w-0">
              <button
                type="button"
                onClick={() => {
                  onPick(suggestion);
                }}
                className="flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border bg-background p-3 text-left text-sm leading-5 transition-colors hover:border-primary/50 hover:bg-primary-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Icon className="size-[18px] text-primary" strokeWidth={1.75} aria-hidden="true" />
                <span className="line-clamp-4 break-words">{suggestion}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────────────────

export function BianPanel({
  open,
  onOpenChange,
  slug,
  request,
  onRequestTaken,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** Puede abrir Administración › Bian (mismo criterio que el menú). */
  canManage: boolean;
  /** Lo que viene de otra pantalla (Ctrl+K, un documento): se envía al abrir. */
  request: BianRequest | null;
  onRequestTaken: () => void;
}) {
  const t = texts.bian;
  const { account } = useAuth();
  const firstName = account?.user.name.split(" ")[0] ?? "";
  const chat = useBianChat(slug);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const usage = useQuery({
    queryKey: bianKeys.usage(slug),
    queryFn: () => bianApi.usage(slug),
    enabled: open,
    staleTime: 30_000,
  });
  const availability = usage.data?.availability;
  const unavailable = availability !== undefined && !availability.available;
  const noAccess = usage.data?.usage.personal.blocked === true;
  const suggestions = useSuggestions(slug, open && chat.messages.length === 0);

  const history = (): HistoryTurn[] =>
    chat.messages
      .filter((message) => message.status === "done" && message.text !== "")
      .slice(-MAX_HISTORY)
      .map((message) => ({ role: message.role, content: message.text.slice(0, 2000) }));

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "" || chat.pending || unavailable || noAccess) return;
    const turns = history();
    setText("");
    void chat.send(trimmed, turns);
  };

  // Lo que llega de otra pantalla se envía una sola vez, apenas se sabe que Bian está disponible.
  useEffect(() => {
    if (!open || request === null || availability === undefined) return;
    onRequestTaken();
    if (!availability.available || chat.pending) return;
    if (request.kind === "ask") submit(request.question);
    else void chat.runTask(request);
  }, [open, request, availability]);

  // El campo crece con el texto (hasta unas seis líneas).
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${String(Math.min(input.scrollHeight, 150))}px`;
  }, [text, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: "end",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [chat.messages]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(text);
  };
  const close = () => {
    onOpenChange(false);
  };

  // «Te quedan N de M este mes»: lo menor entre lo personal y lo de la empresa.
  const personal = usage.data?.usage.personal;
  const usageLimit = personal?.limit ?? usage.data?.usage.limit ?? null;
  const remaining = usage.data?.usage.remaining ?? null;
  const usageLine =
    usage.data === undefined
      ? null
      : usageLimit === null || remaining === null
        ? t.footerUnlimited
        : t.footer(remaining, usageLimit);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-fade fixed inset-0 z-40 bg-foreground/30" />
        <DialogPrimitive.Content
          className="bian-panel fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col bg-background shadow-pop focus:outline-none max-sm:inset-0 max-sm:w-full"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="sr-only">{t.panelTitle}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t.subtitle}
          </DialogPrimitive.Description>
          <div className="bian-panel-body flex h-full min-h-0 flex-col">
            {/* Cabecera simple: avatar chico, nombre y cerrar. */}
            <header className="flex items-center gap-2.5 px-4 py-3">
              <BianAvatar busy={chat.pending} className="h-7 shrink-0" />
              <h2 className="flex-1 text-base font-semibold">{t.panelTitle}</h2>
              {chat.messages.length > 0 && (
                <button
                  type="button"
                  onClick={chat.reset}
                  aria-label={t.newChat}
                  title={t.newChat}
                  className={iconButton}
                >
                  <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
              <DialogPrimitive.Close aria-label={t.close} className={iconButton}>
                <X className="size-4" strokeWidth={1.75} />
              </DialogPrimitive.Close>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {usage.isPending && <Skeleton className="h-16 w-full" />}
              {unavailable && (
                <Banner
                  tone="info"
                  {...(availability.reason === "workspace" && canManage
                    ? {
                        action: (
                          <Link
                            to={`/app/${slug}/admin/bian`}
                            onClick={close}
                            className="w-fit rounded-lg border border-current px-2.5 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            {t.unavailable.openSettings}
                          </Link>
                        ),
                      }
                    : {})}
                >
                  {t.unavailable[availability.reason]}
                </Banner>
              )}
              {!unavailable && noAccess && (
                <Banner tone="info" action={<RequestMore slug={slug} />}>
                  {t.blockedText}
                </Banner>
              )}
              {!unavailable && chat.messages.length === 0 && usage.data !== undefined && (
                <Welcome name={firstName} suggestions={suggestions} onPick={submit} />
              )}
              <div className="grid gap-5" aria-live="polite">
                {chat.messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    slug={slug}
                    onNavigate={close}
                    busy={chat.pending}
                    onRate={(rating) => {
                      chat.rate(message, rating);
                    }}
                    onReason={(reason) => {
                      chat.giveReason(message, reason);
                    }}
                    onAgain={() => {
                      void chat.again(message);
                    }}
                  />
                ))}
              </div>
              <div ref={endRef} />
            </div>

            <form onSubmit={onSubmit} className="px-4 pb-3 pt-2">
              {/* Campo redondeado (14 px) con el botón de enviar circular adentro. */}
              <div className="relative rounded-[14px] border border-input bg-background transition-shadow focus-within:ring-2 focus-within:ring-ring/40">
                <Textarea
                  ref={inputRef}
                  value={text}
                  rows={1}
                  maxLength={1000}
                  placeholder={t.placeholder}
                  aria-label={t.placeholder}
                  disabled={unavailable || noAccess}
                  className="max-h-[150px] min-h-11 resize-none border-0 bg-transparent py-3 pl-3.5 pr-12 leading-5 shadow-none focus-visible:ring-0"
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit(text);
                    }
                  }}
                />
                {chat.pending ? (
                  <button
                    type="button"
                    onClick={chat.stop}
                    aria-label={t.stop}
                    title={t.stop}
                    className="absolute bottom-1.5 right-1.5 grid size-8 place-items-center rounded-full border border-border bg-background hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <Square className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={text.trim() === "" || unavailable}
                    aria-label={t.send}
                    title={t.send}
                    className="absolute bottom-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
              {usageLine !== null && (
                <p className="mt-2 text-center text-[11px] text-muted-foreground/80">{usageLine}</p>
              )}
            </form>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
