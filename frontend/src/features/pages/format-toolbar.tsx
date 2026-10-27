// Barra flotante al seleccionar texto (negrita, cursiva, enlace…) y barra de contexto para tablas y
// avisos. Los botones usan mousedown con preventDefault para no quitarle el foco al editor.
import { ALLOWED_LINK, CALLOUT_TONES } from "@spiderfolio/content";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Columns3,
  Italic,
  Link2,
  Link2Off,
  MessageSquarePlus,
  Rows3,
  Strikethrough,
  Trash2,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

function ToolButton({
  label,
  active = false,
  onRun,
  children,
}: {
  label: string;
  active?: boolean;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => {
        event.preventDefault();
        onRun();
      }}
      className={cn(
        "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        active && "bg-primary-soft text-primary-soft-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Icon({ as: Component }: { as: LucideIcon }) {
  return <Component className="size-4" strokeWidth={1.75} aria-hidden="true" />;
}

/** Barra sobre el texto seleccionado. */
export function SelectionToolbar({
  editor,
  canFormat,
  onComment,
}: {
  editor: Editor;
  /** Con permiso de edición: negrita, enlaces y demás. */
  canFormat: boolean;
  /** Con permiso de comentar: el botón «Comentar» sobre el fragmento elegido. */
  onComment?: (anchor: { quote: string; from: number; to: number }) => void;
}) {
  const t = texts.pages.toolbar;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
    }),
  });

  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      // Un texto de solo lectura no tiene foco: la barra de comentar igual se muestra.
      if (empty || (editor.isEditable && !editor.view.hasFocus())) {
        setPosition(null);
        setLinking(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setPosition({ left: (start.left + end.left) / 2, top: Math.min(start.top, end.top) });
    };
    const hide = () => {
      // El clic en un botón de la barra no pierde el foco (mousedown preventDefault).
      setPosition(null);
      setLinking(null);
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", hide);
    editor.on("focus", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
      editor.off("focus", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  if (position === null) return null;

  const comment = () => {
    if (onComment === undefined) return;
    const { from, to } = editor.state.selection;
    const quote = editor.state.doc.textBetween(from, to, " ").trim().slice(0, 300);
    if (quote !== "") onComment({ quote, from, to });
  };

  const applyLink = () => {
    const raw = (linking ?? "").trim();
    if (raw === "") {
      editor.chain().focus().unsetLink().run();
      setLinking(null);
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    if (!ALLOWED_LINK.test(href)) {
      setLinkError(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkError(false);
    setLinking(null);
  };

  return (
    <div
      role="toolbar"
      aria-label={t.label}
      style={{
        position: "fixed",
        left: Math.max(8, Math.min(position.left - 120, window.innerWidth - 300)),
        top: Math.max(8, position.top - 48),
      }}
      className="z-40 flex items-center gap-0.5 rounded-xl border border-border bg-background p-1 shadow-pop"
    >
      {linking === null ? (
        <>
          {canFormat && (
            <>
              <ToolButton
                label={t.bold}
                active={active.bold}
                onRun={() => editor.chain().focus().toggleBold().run()}
              >
                <Icon as={Bold} />
              </ToolButton>
              <ToolButton
                label={t.italic}
                active={active.italic}
                onRun={() => editor.chain().focus().toggleItalic().run()}
              >
                <Icon as={Italic} />
              </ToolButton>
              <ToolButton
                label={t.underline}
                active={active.underline}
                onRun={() => editor.chain().focus().toggleUnderline().run()}
              >
                <Icon as={Underline} />
              </ToolButton>
              <ToolButton
                label={t.strike}
                active={active.strike}
                onRun={() => editor.chain().focus().toggleStrike().run()}
              >
                <Icon as={Strikethrough} />
              </ToolButton>
              <ToolButton
                label={t.code}
                active={active.code}
                onRun={() => editor.chain().focus().toggleCode().run()}
              >
                <Icon as={Code} />
              </ToolButton>
              {active.link ? (
                <ToolButton
                  label={t.unlink}
                  onRun={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
                >
                  <Icon as={Link2Off} />
                </ToolButton>
              ) : (
                <ToolButton
                  label={t.link}
                  onRun={() => {
                    setLinkError(false);
                    setLinking("");
                  }}
                >
                  <Icon as={Link2} />
                </ToolButton>
              )}
            </>
          )}
          {onComment !== undefined && (
            <ToolButton label={t.comment} onRun={comment}>
              <Icon as={MessageSquarePlus} />
            </ToolButton>
          )}
        </>
      ) : (
        <div className="flex items-center gap-1 px-1">
          <input
            autoFocus
            value={linking}
            aria-label={t.linkAddress}
            aria-invalid={linkError}
            placeholder={t.linkPlaceholder}
            onChange={(event) => {
              setLinking(event.target.value);
              setLinkError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setLinking(null);
                editor.commands.focus();
              }
            }}
            className={cn(
              "h-8 w-56 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              linkError ? "border-danger" : "border-input",
            )}
          />
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              applyLink();
            }}
            className="h-8 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            {t.apply}
          </button>
        </div>
      )}
    </div>
  );
}

/** Barra de contexto: aparece sobre el editor mientras el cursor está en una tabla o un aviso. */
export function ContextBar({ editor }: { editor: Editor }) {
  const t = texts.pages.toolbar;
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      table: current.isActive("table"),
      callout: current.isActive("callout"),
      tone: (current.getAttributes("callout") as { tone?: string }).tone ?? "info",
    }),
  });
  if (!editor.isEditable || (!state.table && !state.callout)) return null;
  return (
    <div
      role="toolbar"
      aria-label={t.contextLabel}
      className="sticky top-14 z-20 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-1 text-sm backdrop-blur"
    >
      {state.table && (
        <>
          <ToolButton label={t.addRow} onRun={() => editor.chain().focus().addRowAfter().run()}>
            <Icon as={Rows3} />
          </ToolButton>
          <ToolButton
            label={t.addColumn}
            onRun={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Icon as={Columns3} />
          </ToolButton>
          <ToolButton label={t.deleteRow} onRun={() => editor.chain().focus().deleteRow().run()}>
            <span className="text-xs font-medium">{t.deleteRowShort}</span>
          </ToolButton>
          <ToolButton
            label={t.deleteColumn}
            onRun={() => editor.chain().focus().deleteColumn().run()}
          >
            <span className="text-xs font-medium">{t.deleteColumnShort}</span>
          </ToolButton>
          <ToolButton
            label={t.deleteTable}
            onRun={() => editor.chain().focus().deleteTable().run()}
          >
            <Icon as={Trash2} />
          </ToolButton>
        </>
      )}
      {state.callout && (
        <>
          <span className="px-1 text-xs text-muted-foreground">{t.calloutTone}</span>
          {CALLOUT_TONES.map((tone) => (
            <ToolButton
              key={tone}
              label={t.tones[tone]}
              active={state.tone === tone}
              onRun={() => editor.chain().focus().updateAttributes("callout", { tone }).run()}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-3.5 rounded-full",
                  tone === "info" && "bg-primary",
                  tone === "warning" && "bg-warning",
                  tone === "danger" && "bg-danger",
                  tone === "success" && "bg-success",
                )}
              />
            </ToolButton>
          ))}
        </>
      )}
    </div>
  );
}
