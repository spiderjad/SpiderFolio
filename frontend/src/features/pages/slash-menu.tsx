// Menú «/» para insertar bloques (estilo Notion). La extensión usa `@tiptap/suggestion`; el menú
// es un componente de React que recibe su estado por un puente (la extensión vive fuera de React).
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import {
  AlertTriangle,
  CheckSquare,
  ChevronRight,
  Code2,
  Columns2,
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListOrdered,
  Minus,
  OctagonAlert,
  PartyPopper,
  Pilcrow,
  Quote,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  keywords: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

const callout = (tone: string) => (editor: Editor, range: Range) => {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: "callout", attrs: { tone }, content: [{ type: "paragraph" }] })
    .run();
};

const t = texts.pages.slash;

export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: "text",
    ...t.text,
    icon: Pilcrow,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "h1",
    ...t.h1,
    icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    ...t.h2,
    icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "h3",
    ...t.h3,
    icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "bullets",
    ...t.bullets,
    icon: List,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "numbers",
    ...t.numbers,
    icon: ListOrdered,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "tasks",
    ...t.tasks,
    icon: CheckSquare,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "table",
    ...t.table,
    icon: Table2,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  { id: "info", ...t.info, icon: Info, run: callout("info") },
  { id: "warning", ...t.warning, icon: AlertTriangle, run: callout("warning") },
  { id: "danger", ...t.danger, icon: OctagonAlert, run: callout("danger") },
  { id: "success", ...t.success, icon: PartyPopper, run: callout("success") },
  {
    id: "quote",
    ...t.quote,
    icon: Quote,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    ...t.code,
    icon: Code2,
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "toggle",
    ...t.toggle,
    icon: ChevronRight,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "toggle",
          content: [{ type: "toggleSummary" }, { type: "paragraph" }],
        })
        .run(),
  },
  {
    id: "columns",
    ...t.columns,
    icon: Columns2,
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "columns",
          content: [
            { type: "column", content: [{ type: "paragraph" }] },
            { type: "column", content: [{ type: "paragraph" }] },
          ],
        })
        .run(),
  },
  {
    id: "divider",
    ...t.divider,
    icon: Minus,
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export function filterSlashItems(
  query: string,
  items: readonly SlashItem[] = SLASH_ITEMS,
): SlashItem[] {
  const needle = normalize(query.trim());
  return items.filter(
    (item) => needle === "" || normalize(`${item.title} ${item.keywords}`).includes(needle),
  );
}

export interface SlashState {
  items: SlashItem[];
  index: number;
  rect: { left: number; top: number; bottom: number };
  pick: (item: SlashItem) => void;
}

/** Puente entre la extensión (fuera de React) y el menú (dentro). */
export interface SlashBridge {
  set: (state: SlashState | null) => void;
}

/** Menú que aparece al escribir un carácter («/» para bloques, «@» para personas). */
export function createSuggestionExtension({
  name,
  char,
  bridge,
  getItems,
  allowSpaces = false,
}: {
  name: string;
  char: string;
  allowSpaces?: boolean;
  bridge: SlashBridge;
  getItems: (query: string) => SlashItem[] | Promise<SlashItem[]>;
}) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          pluginKey: new PluginKey(name),
          editor: this.editor,
          char,
          startOfLine: false,
          allowSpaces,
          items: ({ query }) => getItems(query),
          command: ({ editor, range, props }) => {
            props.run(editor, range);
          },
          render: () => {
            let index = 0;
            let items: SlashItem[] = [];
            let pick: (item: SlashItem) => void = () => undefined;
            let rect: (() => DOMRect | null) | null | undefined;
            const publish = () => {
              const box = rect?.();
              if (box === null || box === undefined || items.length === 0) {
                bridge.set(null);
                return;
              }
              bridge.set({
                items,
                index,
                rect: { left: box.left, top: box.top, bottom: box.bottom },
                pick,
              });
            };
            return {
              onStart: (props) => {
                items = props.items;
                index = 0;
                pick = (item) => {
                  props.command(item);
                };
                rect = props.clientRect;
                publish();
              },
              onUpdate: (props) => {
                items = props.items;
                index = Math.min(index, Math.max(0, items.length - 1));
                pick = (item) => {
                  props.command(item);
                };
                rect = props.clientRect;
                publish();
              },
              onKeyDown: ({ event }) => {
                if (items.length === 0) return false;
                if (event.key === "ArrowDown") {
                  index = (index + 1) % items.length;
                  publish();
                  return true;
                }
                if (event.key === "ArrowUp") {
                  index = (index - 1 + items.length) % items.length;
                  publish();
                  return true;
                }
                if (event.key === "Enter") {
                  const item = items[index];
                  if (item !== undefined) pick(item);
                  return true;
                }
                if (event.key === "Escape") {
                  bridge.set(null);
                  return true;
                }
                return false;
              },
              onExit: () => {
                bridge.set(null);
              },
            };
          },
        }),
      ];
    },
  });
}

export function createSlashExtension(bridge: SlashBridge, extraItems: readonly SlashItem[] = []) {
  const all = [...SLASH_ITEMS, ...extraItems];
  return createSuggestionExtension({
    name: "slashCommand",
    char: "/",
    bridge,
    getItems: (query) => filterSlashItems(query, all),
  });
}

/** El menú desplegado junto al cursor. */
export function SlashMenu({ state }: { state: SlashState | null }) {
  const [below, setBelow] = useState(true);
  useEffect(() => {
    if (state !== null) setBelow(state.rect.bottom + 320 < window.innerHeight);
  }, [state]);
  if (state === null) return null;
  return (
    <div
      role="listbox"
      aria-label={texts.pages.slash.label}
      style={{
        position: "fixed",
        left: Math.max(8, Math.min(state.rect.left, window.innerWidth - 300)),
        ...(below
          ? { top: state.rect.bottom + 6 }
          : { bottom: window.innerHeight - state.rect.top + 6 }),
      }}
      className="z-50 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-pop"
    >
      {state.items.map((item, position) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={position === state.index}
          // mousedown: no le quita el foco al editor.
          onMouseDown={(event) => {
            event.preventDefault();
            state.pick(item);
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
            position === state.index && "bg-muted",
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
            <item.icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
