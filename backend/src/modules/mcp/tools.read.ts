// The connector's read tools (docs/spec/conector-mcp.md «Herramientas»): the same services as the app,
// with the person's permissions checked again on every call. Descriptions are fixed text, never built
// from anyone's content; document text goes back delimited as untrusted data.
import { contentToMarkdown } from "@spiderfolio/content";
import { z } from "zod";
import type { AppDeps } from "../../routes.ts";
import { accessFor, levelOfNode, requireLevel } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { publishedFileVersionOf } from "../documents/controlled-guard.ts";
import { getControlled } from "../documents/documents.service.ts";
import { myApprovals } from "../documents/approvals.service.ts";
import { myReadings } from "../documents/readings.service.ts";
import { MyApprovalsQuerySchema, MyReadingsQuerySchema } from "../documents/documents.schemas.ts";
import { listVersions } from "../files/files.service.ts";
import { ListVersionsQuerySchema } from "../files/files.schemas.ts";
import { getNode, listChildren } from "../nodes/nodes.service.ts";
import { getPage } from "../nodes/pages.service.ts";
import { ListNodesQuerySchema } from "../nodes/nodes.schemas.ts";
import { fullTextSearch } from "../search/fulltext.service.ts";
import { listSpaces } from "../spaces/spaces.service.ts";
import { ListSpacesQuerySchema } from "../spaces/spaces.schemas.ts";
import {
  appLinks,
  failure,
  result,
  slice,
  toolError,
  untrusted,
  type ToolResult,
} from "./mcp.common.ts";

const Id = z.string().min(1).max(64);
const Cursor = z.string().max(200).optional();
const segments = (parts: readonly { text: string }[]) => parts.map((part) => part.text).join("");

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  write: boolean;
  run(ctx: AdminContext, args: Record<string, unknown>): Promise<ToolResult>;
}

const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

