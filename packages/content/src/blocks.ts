// El texto de una página, bloque por bloque y en una forma tipo Markdown, para compararla con otra
// versión. No es una conversión completa a Markdown (eso llega con el conector MCP): alcanza para
// ver qué cambió. Cada bloque (párrafo, título, ítem de lista, fila de tabla…) es una línea.
import type { JSONContent } from "@tiptap/core";

function inline(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  if (node.type === "mention") return `@${String(node.attrs?.label ?? "")}`;
  if (node.type === "pageLink") return "[enlace]";
  return (node.content ?? []).map(inline).join("");
}

function collect(node: JSONContent, out: string[], prefix: string): void {
  const children = node.content ?? [];
  switch (node.type) {
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      const text = inline(node).trim();
      if (text !== "") out.push(`${"#".repeat(level)} ${text}`);
      return;
    }
    case "paragraph":
    case "toggleSummary": {
      const text = inline(node).trim();
      if (text !== "") out.push(node.type === "toggleSummary" ? `▸ ${text}` : `${prefix}${text}`);
      return;
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      children.forEach((item, index) => {
        const marker =
          node.type === "orderedList"
            ? `${String(index + 1)}.`
            : node.type === "taskList"
              ? `- [${item.attrs?.checked === true ? "x" : " "}]`
              : "-";
        // El primer párrafo del ítem lleva el marcador; lo que sigue (sublistas) se indenta.
        (item.content ?? []).forEach((child, position) => {
          if (position === 0 && child.type === "paragraph") {
            const text = inline(child).trim();
            if (text !== "") out.push(`${prefix}${marker} ${text}`);
          } else {
            collect(child, out, `${prefix}  `);
          }
        });
      });
      return;
    }
    case "blockquote":
      for (const child of children) collect(child, out, `${prefix}> `);
      return;
    case "codeBlock": {
      const text = inline(node).trim();
      if (text !== "") out.push(`${prefix}\`${text.replaceAll("\n", " ⏎ ")}\``);
      return;
    }
    case "horizontalRule":
      out.push("---");
      return;
    case "table":
      for (const row of children) {
        const cells = (row.content ?? []).map((cell) =>
          (cell.content ?? []).map(inline).join(" ").trim(),
        );
        out.push(`${prefix}| ${cells.join(" | ")} |`);
      }
      return;
    case "callout": {
      const tone = typeof node.attrs?.tone === "string" ? node.attrs.tone : "info";
      for (const child of children) collect(child, out, `${prefix}[${tone}] `);
      return;
    }
    case "pageImage":
      out.push(
        `${prefix}[Imagen${typeof node.attrs?.alt === "string" && node.attrs.alt !== "" ? `: ${node.attrs.alt}` : ""}]`,
      );
      return;
    case "fileEmbed":
      out.push(`${prefix}[Archivo incrustado]`);
      return;
    default:
      // doc, toggle, columns, column y lo que venga: se recorre su contenido.
      for (const child of children) collect(child, out, prefix);
  }
}

/** Las líneas de texto de un documento Tiptap, en orden de lectura. */
export function contentToBlocks(doc: JSONContent): string[] {
  const out: string[] = [];
  collect(doc, out, "");
  return out;
}
