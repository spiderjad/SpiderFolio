// Al pasar el mouse por un bloque aparecen a su izquierda un «+» (abre el menú de bloques debajo) y
// el asa «⋮⋮» para arrastrarlo y reordenar. Solo bloques de primer nivel; con el documento editable
// y en pantallas con mouse.
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { GripVertical, Plus } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { texts } from "@/i18n";

interface Hovered {
  pos: number;
  top: number;
  left: number;
}

export function BlockHandles({
  editor,
  containerRef,
}: {
  editor: Editor;
  /** El contenedor (relativo) que envuelve al editor: de él se mide dónde poner las asas. */
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const t = texts.pages.handles;
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || !editor.isEditable) return;
    const place = (event: MouseEvent) => {
      const dom = editor.view.dom;
      const box = dom.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) {
        setHovered(null);
        return;
      }
      const x = Math.min(Math.max(event.clientX, box.left + 1), box.right - 1);
      const found = editor.view.posAtCoords({ left: x, top: event.clientY });
      if (found === null || found.inside < 0) return;
      const $inside = editor.state.doc.resolve(found.inside);
      const pos = $inside.depth === 0 ? found.inside : $inside.before(1);
      const block = editor.view.nodeDOM(pos);
      if (!(block instanceof HTMLElement)) return;
      const rect = block.getBoundingClientRect();
      const outer = container.getBoundingClientRect();
      setHovered({ pos, top: rect.top - outer.top, left: box.left - outer.left });
    };
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        place(event);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame.current);
      setHovered(null);
    };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame.current);
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, containerRef]);

  if (hovered === null || !editor.isEditable) return null;
  const node = editor.state.doc.nodeAt(hovered.pos);
  if (node === null) return null;

  const addBelow = () => {
    const empty = node.type.name === "paragraph" && node.content.size === 0;
    if (empty) {
      editor
        .chain()
        .focus()
        .setTextSelection(hovered.pos + 1)
        .insertContent("/")
        .run();
      return;
    }
    const end = hovered.pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(end + 2)
      .focus()
      .run();
  };

  const onDragStart = (event: DragEvent) => {
    const view = editor.view;
    const selection = NodeSelection.create(view.state.doc, hovered.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    const block = view.nodeDOM(hovered.pos);
    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/plain", " ");
    event.dataTransfer.effectAllowed = "move";
    if (block instanceof HTMLElement) event.dataTransfer.setDragImage(block, 0, 0);
    view.dragging = { slice: selection.content(), move: true };
  };

  return (
    <div
      className="absolute z-10 hidden items-center gap-0.5 md:flex print:hidden"
      style={{ top: hovered.top + 2, left: hovered.left - 58 }}
    >
      <button
        type="button"
        aria-label={t.add}
        title={t.add}
        onClick={addBelow}
        className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        draggable
        aria-label={t.drag}
        title={t.drag}
        onDragStart={onDragStart}
        className="grid size-6 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <GripVertical className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
