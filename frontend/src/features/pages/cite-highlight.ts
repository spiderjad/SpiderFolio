// Al abrir una página desde una fuente de Bian (?cita=…), se busca ese texto en la página, se lo
// resalta (CSS Custom Highlight, sin tocar el documento) y se lo lleva a la vista. El resaltado se
// va solo a los pocos segundos.
import { useEffect, type RefObject } from "react";
import { useSearchParams } from "react-router";

const HIGHLIGHT = "bian-cite";
const HIGHLIGHT_MS = 8000;

const compact = (text: string): string => text.replace(/\s+/g, "").toLowerCase();

/** El rango de la página que contiene el texto (sin importar saltos ni espacios), o null. */
export function findQuoteRange(root: HTMLElement, quote: string): Range | null {
  const wanted = compact(quote).slice(0, 100);
  if (wanted === "") return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const spans: { node: Text; start: number }[] = [];
  let haystack = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    spans.push({ node, start: haystack.length });
    haystack += compact(node.data);
  }
  const at = haystack.indexOf(wanted);
  if (at === -1) return null;
  /** Posición dentro del nodo (en su texto original) de la letra número `index` sin espacios. */
  const place = (index: number): { node: Text; offset: number } | null => {
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i];
      if (span === undefined || span.start > index) continue;
      let remaining = index - span.start;
      for (let offset = 0; offset < span.node.data.length; offset += 1) {
        if (/\s/.test(span.node.data.charAt(offset))) continue;
        if (remaining === 0) return { node: span.node, offset };
        remaining -= 1;
      }
      return { node: span.node, offset: span.node.data.length };
    }
    return null;
  };
  const from = place(at);
  const to = place(at + wanted.length - 1);
  if (from === null || to === null) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, Math.min(to.offset + 1, to.node.data.length));
  return range;
}

export function useCitationHighlight(container: RefObject<HTMLElement | null>) {
  const [params] = useSearchParams();
  const quote = params.get("cita");
  useEffect(() => {
    const root = container.current;
    if (quote === null || root === null || !("highlights" in CSS)) return;
    let timer: number | undefined;
    // Espera a que el editor pinte el texto.
    const start = window.setTimeout(() => {
      const range = findQuoteRange(root, quote);
      if (range === null) return;
      CSS.highlights.set(HIGHLIGHT, new Highlight(range));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      range.startContainer.parentElement?.scrollIntoView({
        block: "center",
        behavior: reduce ? "auto" : "smooth",
      });
      timer = window.setTimeout(() => {
        CSS.highlights.delete(HIGHLIGHT);
      }, HIGHLIGHT_MS);
    }, 250);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(timer);
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [container, quote]);
}
