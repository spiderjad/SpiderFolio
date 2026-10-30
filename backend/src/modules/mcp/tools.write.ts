// The connector's write tools (docs/spec/conector-mcp.md): only with the docs:write scope, which needs
// the paid plugin (mcp_write) and a full seat. The same services as the app, so permissions, limits,
// controlled documents (editing a published one creates a draft) and the audit are the app's own.
// What the connector never does: publish or approve, confirm readings, delete or trash (moving never
// replaces), change permissions, members or settings.
import { Readable } from "node:stream";
import { contentToMarkdown, markdownToContent } from "@spiderfolio/content";
import { z } from "zod";
import type { AppDeps } from "../../routes.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { mentionDepsOf } from "../comments/mentions.service.ts";
import { createThread, reply } from "../comments/comments.service.ts";
import { approverOptions, submitForReview } from "../documents/approvals.service.ts";
import { listDocumentTypes, makeControlled } from "../documents/documents.service.ts";
import { completeUpload, startUpload } from "../files/files.service.ts";
import { createFolder, moveNode } from "../nodes/nodes.service.ts";
import { createPage, getPage, savePage } from "../nodes/pages.service.ts";
import { appLinks, failure, markVia, result, toolError, untrusted } from "./mcp.common.ts";
import type { ToolDefinition } from "./tools.read.ts";

const Id = z.string().min(1).max(64);
const Markdown = z.string().max(200_000);
const DocType = z.string().trim().min(1).max(20);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const write = (idempotent = false) =>
  ({ readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent }) as const;

/** Nodes a Markdown round trip would lose: such a page is only appended to or replaced on purpose. */
const LOSSY = new Set([
  "pageImage",
  "fileEmbed",
  "mention",
  "pageLink",
  "table",
  "taskList",
  "callout",
  "toggle",
  "columns",
]);
function hasLossyContent(doc: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (typeof node !== "object" || node === null) return false;
    const { type, content } = node as { type?: unknown; content?: unknown };
    if (typeof type === "string" && LOSSY.has(type)) return true;
    return Array.isArray(content) && content.some(walk);
  };
  return walk(doc);
}

/** Text of a node and its children, for comparing a heading with the title. */
function textOf(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const { text, content } = node as { text?: unknown; content?: unknown };
  const own = typeof text === "string" ? text : "";
  return own + (Array.isArray(content) ? content.map(textOf).join("") : "");
}

/** The page shows its title above the content: a first heading that repeats it is dropped. */
function withoutTitleHeading(doc: unknown, title: string): unknown {
  const { content, ...rest } = doc as { content?: unknown[] };
  const [first, ...others] = content ?? [];
  const same = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();
  const heading = (first as { type?: unknown } | undefined)?.type === "heading";
  return heading && same(textOf(first)) === same(title) ? { ...rest, content: others } : doc;
}

const droppedNote = (dropped: number) =>
  dropped === 0
    ? undefined
    : `${String(dropped)} images or HTML blocks had no place in a page and were left out.`;

