// Menciones con @: en el texto de la página (menú que se abre al escribir «@»), en los comentarios
// (campo de texto con menú de personas) y el aviso «no tiene acceso» con la opción de dar acceso
// (la decide quien gestiona la página; mencionar nunca da acceso). En un comentario, la mención se
// guarda como `@[Nombre](id)` y se muestra como un chip.
import type { Editor } from "@tiptap/core";
import { useQuery } from "@tanstack/react-query";
import { UserRound, UserX } from "lucide-react";
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/display";
import { Textarea } from "@/components/ui/form";
import { ShareDialog } from "@/features/sharing/share-dialog";
import { pagesApi, type MentionCandidate, type WithoutAccess } from "@/features/files/api";
import { cn } from "@/lib/utils";
import { createSuggestionExtension, type SlashBridge, type SlashItem } from "./slash-menu";
import { texts } from "@/i18n";

const t = texts.pages.mentions;

// ─── En el texto de la página ────────────────────────────────────────────────────────────

/** Menú «@» del editor: personas del directorio; marca a quienes todavía no ven la página. */
export function createMentionExtension(
  bridge: SlashBridge,
  load: (query: string) => Promise<MentionCandidate[]>,
) {
  return createSuggestionExtension({
    name: "mentionSuggestion",
    char: "@",
    bridge,
    getItems: async (query) => {
      const people = await load(query);
      return people.map((person): SlashItem => ({
        id: person.id,
        title: person.name,
        description: person.hasAccess ? (person.jobTitle ?? "") : t.noAccessShort,
        keywords: "",
        icon: person.hasAccess ? UserRound : UserX,
        run: (editor: Editor, range) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { membershipId: person.id, label: person.name } },
              { type: "text", text: " " },
            ])
            .run();
        },
      }));
    },
  });
}

// ─── En los comentarios ──────────────────────────────────────────────────────────────────

const TOKEN = /@\[([^\]\n]{1,80})\]\(([a-z0-9]{10,40})\)/gu;

/** El texto de un comentario con las menciones como chips (nunca HTML). */
export function renderCommentBody(body: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) parts.push(body.slice(last, at));
    parts.push(
      <span
        key={`${String(at)}:${match[2] ?? ""}`}
        className="rounded bg-primary-soft px-1 font-medium text-primary-soft-foreground"
      >
        @{match[1]}
      </span>,
    );
    last = at + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

/** Campo de texto de un comentario: al escribir «@» ofrece personas para mencionar. */
export function MentionTextarea({
  slug,
  pageId,
  value,
  onChange,
  onSubmit,
  rows,
  placeholder,
  label,
  autoFocus,
}: {
  slug: string;
  pageId: string;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+Enter. */
  onSubmit?: () => void;
  rows: number;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@[\]]{0,30})$/u.exec(before);
  const query = match?.[1] ?? null;
  const people = useQuery({
    queryKey: ["w", slug, "pages", pageId, "mention-candidates", query],
    queryFn: () => pagesApi.mentionCandidates(slug, pageId, query ?? ""),
    enabled: query !== null,
    staleTime: 20_000,
  });
  const items = query === null ? [] : (people.data?.items ?? []);

  const pick = (person: MentionCandidate) => {
    if (match === null) return;
    const start = caret - (match[1] ?? "").length - 1;
    const token = `@[${person.name.replace(/[\]\n]/g, " ")}](${person.id}) `;
    const next = `${value.slice(0, start)}${token}${value.slice(caret)}`;
    onChange(next);
    const position = start + token.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex(
          (current) =>
            (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const person = items[Math.min(index, items.length - 1)];
        if (person !== undefined) pick(person);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCaret(0);
        return;
      }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onSubmit !== undefined) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={4000}
        autoFocus={autoFocus === true}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setIndex(0);
        }}
        onClick={(event) => {
          setCaret(event.currentTarget.selectionStart);
        }}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
            setCaret(event.currentTarget.selectionStart);
          }
        }}
        onKeyDown={onKeyDown}
      />
      {items.length > 0 && (
        <ul
          role="listbox"
          aria-label={t.people}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 list-none overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-pop"
        >
          {items.map((person, position) => (
            <li key={person.id} role="option" aria-selected={position === index}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(person);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                  position === index && "bg-muted",
                )}
              >
                <Avatar name={person.name} src={person.avatarUrl} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                {!person.hasAccess && (
                  <span className="shrink-0 text-xs text-muted-foreground">{t.noAccessShort}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── «No tiene acceso» ───────────────────────────────────────────────────────────────────

/**
 * Avisa quiénes mencionados no ven la página y, si se puede gestionar, ofrece darles acceso: abre
 * «Compartir» (un solo camino para dar acceso).
 */
export function useAccessNotice({
  pageId,
  spaceId,
  pageName,
  canManage,
}: {
  pageId: string;
  spaceId: string;
  pageName: string;
  canManage: boolean;
}) {
  const [sharing, setSharing] = useState(false);

  const notify = (people: WithoutAccess) => {
    for (const person of people) {
      toast.warning(t.noAccess(person.name), {
        duration: 12_000,
        description: canManage ? t.noAccessManage : t.noAccessAsk,
        ...(canManage
          ? {
              action: {
                label: t.giveAccess,
                onClick: () => {
                  setSharing(true);
                },
              },
            }
          : {}),
      });
    }
  };

  const dialog = (
    <ShareDialog
      subject={sharing ? { type: "node", id: pageId, name: pageName, spaceId } : null}
      onClose={() => {
        setSharing(false);
      }}
    />
  );

  return { notify, dialog };
}
