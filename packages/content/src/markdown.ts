// Pages as Markdown for the connector for Claude (docs/spec/conector-mcp.md), both ways, with the
// product's schema. To Markdown: every node, those without an equivalent as a readable reference
// (image, mention, file, link to a page). From Markdown: CommonMark (headings, lists, quotes, code,
// rules, bold, italic, code, links); images and HTML have no place in a page made this way and are
// dropped, and the result says so. The JSON then goes through validateContent like any other.
import {
  defaultMarkdownParser,
  MarkdownParser,
  MarkdownSerializer,
  type MarkdownSerializerState,
} from "prosemirror-markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { contentSchema } from "./extensions.ts";

const text = (node: PmNode) => node.textContent.replace(/\s+/gu, " ").trim();

const block =
  (render: (state: MarkdownSerializerState, node: PmNode) => void) =>
  (state: MarkdownSerializerState, node: PmNode) => {
    render(state, node);
    state.closeBlock(node);
  };

function table(state: MarkdownSerializerState, node: PmNode) {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(text(cell).replace(/\|/gu, "\\|")));
    rows.push(cells);
  });
  const width = Math.max(0, ...rows.map((row) => row.length));
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  rows.forEach((row, index) => {
    state.write(line(row));
    state.ensureNewLine();
    if (index === 0) {
      state.write(`|${" --- |".repeat(width)}`);
      state.ensureNewLine();
    }
  });
  state.closeBlock(node);
}

let serializer: MarkdownSerializer | undefined;

function markdownSerializer(): MarkdownSerializer {
  serializer ??= new MarkdownSerializer(
    {
      doc: (state, node) => {
        state.renderContent(node);
      },
      paragraph: (state, node) => {
        state.renderInline(node);
        state.closeBlock(node);
      },
      heading: (state, node) => {
        state.write(`${"#".repeat(Number(node.attrs.level) || 1)} `);
        state.renderInline(node);
        state.closeBlock(node);
      },
      blockquote: (state, node) => {
        state.wrapBlock("> ", null, node, () => {
          state.renderContent(node);
        });
      },
      codeBlock: (state, node) => {
        const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
        state.write(`\`\`\`${language}\n`);
        state.text(node.textContent, false);
        state.ensureNewLine();
        state.write("```");
        state.closeBlock(node);
      },
      horizontalRule: (state, node) => {
        state.write("---");
        state.closeBlock(node);
      },
      hardBreak: (state) => {
        state.write("\\\n");
      },
      bulletList: (state, node) => {
        state.renderList(node, "  ", () => "- ");
      },
      orderedList: (state, node) => {
        const start = Number(node.attrs.start) || 1;
        state.renderList(node, "   ", (i) => `${String(start + i)}. `);
      },
      listItem: (state, node) => {
        state.renderContent(node);
      },
      taskList: (state, node) => {
        state.renderList(node, "  ", (i) =>
          node.child(i).attrs.checked === true ? "- [x] " : "- [ ] ",
        );
      },
      taskItem: (state, node) => {
        state.renderContent(node);
      },
      table,
      tableRow: () => undefined,
      tableHeader: () => undefined,
      tableCell: () => undefined,
      callout: (state, node) => {
        state.wrapBlock("> ", null, node, () => {
          state.renderContent(node);
        });
      },
      toggle: (state, node) => {
        state.renderContent(node);
      },
      toggleSummary: block((state, node) => {
        state.write("**");
        state.renderInline(node);
        state.write("**");
      }),
      columns: (state, node) => {
        state.renderContent(node);
      },
      column: (state, node) => {
        state.renderContent(node);
      },
      pageImage: block((state, node) => {
        const alt =
          typeof node.attrs.alt === "string" && node.attrs.alt !== "" ? node.attrs.alt : "imagen";
        state.write(`[${state.esc(alt)}]`);
      }),
      fileEmbed: block((state, node) => {
        const name = typeof node.attrs.name === "string" ? node.attrs.name : "archivo";
        state.write(`[${state.esc(name)}]`);
      }),
      pageLink: (state, node) => {
        const title = typeof node.attrs.title === "string" ? node.attrs.title : "página";
        state.write(`[${state.esc(title)}]`);
      },
      mention: (state, node) => {
        const label = typeof node.attrs.label === "string" ? node.attrs.label : "";
        state.write(`@${state.esc(label)}`);
      },
      text: (state, node) => {
        state.text(node.text ?? "");
      },
    },
    {
      bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
      italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
      strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
      underline: { open: "", close: "" },
      code: { open: "`", close: "`", escape: false },
      link: {
        open: "[",
        close: (_state, mark) => {
          const href = typeof mark.attrs.href === "string" ? mark.attrs.href : "";
          return `](${href.replace(/[()]/gu, "\\$&")})`;
        },
      },
      commentThread: { open: "", close: "" },
      muted: { open: "", close: "" },
      highlight: { open: "", close: "" },
    },
    { strict: false },
  );
  return serializer;
}

/** A page's content (ProseMirror JSON) as Markdown. */
export function contentToMarkdown(doc: unknown): string {
  const node = contentSchema().nodeFromJSON(doc);
  return markdownSerializer().serialize(node, { tightLists: true }).trim();
}

let parser: MarkdownParser | undefined;

function markdownParser(): MarkdownParser {
  const ignore = { ignore: true, noCloseToken: true } as const;
  parser ??= new MarkdownParser(contentSchema(), defaultMarkdownParser.tokenizer, {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (token) => ({ start: Number(token.attrGet("start")) || 1 }),
    },
    heading: {
      block: "heading",
      getAttrs: (token) => ({ level: Math.min(3, Number(token.tag.slice(1)) || 1) }),
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (token) => ({ language: token.info.trim() || null }),
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    link: {
      mark: "link",
      getAttrs: (token) => ({ href: token.attrGet("href") }),
    },
    code_inline: { mark: "code", noCloseToken: true },
    // No images or raw HTML in a page written this way (counted, and the answer says so).
    image: ignore,
    html_block: ignore,
    html_inline: ignore,
  });
  return parser;
}

/**
 * Markdown as a page's content (ProseMirror JSON, still to validate), and how many pieces had no
 * place in a page (images, HTML).
 */
export function markdownToContent(markdown: string): { doc: unknown; dropped: number } {
  type Token = ReturnType<typeof defaultMarkdownParser.tokenizer.parse>[number];
  const count = (tokens: readonly Token[]): number =>
    tokens.reduce(
      (sum, token) =>
        sum +
        (token.type === "image" || token.type.startsWith("html_") ? 1 : 0) +
        count(token.children ?? []),
      0,
    );
  const tokens = defaultMarkdownParser.tokenizer.parse(markdown, {});
  return { doc: markdownParser().parse(markdown).toJSON(), dropped: count(tokens) };
}
