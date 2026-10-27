// Índice automático de la página: los títulos H1–H3 a la derecha, fijo al hacer scroll. Solo se
// muestra con 3 títulos o más; tocar uno lleva hasta él.
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

/** Con menos títulos que estos, un índice no ayuda. */
export const MIN_TOC_HEADINGS = 3;

export interface TocEntry {
  pos: number;
  level: number;
  text: string;
}

const sameEntries = (a: TocEntry[] | null, b: TocEntry[] | null): boolean =>
  a !== null &&
  b !== null &&
  a.length === b.length &&
  a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      entry.pos === other.pos &&
      entry.level === other.level &&
      entry.text === other.text
    );
  });

/** Los títulos con texto, en orden; se recalcula en cada cambio del documento. */
export function useHeadings(editor: Editor): TocEntry[] {
  return useEditorState({
    editor,
    selector: ({ editor: current }): TocEntry[] => {
      const entries: TocEntry[] = [];
      current.state.doc.descendants((node, pos) => {
        const level: unknown = node.attrs.level;
        if (node.type.name === "heading" && typeof level === "number" && level <= 3) {
          const text = node.textContent.trim();
          if (text !== "") entries.push({ pos, level, text });
        }
        return node.type.name !== "heading";
      });
      return entries;
    },
    equalityFn: sameEntries,
  });
}

export function PageToc({ editor, entries }: { editor: Editor; entries: TocEntry[] }) {
  const t = texts.pages.toc;
  const go = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <nav
      aria-label={t.title}
      className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto print:hidden"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t.title}
      </p>
      <ul className="m-0 grid list-none gap-0.5 border-l border-border p-0">
        {entries.map((entry) => (
          <li key={entry.pos}>
            <button
              type="button"
              onClick={() => {
                go(entry.pos);
              }}
              className={cn(
                "block w-full truncate py-1 pr-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                entry.level === 1 && "pl-3 font-medium",
                entry.level === 2 && "pl-6",
                entry.level === 3 && "pl-9 text-xs",
              )}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
