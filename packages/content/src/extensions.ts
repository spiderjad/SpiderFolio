// Schema Tiptap del producto, compartido por el editor (frontend) y la validación del servidor
// (backend): un documento solo puede tener estos nodos y marcas. Los avisos, la imagen, la mención y
// el hilo de comentario son propios; la imagen guarda un `imageId` (nunca una URL).
import { mergeAttributes, Mark, Node, getSchema, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

export const CALLOUT_TONES = ["info", "warning", "danger", "success"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Aviso: un bloque destacado (información, atención, peligro, listo) con bloques adentro. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: "info",
        renderHTML: (attributes) => ({ "data-tone": String(attributes.tone) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },
});

/** Imagen de la página: solo la referencia a una `PageImage` de esa misma página. */
export const PageImage = Node.create({
  name: "pageImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      imageId: { default: null },
      alt: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-page-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-page-image": "" })];
  },
});

/** Mención @persona: solo avisa; no concede acceso. */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      membershipId: { default: null },
      label: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-mention": "" }),
      `@${String(node.attrs.label)}`,
    ];
  },
});

/**
 * Enlace interno a una página, carpeta o archivo del workspace: guarda solo el id. El nombre se pide
 * al mostrarlo, con los permisos de quien lee (sin acceso: «Documento sin acceso»).
 */
export const PageLink = Node.create({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { nodeId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-page-link]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-page-link": "" })];
  },
});

/** Archivo del workspace (PDF o imagen) mostrado dentro de la página; guarda solo el id. */
export const FileEmbed = Node.create({
  name: "fileEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { nodeId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "figure[data-file-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-file-embed": "" })];
  },
});

/** Título de un desplegable. */
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-toggle-summary]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-summary": "" }), 0];
  },
});

/** Desplegable: un título y los bloques que se muestran u ocultan. */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0];
  },
});

/** Una columna: bloques sin otras columnas adentro. */
export const Column = Node.create({
  name: "column",
  content:
    "(paragraph | heading | bulletList | orderedList | taskList | blockquote | codeBlock | horizontalRule | table | callout | pageImage | fileEmbed)+",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});

/** Dos columnas. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column column",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "" }), 0];
  },
});

/** Marca de un fragmento comentado; varios hilos pueden superponerse. */
export const CommentThread = Mark.create({
  name: "commentThread",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return { threadId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "span[data-thread-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-thread-id": "" }), 0];
  },
});

/** Texto de ejemplo en gris (las plantillas): se reemplaza escribiendo encima. */
export const Muted = Mark.create({
  name: "muted",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-muted]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-muted": "" }), 0];
  },
});

/** Los enlaces solo pueden ser web o de correo. */
export const ALLOWED_LINK = /^(https?:\/\/|mailto:)/i;

export const contentExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["mailto"],
      isAllowedUri: (uri) => ALLOWED_LINK.test(uri),
    },
  }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  PageImage,
  Mention,
  PageLink,
  FileEmbed,
  ToggleSummary,
  Toggle,
  Column,
  Columns,
  CommentThread,
  Muted,
];

let cached: ReturnType<typeof getSchema> | undefined;

/** El schema de ProseMirror del producto (se arma una sola vez). */
export function contentSchema() {
  cached ??= getSchema(contentExtensions);
  return cached;
}
