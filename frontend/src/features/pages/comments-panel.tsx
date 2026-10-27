// Panel lateral «Comentarios» de una página: hilos generales y anclados a un fragmento, con
// respuestas, editar y borrar lo propio, resolver y reabrir. Filtros: abiertos, resueltos y míos.
// Los textos son texto plano (nunca HTML).
import type { Editor } from "@tiptap/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, Badge, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import {
  commentsApi,
  type CommentView,
  type ThreadView,
  type WithoutAccess,
} from "@/features/files/api";
import { cn, formatDateTime } from "@/lib/utils";
import { MentionTextarea, renderCommentBody } from "./mentions";
import { texts } from "@/i18n";

export type CommentFilter = "open" | "resolved" | "mine";

/** Un comentario nuevo sobre un fragmento elegido en el texto (todavía sin enviar). */
export interface AnchorDraft {
  quote: string;
  from: number;
  to: number;
}

export const commentsKey = (slug: string, pageId: string) =>
  ["w", slug, "pages", pageId, "comments"] as const;

/** Rango (en el documento) de la marca de un hilo, o null si el texto ya no está. */
export function findThreadRange(
  editor: Editor,
  threadId: string,
): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      node.marks.some(
        (mark) => mark.type.name === "commentThread" && mark.attrs.threadId === threadId,
      )
    ) {
      from = Math.min(from, pos);
      to = Math.max(to, pos + node.nodeSize);
    }
  });
  return to < 0 ? null : { from, to };
}

/** Quita del texto la marca de un hilo (si se borró el hilo). */
export function removeThreadMark(editor: Editor, threadId: string): void {
  editor
    .chain()
    .command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        for (const mark of node.marks) {
          if (mark.type.name === "commentThread" && mark.attrs.threadId === threadId) {
            tr.removeMark(pos, pos + node.nodeSize, mark);
          }
        }
      });
      return true;
    })
    .run();
}

