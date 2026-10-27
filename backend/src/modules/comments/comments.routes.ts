// /api/v1/w/:slug/pages/:id/comments (comentarios de una página). Sin capacidades: el acceso lo
// decide resolveAccess en el servicio (VIEW lee, COMMENT escribe).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CandidatesQuerySchema,
  CreateThreadSchema,
  EditCommentSchema,
  ListThreadsQuerySchema,
  MessageParamsSchema,
  PageParamsSchema,
  ReplySchema,
  ThreadParamsSchema,
} from "./comments.schemas.ts";
import {
  createThread,
  deleteComment,
  editComment,
  listThreads,
  reply,
  setResolved,
} from "./comments.service.ts";
import { mentionCandidates, mentionDepsOf } from "./mentions.service.ts";

export function commentRoutes(deps: AppDeps): TenantRoute[] {
  const mentionDeps = mentionDepsOf(deps);
  return [
    {
      // Personas que se pueden mencionar, con si ya ven la página.
      method: "get",
      path: "/pages/:id/mention-candidates",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        const { q } = CandidatesQuerySchema.parse(req.query);
        res.json({ items: await mentionCandidates(adminContextOf(req), mentionDeps, id, q) });
      },
    },
    {
      method: "get",
      path: "/pages/:id/comments",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res.json(
          await listThreads(adminContextOf(req), id, ListThreadsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/pages/:id/comments",
      handler: async (req, res) => {
        const { id } = PageParamsSchema.parse(req.params);
        res
          .status(201)
          .json(
            await createThread(
              adminContextOf(req),
              mentionDeps,
              id,
              CreateThreadSchema.parse(req.body),
            ),
          );
      },
    },
    {
      method: "post",
      path: "/pages/:id/comments/:threadId/replies",
      handler: async (req, res) => {
        const { id, threadId } = ThreadParamsSchema.parse(req.params);
        res
          .status(201)
          .json(
            await reply(
              adminContextOf(req),
              mentionDeps,
              id,
              threadId,
              ReplySchema.parse(req.body).body,
            ),
          );
      },
    },
    {
      method: "post",
      path: "/pages/:id/comments/:threadId/resolve",
      handler: async (req, res) => {
        const { id, threadId } = ThreadParamsSchema.parse(req.params);
        res.json({ thread: await setResolved(adminContextOf(req), id, threadId, true) });
      },
    },
    {
      method: "post",
      path: "/pages/:id/comments/:threadId/reopen",
      handler: async (req, res) => {
        const { id, threadId } = ThreadParamsSchema.parse(req.params);
        res.json({ thread: await setResolved(adminContextOf(req), id, threadId, false) });
      },
    },
    {
      method: "patch",
      path: "/pages/:id/comments/:threadId/messages/:commentId",
      handler: async (req, res) => {
        const { id, threadId, commentId } = MessageParamsSchema.parse(req.params);
        const result = await editComment(
          adminContextOf(req),
          mentionDeps,
          id,
          threadId,
          commentId,
          EditCommentSchema.parse(req.body).body,
        );
        res.json(result);
      },
    },
    {
      method: "delete",
      path: "/pages/:id/comments/:threadId/messages/:commentId",
      handler: async (req, res) => {
        const { id, threadId, commentId } = MessageParamsSchema.parse(req.params);
        res.json(await deleteComment(adminContextOf(req), id, threadId, commentId));
      },
    },
  ];
}
