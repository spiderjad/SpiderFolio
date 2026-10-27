// Piezas para armar las plantillas de página (page-templates-*.ts).
import type { JSONContent } from "@tiptap/core";

export const text = (value: string, muted = false): JSONContent => ({
  type: "text",
  text: value,
  ...(muted ? { marks: [{ type: "muted" }] } : {}),
});
export const p = (value?: string, muted = true): JSONContent => ({
  type: "paragraph",
  ...(value === undefined ? {} : { content: [text(value, muted)] }),
});
export const h = (level: 1 | 2 | 3, value: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
export const items = (type: "bulletList" | "orderedList", values: string[]): JSONContent => ({
  type,
  content: values.map((value) => ({ type: "listItem", content: [p(value)] })),
});
export const tasks = (values: string[]): JSONContent => ({
  type: "taskList",
  content: values.map((value) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [p(value)],
  })),
});
export const callout = (tone: "info" | "warning" | "danger" | "success", value: string): JSONContent => ({
  type: "callout",
  attrs: { tone },
  content: [p(value, false)],
});
/** Tabla con fila de encabezado; las celdas de ejemplo van en gris. */
export const table = (headers: string[], rows: string[][]): JSONContent => ({
  type: "table",
  content: [
    {
      type: "tableRow",
      content: headers.map((header) => ({
        type: "tableHeader",
        content: [{ type: "paragraph", content: [text(header)] }],
      })),
    },
    ...rows.map((row) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: "tableCell",
        content: [cell === "" ? p() : p(cell)],
      })),
    })),
  ],
});
export const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
