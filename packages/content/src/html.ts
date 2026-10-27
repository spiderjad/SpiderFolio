// Una página (documento Tiptap) como HTML para el PDF controlado. Todo texto se escapa y solo se
// generan las etiquetas del schema del producto: nada de lo que viene en el documento se inserta
// como HTML. Los enlaces solo pueden ser web o de correo; las imágenes llegan resueltas por quien
// llama (como data: URI), nunca como una dirección del documento.
import type { JSONContent } from "@tiptap/core";
import { ALLOWED_LINK } from "./extensions.ts";

export interface HtmlOptions {
  /** Dirección (data: URI) de una imagen de la página; null si no está disponible. */
  imageSrc?: (imageId: string) => string | null;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

function marked(node: JSONContent): string {
  let html = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      case "link": {
        const href: unknown = mark.attrs?.href;
        if (typeof href === "string" && ALLOWED_LINK.test(href)) {
          html = `<a href="${escapeHtml(href)}">${html}</a>`;
        }
        break;
      }
      default:
        break;
    }
  }
  return html;
}

function inline(nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case "text":
          return marked(node);
        case "hardBreak":
          return "<br>";
        case "mention":
          return `@${escapeHtml(String(node.attrs?.label ?? ""))}`;
        case "pageLink":
          return "[enlace]";
        default:
          return inline(node.content);
      }
    })
    .join("");
}

function children(node: JSONContent, options: HtmlOptions): string {
  return (node.content ?? []).map((child) => block(child, options)).join("");
}

function block(node: JSONContent, options: HtmlOptions): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inline(node.content)}</p>`;
    case "heading": {
      const raw: unknown = node.attrs?.level;
      const level = typeof raw === "number" && raw >= 1 && raw <= 3 ? raw : 1;
      return `<h${String(level)}>${inline(node.content)}</h${String(level)}>`;
    }
    case "bulletList":
      return `<ul>${children(node, options)}</ul>`;
    case "orderedList":
      return `<ol>${children(node, options)}</ol>`;
    case "taskList":
      return `<ul class="tasks">${children(node, options)}</ul>`;
    case "listItem":
      return `<li>${children(node, options)}</li>`;
    case "taskItem":
      return `<li><span class="box">${node.attrs?.checked === true ? "☑" : "☐"}</span> ${children(node, options)}</li>`;
    case "blockquote":
      return `<blockquote>${children(node, options)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml((node.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "table":
      return `<table>${(node.content ?? []).map((row) => block(row, options)).join("")}</table>`;
    case "tableRow":
      return `<tr>${children(node, options)}</tr>`;
    case "tableHeader":
      return `<th>${children(node, options)}</th>`;
    case "tableCell":
      return `<td>${children(node, options)}</td>`;
    case "callout": {
      const tone = ["info", "warning", "danger", "success"].find((t) => t === node.attrs?.tone);
      return `<div class="callout ${tone ?? "info"}">${children(node, options)}</div>`;
    }
    case "pageImage": {
      const id: unknown = node.attrs?.imageId;
      const src = typeof id === "string" ? options.imageSrc?.(id) : null;
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src === null || src === undefined
        ? `<p class="missing">[Imagen${alt === "" ? "" : `: ${escapeHtml(alt)}`}]</p>`
        : `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></figure>`;
    }
    case "fileEmbed":
      return `<p class="missing">[Archivo incrustado]</p>`;
    case "toggleSummary":
      return `<p class="summary">${inline(node.content)}</p>`;
    case "toggle":
      return `<div class="toggle">${children(node, options)}</div>`;
    case "columns":
      return `<div class="columns">${children(node, options)}</div>`;
    case "column":
      return `<div class="column">${children(node, options)}</div>`;
    default:
      return children(node, options);
  }
}

/** El cuerpo de la página como HTML (sin <html> ni <head>). */
export function contentToHtml(doc: JSONContent, options: HtmlOptions = {}): string {
  return children(doc, options);
}