export function readTools(deps: AppDeps): ToolDefinition[] {
  const links = (ctx: AdminContext) => appLinks(deps.env.APP_URL, ctx.tenant.workspaceSlug);

  return [
    {
      name: "search",
      title: "Search documents",
      description:
        "Full-text search across the company's pages, files and folders the user can see. Returns id, type, title, space, code and a snippet. Use the id with get_page, get_file or list_folder.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe("Words to look for"),
        cursor: Cursor.describe("nextCursor from a previous call, for more results"),
      },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const query = z.object({ query: z.string(), cursor: Cursor }).parse(args);
        const page = await fullTextSearch(ctx, deps, {
          q: query.query,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          pageSize: 20,
        });
        const link = links(ctx);
        return result({
          results: page.items.map((hit) => ({
            id: hit.id,
            type: hit.type,
            title: segments(hit.name),
            code: hit.code,
            space: { id: hit.spaceId, name: hit.spaceName },
            snippet: segments(hit.snippet),
            link:
              hit.type === "PAGE"
                ? link.page(hit.spaceId, hit.id)
                : hit.type === "FOLDER"
                  ? link.folder(hit.spaceId, hit.id)
                  : link.folder(hit.spaceId, hit.parentId),
          })),
          nextCursor: page.nextCursor,
        });
      },
    },
    {
      name: "list_spaces",
      title: "List spaces",
      description:
        "The company's spaces the user has access to, with their id, name and the user's access level.",
      inputSchema: { cursor: Cursor },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const { cursor } = z.object({ cursor: Cursor }).parse(args);
        const page = await listSpaces(
          ctx,
          ListSpacesQuerySchema.parse({
            pageSize: "100",
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        return result({
          spaces: page.items.map((space) => ({
            id: space.id,
            name: space.name,
            description: space.description,
            access: space.level,
            link: links(ctx).space(space.id),
          })),
          nextCursor: page.nextCursor,
        });
      },
    },
    {
      name: "list_folder",
      title: "List a space or folder",
      description:
        "What's inside a space (its root) or a folder: folders, pages and files, with their id, type, name and last change.",
      inputSchema: {
        spaceId: Id.describe("The space's id (from list_spaces or search)"),
        folderId: Id.optional().describe("A folder inside the space; omit for the space's root"),
        cursor: Cursor,
      },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const input = z
          .object({ spaceId: Id, folderId: Id.optional(), cursor: Cursor })
          .parse(args);
        const page = await listChildren(
          ctx,
          input.spaceId,
          ListNodesQuerySchema.parse({
            parent: input.folderId ?? "root",
            pageSize: "100",
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          }),
        );
        return result({
          items: page.items.map((node) => ({
            id: node.id,
            type: node.type,
            name: node.name,
            updatedAt: node.updatedAt,
            ...(node.type === "FOLDER" ? { items: node.childCount } : {}),
            ...(node.type === "FILE" ? { mimeType: node.mimeType, sizeBytes: node.sizeBytes } : {}),
          })),
          nextCursor: page.nextCursor,
        });
      },
    },
    {
      name: "get_page",
      title: "Read a page",
      description:
        "A page as Markdown with its title, code, status, version, last change and link. For a controlled document the user can't edit, the current published version. Long pages come in parts: pass nextOffset to read on.",
      inputSchema: {
        pageId: Id,
        offset: z.number().int().min(0).optional().describe("nextOffset from a previous call"),
      },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const input = z
          .object({ pageId: Id, offset: z.number().int().min(0).optional() })
          .parse(args);
        const page = await getPage(ctx, input.pageId);
        const markdown = contentToMarkdown(page.content);
        const { part, nextOffset } = slice(markdown, input.offset ?? 0);
        return result(
          {
            id: page.node.id,
            title: page.node.name,
            space: { id: page.space.id, name: page.space.name },
            code: page.controlled?.code ?? null,
            status: page.controlled?.status ?? null,
            showing: page.controlled?.showing ?? null,
            publishedVersion: page.controlled?.publishedVersion ?? null,
            revision: page.revision,
            updatedAt: page.updatedAt,
            updatedBy: page.updatedBy?.name ?? null,
            access: page.node.level,
            link: links(ctx).page(page.space.id, page.node.id),
            nextOffset,
          },
          untrusted(part),
        );
      },
    },
    {
      name: "get_file",
      title: "Read a file",
      description:
        "A file's details and its extracted text (PDF, Word, Excel…), when there is any. For a controlled document, the published version. Long texts come in parts: pass nextOffset to read on.",
      inputSchema: {
        fileId: Id,
        offset: z.number().int().min(0).optional().describe("nextOffset from a previous call"),
      },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const input = z
          .object({ fileId: Id, offset: z.number().int().min(0).optional() })
          .parse(args);
        const detail = await getNode(ctx, input.fileId);
        const { node } = detail;
        if (node.type !== "FILE") return failure("That id isn't a file.");
        requireLevel(await levelOfNode(ctx, node.id), "VIEW");
        const version = (await publishedFileVersionOf(ctx.db, node.id)) ?? node.currentVersion;
        const extracted = await ctx.db.fileText.findFirst({
          where: { nodeId: node.id, version, status: "OK" },
          select: { text: true },
        });
        const { part, nextOffset } = slice(extracted?.text ?? "", input.offset ?? 0);
        return result(
          {
            id: node.id,
            name: node.name,
            mimeType: node.mimeType,
            sizeBytes: node.sizeBytes,
            version,
            updatedAt: node.updatedAt,
            space: { id: detail.space.id, name: detail.space.name },
            link: links(ctx).folder(node.spaceId, node.parentId),
            text: extracted === null ? "none (not extracted, or not a text document)" : "below",
            nextOffset,
          },
          extracted === null ? undefined : untrusted(part),
        );
      },
    },
    {
      name: "get_versions",
      title: "Version history",
      description:
        "The versions of a controlled document (status, dates, change notes) or of a file. Ordinary pages have no versions.",
      inputSchema: { nodeId: Id },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const { nodeId } = z.object({ nodeId: Id }).parse(args);
        const { node } = await getNode(ctx, nodeId);
        const controlled = await getControlled(ctx, nodeId).catch(() => null);
        if (controlled?.controlled != null) {
          return result({
            code: controlled.controlled.code,
            versions: controlled.controlled.versions.map((v) => ({
              version: v.version,
              status: v.status,
              title: v.title,
              changeNote: v.changeNote,
              createdAt: v.createdAt,
              submittedAt: v.submittedAt,
              approvedAt: v.approvedAt,
            })),
          });
        }
        if (node.type === "FILE") {
          const page = await listVersions(
            ctx,
            nodeId,
            ListVersionsQuerySchema.parse({ pageSize: "50" }),
          );
          return result({
            versions: page.items.map((v) => ({
              version: v.version,
              fileName: v.fileName,
              sizeBytes: v.sizeBytes,
              createdAt: v.createdAt,
              uploadedBy: v.uploadedBy,
              current: v.current,
            })),
          });
        }
        return result({
          versions: [],
          note: "This page isn't a controlled document: it has no versions.",
        });
      },
    },
    {
      name: "get_pending",
      title: "My pending tasks",
      description:
        "The user's pending approvals (documents waiting for their review) and required readings (documents they have to read and confirm), with due dates.",
      inputSchema: {},
      annotations: read,
      write: false,
      async run(ctx) {
        const [approvals, readings] = await Promise.all([
          myApprovals(ctx, MyApprovalsQuerySchema.parse({ pageSize: "50" })),
          myReadings(ctx, MyReadingsQuerySchema.parse({ pageSize: "50" })),
        ]);
        return result({
          approvals: approvals.items.map((item) => ({
            id: item.node.id,
            name: item.node.name,
            code: item.code,
            version: item.version,
            space: item.node.spaceName,
          })),
          approvalsTotal: approvals.total,
          readings: readings.items.map((item) => ({
            id: item.node.id,
            name: item.node.name,
            code: item.code,
            version: item.version,
            dueAt: item.dueAt,
            overdue: item.overdue,
          })),
          readingsTotal: readings.total,
        });
      },
    },
    {
      name: "list_expirations",
      title: "Upcoming and overdue reviews",
      description:
        "Controlled documents the user can see whose periodic review is overdue or due within the next days (default 60).",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("How many days ahead (default 60)"),
      },
      annotations: read,
      write: false,
      async run(ctx, args) {
        const { days } = z
          .object({ days: z.number().int().min(1).max(365).optional() })
          .parse(args);
        const until = new Date(Date.now() + (days ?? 60) * 24 * 3600_000);
        const due = await ctx.db.controlledDocument.findMany({
          where: { reviewDueAt: { lte: until }, node: { trashedAt: null } },
          select: {
            nodeId: true,
            code: true,
            reviewDueAt: true,
            node: { select: { name: true, spaceId: true } },
          },
          orderBy: [{ reviewDueAt: "asc" }, { nodeId: "asc" }],
          take: 500,
        });
        const access = await accessFor(ctx, { nodeIds: due.map((row) => row.nodeId) });
        const now = Date.now();
        return result({
          documents: due
            .filter((row) => access.ofNode(row.nodeId) !== null)
            .slice(0, 100)
            .map((row) => ({
              id: row.nodeId,
              name: row.node.name,
              code: row.code,
              reviewDueAt: row.reviewDueAt,
              overdue: row.reviewDueAt !== null && row.reviewDueAt.getTime() < now,
              link: links(ctx).page(row.node.spaceId, row.nodeId),
            })),
        });
      },
    },
  ];
}

/** Runs a tool's work, turning the app's errors into the tool's answer. */
export async function runTool(
  tool: ToolDefinition,
  ctx: AdminContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    return await tool.run(ctx, args);
  } catch (error) {
    if (error instanceof z.ZodError)
      return failure(`Invalid arguments: ${error.issues[0]?.message ?? ""}`);
    return toolError(error);
  }
}