export function CommentsPanel({
  slug,
  pageId,
  editor,
  canComment,
  draft,
  onDraftDone,
  activeThreadId,
  onWithoutAccess,
}: {
  slug: string;
  pageId: string;
  editor: Editor;
  canComment: boolean;
  draft: AnchorDraft | null;
  onDraftDone: () => void;
  activeThreadId: string | null;
  onWithoutAccess: (people: WithoutAccess) => void;
}) {
  const t = texts.pages.comments;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<CommentFilter>("open");
  const list = useInfiniteList<ThreadView>({
    queryKey: [...commentsKey(slug, pageId), "list", filter],
    fetchPage: (cursor) =>
      commentsApi.list(slug, pageId, {
        status: filter === "resolved" ? "resolved" : filter === "mine" ? "all" : "open",
        mine: filter === "mine",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: commentsKey(slug, pageId) });

  return (
    <aside aria-label={t.title} className="grid content-start gap-3">
      <div role="group" aria-label={t.filters.label} className="flex flex-wrap gap-1.5">
        {(["open", "resolved", "mine"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
            }}
            className="h-8 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
          >
            {t.filters[value]}
          </button>
        ))}
      </div>

      {canComment && (
        <Composer
          key={draft === null ? "general" : `${String(draft.from)}:${draft.quote}`}
          slug={slug}
          pageId={pageId}
          editor={editor}
          draft={draft}
          onWithoutAccess={onWithoutAccess}
          onDone={() => {
            onDraftDone();
            void refresh();
          }}
        />
      )}

      {list.query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : list.items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title={t.empty[filter]}>
          {canComment && filter === "open" ? t.emptyHint : ""}
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {list.items.map((thread) => (
            <ThreadCard
              key={thread.id}
              slug={slug}
              pageId={pageId}
              editor={editor}
              thread={thread}
              canComment={canComment}
              onWithoutAccess={onWithoutAccess}
              active={thread.id === activeThreadId}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </aside>
  );
}

// ─── Comentario nuevo ────────────────────────────────────────────────────────────────────

function Composer({
  slug,
  pageId,
  editor,
  draft,
  onDone,
  onWithoutAccess,
}: {
  slug: string;
  pageId: string;
  editor: Editor;
  draft: AnchorDraft | null;
  onDone: () => void;
  onWithoutAccess: (people: WithoutAccess) => void;
}) {
  const t = texts.pages.comments;
  const [body, setBody] = useState("");
  const create = useMutation({
    mutationFn: () =>
      commentsApi.create(slug, pageId, {
        body: body.trim(),
        ...(draft === null ? {} : { quote: draft.quote }),
      }),
    onSuccess: ({ thread, withoutAccess }) => {
      onWithoutAccess(withoutAccess);
      if (draft !== null) {
        // La marca lleva el id del hilo. Si el texto cambió de lugar, se busca el fragmento.
        const exact = editor.state.doc.textBetween(draft.from, draft.to, " ") === draft.quote;
        let range = exact ? { from: draft.from, to: draft.to } : null;
        if (range === null) {
          editor.state.doc.descendants((node, pos) => {
            if (range === null && node.isText && node.text?.includes(draft.quote) === true) {
              const start = pos + node.text.indexOf(draft.quote);
              range = { from: start, to: start + draft.quote.length };
            }
          });
        }
        if (range !== null) {
          editor
            .chain()
            .setTextSelection(range)
            .setMark("commentThread", { threadId: thread.id })
            .setTextSelection(range.to)
            .run();
        }
      }
      setBody("");
      toast.success(t.created);
      onDone();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-background p-3">
      {draft !== null && (
        <p className="border-l-2 border-warning pl-2 text-xs text-muted-foreground">
          {t.commenting}: <span className="italic">«{draft.quote}»</span>
        </p>
      )}
      <MentionTextarea
        slug={slug}
        pageId={pageId}
        value={body}
        rows={draft === null ? 2 : 3}
        autoFocus={draft !== null}
        label={draft === null ? t.newGeneral : t.newAnchored}
        placeholder={draft === null ? t.newGeneral : t.newAnchored}
        onChange={setBody}
        onSubmit={() => {
          if (body.trim() !== "") create.mutate();
        }}
      />
      <div className="flex justify-end gap-2">
        {draft !== null && (
          <Button variant="outline" size="sm" onClick={onDone}>
            {texts.admin.common.cancel}
          </Button>
        )}
        <Button
          size="sm"
          disabled={create.isPending || body.trim() === ""}
          onClick={() => {
            create.mutate();
          }}
        >
          {t.send}
        </Button>
      </div>
    </div>
  );
}

// ─── Un hilo ─────────────────────────────────────────────────────────────────────────────

function ThreadCard({
  slug,
  pageId,
  editor,
  thread,
  canComment,
  active,
  onChanged,
  onWithoutAccess,
}: {
  slug: string;
  pageId: string;
  editor: Editor;
  thread: ThreadView;
  canComment: boolean;
  active: boolean;
  onChanged: () => Promise<unknown>;
  onWithoutAccess: (people: WithoutAccess) => void;
}) {
  const t = texts.pages.comments;
  const ref = useRef<HTMLLIElement>(null);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleting, setDeleting] = useState<CommentView | null>(null);
  const open = thread.status === "OPEN";

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      await onChanged();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const locate = () => {
    const range = findThreadRange(editor, thread.id);
    if (range === null) {
      toast.info(t.textGone);
      return;
    }
    editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  };

  return (
    <li
      ref={ref}
      className={cn(
        "grid gap-3 rounded-xl border bg-background p-3",
        active ? "border-primary" : "border-border",
        !open && "opacity-80",
      )}
    >
      {thread.quote !== null && (
        <button
          type="button"
          onClick={locate}
          className="border-l-2 border-warning pl-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="line-clamp-3 italic">«{thread.quote}»</span>
        </button>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="grid gap-1">
            <div className="flex items-center gap-2">
              <Avatar
                name={comment.author?.name ?? "?"}
                src={comment.author?.avatarUrl}
                className="size-6 text-[10px]"
              />
              <span className="min-w-0 truncate text-sm font-medium">
                {comment.author?.name ?? t.formerMember}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(comment.createdAt)}
                {comment.editedAt !== null ? ` · ${t.edited}` : ""}
              </span>
              {canComment && !comment.deleted && (comment.mine || comment.canDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7"
                      aria-label={t.actions}
                    >
                      <MoreHorizontal className="size-4" strokeWidth={1.75} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {comment.mine && (
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditing(comment.id);
                          setEditText(comment.body);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        {texts.admin.common.edit}
                      </DropdownMenuItem>
                    )}
                    {comment.canDelete && (
                      <DropdownMenuItem
                        className="text-danger"
                        onSelect={() => {
                          setDeleting(comment);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        {texts.admin.common.delete}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {comment.deleted ? (
              <p className="text-sm italic text-muted-foreground">{t.deleted}</p>
            ) : editing === comment.id ? (
              <div className="grid gap-2">
                <MentionTextarea
                  slug={slug}
                  pageId={pageId}
                  value={editText}
                  rows={3}
                  autoFocus
                  label={t.editing}
                  placeholder={t.editing}
                  onChange={setEditText}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                    }}
                  >
                    {texts.admin.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    disabled={run.isPending || editText.trim() === ""}
                    onClick={() => {
                      run.mutate(async () => {
                        const result = await commentsApi.edit(
                          slug,
                          pageId,
                          thread.id,
                          comment.id,
                          editText.trim(),
                        );
                        onWithoutAccess(result.withoutAccess);
                        setEditing(null);
                      });
                    }}
                  >
                    {texts.admin.common.save}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm">
                {renderCommentBody(comment.body)}
              </p>
            )}
          </li>
        ))}
      </ul>

      {open && canComment && (
        <div className="grid gap-2">
          <MentionTextarea
            slug={slug}
            pageId={pageId}
            value={replyText}
            rows={1}
            label={t.reply}
            placeholder={t.reply}
            onChange={setReplyText}
          />
          {replyText.trim() !== "" && (
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={run.isPending}
                onClick={() => {
                  run.mutate(async () => {
                    const result = await commentsApi.reply(
                      slug,
                      pageId,
                      thread.id,
                      replyText.trim(),
                    );
                    onWithoutAccess(result.withoutAccess);
                    setReplyText("");
                  });
                }}
              >
                {t.send}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {open ? (
          <Badge tone="primary">{t.open}</Badge>
        ) : (
          <Badge>{thread.resolvedBy === null ? t.resolved : t.resolvedBy(thread.resolvedBy)}</Badge>
        )}
        {canComment && thread.canResolve && (
          <Button
            variant="ghost"
            size="sm"
            disabled={run.isPending}
            onClick={() => {
              run.mutate(async () => {
                await commentsApi.resolve(slug, pageId, thread.id, open);
              });
            }}
          >
            {open ? (
              <>
                <Check strokeWidth={1.75} aria-hidden="true" />
                {t.resolve}
              </>
            ) : (
              <>
                <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                {t.reopen}
              </>
            )}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(openState) => {
          if (!openState) setDeleting(null);
        }}
        icon={Trash2}
        title={t.confirmDelete.title}
        description={t.confirmDelete.text}
        confirmLabel={texts.admin.common.delete}
        pendingLabel={t.confirmDelete.pending}
        tone="warning"
        onConfirm={async () => {
          if (deleting === null) return;
          const result = await commentsApi.remove(slug, pageId, thread.id, deleting.id);
          // Si el hilo desapareció, su resaltado también (el autoguardado lo registra).
          if (result.threadDeleted) removeThreadMark(editor, thread.id);
          await onChanged();
        }}
      />
    </li>
  );
}