export function writeTools(deps: AppDeps): ToolDefinition[] {
  const links = (ctx: AdminContext) => appLinks(deps.env.APP_URL, ctx.tenant.workspaceSlug);
  const mentions = mentionDepsOf(deps);

  return [
    {
      name: "create_page",
      title: "Create a page",
      description:
        "Creates a page from Markdown in a space or folder the user can edit. Headings, lists, quotes, code, links, bold and italic are kept; images and HTML are left out. The title is shown above the content: don't repeat it as the first heading. With documentType it's created as a controlled document in draft (it gets its code, e.g. PRC-004); it's never published or approved here: people do that in SpiderFolio.",
      inputSchema: {
        spaceId: Id,
        folderId: Id.optional().describe("A folder inside the space; omit for the space's root"),
        title: z.string().trim().min(1).max(255),
        markdown: Markdown,
        documentType: DocType.optional().describe(
          "Make it a controlled document of this type, by its code (e.g. PRC); omit for a normal page. An unknown code answers with the company's types",
        ),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({
            spaceId: Id,
            folderId: Id.optional(),
            title: z.string().trim().min(1).max(255),
            markdown: Markdown,
            documentType: DocType.optional(),
          })
          .parse(args);
        const since = new Date();
        const docType = input.documentType?.toUpperCase();
        if (docType !== undefined) {
          const types = await listDocumentTypes(ctx);
          if (!types.some((type) => type.code === docType)) {
            const known = types.map((type) => `${type.code} (${type.name})`).join(", ");
            return failure(`Unknown document type "${docType}". The company's types: ${known}.`);
          }
        }
        const { doc, dropped } = markdownToContent(input.markdown);
        const page = await createPage(ctx, input.spaceId, {
          parentId: input.folderId ?? null,
          name: input.title,
          content: withoutTitleHeading(doc, input.title),
        });
        const notes = [droppedNote(dropped)];
        let controlled: { code: string; status: "DRAFT" } | undefined;
        if (docType !== undefined) {
          try {
            const info = await makeControlled(ctx, page.node.id, { docType });
            if (info.controlled !== null)
              controlled = { code: info.controlled.code, status: "DRAFT" };
          } catch (error) {
            const reason = toolError(error).content[0]?.text ?? "";
            notes.push(
              `The page was created, but it couldn't be made a controlled document: ${reason}`,
            );
          }
        }
        await markVia(ctx, page.node.id, since);
        const note = notes.filter((text) => text !== undefined).join(" ");
        return result({
          id: page.node.id,
          title: page.node.name,
          revision: page.revision,
          ...(controlled === undefined ? {} : { controlled }),
          link: links(ctx).page(page.space.id, page.node.id),
          note: note === "" ? undefined : note,
        });
      },
    },
    {
      name: "update_page",
      title: "Edit a page",
      description:
        "Edits a page: replace all of it, append at the end, or replace an exact piece of its Markdown (as get_page returns it). expectedVersion is the page's revision from get_page; if someone changed it since, nothing is saved and the current content comes back. Editing a published controlled document creates a new draft: the published version doesn't change until a person approves and publishes it.",
      inputSchema: {
        pageId: Id,
        expectedVersion: z.number().int().min(0).describe("revision from get_page"),
        mode: z.enum(["replace", "append", "replace_text"]),
        markdown: Markdown.describe("The new content, what to append, or what replaces `find`"),
        find: z
          .string()
          .min(1)
          .max(20_000)
          .optional()
          .describe("replace_text: the exact Markdown to replace"),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({
            pageId: Id,
            expectedVersion: z.number().int().min(0),
            mode: z.enum(["replace", "append", "replace_text"]),
            markdown: Markdown,
            find: z.string().min(1).max(20_000).optional(),
          })
          .parse(args);
        const since = new Date();
        const page = await getPage(ctx, input.pageId);
        const current = contentToMarkdown(page.content);
        if (page.revision !== input.expectedVersion) {
          return {
            ...result(
              {
                conflict: true,
                message:
                  "The page changed since you read it. Nothing was saved: this is the current content.",
                revision: page.revision,
              },
              untrusted(current),
            ),
            isError: true,
          };
        }
        let doc: unknown;
        let dropped: number;
        if (input.mode === "replace") {
          ({ doc, dropped } = markdownToContent(input.markdown));
          doc = withoutTitleHeading(doc, page.node.name);
        } else if (input.mode === "append") {
          const added = markdownToContent(input.markdown);
          dropped = added.dropped;
          const base = page.content as { type: string; content?: unknown[] };
          const extra = (added.doc as { content?: unknown[] }).content ?? [];
          doc = { ...base, content: [...(base.content ?? []), ...extra] };
        } else {
          if (hasLossyContent(page.content)) {
            return failure(
              "This page has images, tables or other content that can't be edited as Markdown. Use mode append, or edit it in SpiderFolio.",
            );
          }
          const find = input.find ?? "";
          const at = current.indexOf(find);
          if (find === "" || at === -1 || current.indexOf(find, at + 1) !== -1) {
            return failure(
              "`find` has to appear exactly once in the page's Markdown (as get_page returns it).",
            );
          }
          ({ doc, dropped } = markdownToContent(
            current.slice(0, at) + input.markdown + current.slice(at + find.length),
          ));
        }
        const saved = await savePage(ctx, mentions, input.pageId, {
          baseRevision: input.expectedVersion,
          content: doc,
        });
        await auditAdmin(ctx, {
          action: "page.update",
          entityType: "Node",
          entityId: input.pageId,
          metadata: { mode: input.mode },
        });
        await markVia(ctx, input.pageId, since);
        return result({
          id: input.pageId,
          revision: saved.revision,
          link: links(ctx).page(page.space.id, input.pageId),
          note: droppedNote(dropped),
        });
      },
    },
    {
      name: "create_folder",
      title: "Create a folder",
      description: "Creates a folder in a space or inside another folder the user can edit.",
      inputSchema: {
        spaceId: Id,
        parentId: Id.optional().describe("The folder to create it in; omit for the space's root"),
        name: z.string().trim().min(1).max(255),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({ spaceId: Id, parentId: Id.optional(), name: z.string().trim().min(1).max(255) })
          .parse(args);
        const since = new Date();
        const node = await createFolder(ctx, input.spaceId, {
          parentId: input.parentId ?? null,
          name: input.name,
        });
        await markVia(ctx, node.id, since);
        return result({
          id: node.id,
          name: node.name,
          link: links(ctx).folder(node.spaceId, node.id),
        });
      },
    },
    {
      name: "move_node",
      title: "Move a page, folder or file",
      description:
        "Moves a page, folder or file to another folder or space of the same company. If something with the same name is already there, nothing moves.",
      inputSchema: {
        nodeId: Id,
        folderId: Id.nullable().describe("Destination folder; null for the space's root"),
        spaceId: Id.optional().describe("Destination space, if it's another one"),
      },
      annotations: write(true),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({ nodeId: Id, folderId: Id.nullable(), spaceId: Id.optional() })
          .parse(args);
        const since = new Date();
        // Never REPLACE: that would send what's there to the trash.
        const node = await moveNode(ctx, input.nodeId, {
          parentId: input.folderId,
          ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
          onConflict: "FAIL",
        });
        await markVia(ctx, node.id, since);
        return result({
          id: node.id,
          name: node.name,
          spaceId: node.spaceId,
          parentId: node.parentId,
        });
      },
    },
    {
      name: "upload_file",
      title: "Upload a file",
      description:
        "Uploads a small file (up to 10 MB, as base64) to a space or folder the user can edit. The company's allowed types, size limit and quota apply. If a file with that name exists, both are kept.",
      inputSchema: {
        spaceId: Id,
        folderId: Id.optional(),
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe("File name with its extension, e.g. informe.pdf"),
        contentBase64: z.string().min(1).max(14_000_000),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({
            spaceId: Id,
            folderId: Id.optional(),
            name: z.string().trim().min(1).max(255),
            contentBase64: z.string().min(1).max(14_000_000),
          })
          .parse(args);
        const bytes = Buffer.from(input.contentBase64, "base64");
        if (bytes.length === 0) return failure("The file is empty or isn't valid base64.");
        if (bytes.length > MAX_UPLOAD_BYTES)
          return failure("Files over 10 MB are uploaded in SpiderFolio.");
        const since = new Date();
        const fileDeps = { storage: deps.storage, jobs: deps.jobs };
        const ticket = await startUpload(ctx, fileDeps, input.spaceId, {
          parentId: input.folderId ?? null,
          name: input.name,
          size: bytes.length,
          onConflict: "keep_both",
        });
        const reservation = await ctx.db.uploadReservation.findFirst({
          where: { id: ticket.id },
          select: { storageKey: true },
        });
        if (reservation === null) return failure("The upload could not start.");
        await deps.storage.putStream(reservation.storageKey, Readable.from(bytes), {
          size: bytes.length,
          contentType: ticket.contentType,
        });
        const uploaded = await completeUpload(ctx, fileDeps, ticket.id);
        await markVia(ctx, uploaded.node.id, since);
        return result({
          id: uploaded.node.id,
          name: uploaded.node.name,
          version: uploaded.version.version,
          sizeBytes: uploaded.version.sizeBytes,
          link: links(ctx).folder(uploaded.node.spaceId, uploaded.node.parentId),
        });
      },
    },
    {
      name: "add_comment",
      title: "Comment on a page",
      description:
        "Adds a comment to a page, or replies in an open thread (threadId). Needs at least comment access.",
      inputSchema: {
        pageId: Id,
        body: z.string().trim().min(1).max(4000),
        threadId: Id.optional().describe("Reply in this thread instead of starting one"),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({ pageId: Id, body: z.string().trim().min(1).max(4000), threadId: Id.optional() })
          .parse(args);
        if (input.threadId === undefined) {
          const created = await createThread(ctx, mentions, input.pageId, { body: input.body });
          return result({ threadId: created.thread.id });
        }
        const replied = await reply(ctx, mentions, input.pageId, input.threadId, input.body);
        await auditAdmin(ctx, {
          action: "comment.reply",
          entityType: "Node",
          entityId: input.pageId,
          metadata: { threadId: input.threadId },
        });
        return result({ threadId: replied.thread.id });
      },
    },
    {
      name: "submit_for_review",
      title: "Send a draft for review",
      description:
        "Sends the draft of a controlled document for approval. Without approverIds it answers with who can approve it, to ask the user. It never approves or publishes.",
      inputSchema: {
        nodeId: Id,
        approverIds: z.array(Id).min(1).max(10).optional(),
        changeNote: z.string().trim().max(500).optional(),
      },
      annotations: write(),
      write: true,
      async run(ctx, args) {
        const input = z
          .object({
            nodeId: Id,
            approverIds: z.array(Id).min(1).max(10).optional(),
            changeNote: z.string().trim().max(500).optional(),
          })
          .parse(args);
        if (input.approverIds === undefined) {
          const options = await approverOptions(ctx, input.nodeId, undefined);
          const view = (option: { id: string; name: string; jobTitle: string | null }) => ({
            id: option.id,
            name: option.name,
            jobTitle: option.jobTitle,
          });
          return result({
            needsApprovers: true,
            message: "Ask the user who should approve it, then call again with approverIds.",
            suggested: options.suggested.map(view),
            others: options.others.slice(0, 20).map(view),
          });
        }
        await submitForReview(ctx, deps, input.nodeId, {
          approverIds: input.approverIds,
          ...(input.changeNote === undefined ? {} : { changeNote: input.changeNote }),
        });
        return result({ submitted: true, nodeId: input.nodeId });
      },
    },
  ];
}
