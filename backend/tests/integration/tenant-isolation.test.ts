// Test obligatorio (CLAUDE.md, sección 7.5): para cada endpoint bajo /api/v1/w/, alguien de A
// recibe 404 al intentar usar el workspace B. Cada endpoint nuevo tiene que estar en
// `cases`; el primer test falla si hay rutas de tenant sin cubrir.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { tenantRoutes, type TenantRoute } from "../../src/routes.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import { errorOf, bodyOf } from "../http.ts";

interface Ids {
  workspaceId: string;
  departmentId: string;
  memberId: string;
  spaceId: string;
  nodeId: string;
  /** Una página de B (con texto). */
  pageId: string;
}

interface IsolationCase {
  method: TenantRoute["method"];
  path: string;
  /** Ruta concreta (con ids de B si la ruta los lleva). */
  url: (ids: Ids) => string;
  body?: unknown;
  /** Qué responde a B con su propio token, si no es 200 (ej. el id de prueba no es un archivo). */
  ownStatus?: number;
}

const cases: IsolationCase[] = [
  { method: "get", path: "/", url: () => "/" },
  { method: "get", path: "/overview", url: () => "/overview" },
  { method: "get", path: "/admin/roles", url: () => "/admin/roles" },
  { method: "get", path: "/admin/roles/options", url: () => "/admin/roles/options" },
  {
    method: "post",
    path: "/admin/roles",
    url: () => "/admin/roles",
    body: { name: "Ajeno", base: "MEMBER", capabilities: [] },
  },
  {
    method: "patch",
    path: "/admin/roles/:id",
    url: () => "/admin/roles/x",
    body: { name: "Ajeno" },
  },
  { method: "delete", path: "/admin/roles/:id", url: () => "/admin/roles/x" },
  { method: "get", path: "/admin/capabilities", url: () => "/admin/capabilities" },
  { method: "get", path: "/admin/departments", url: () => "/admin/departments" },
  { method: "get", path: "/admin/departments/options", url: () => "/admin/departments/options" },
  {
    method: "post",
    path: "/admin/departments",
    url: () => "/admin/departments",
    body: { name: "Ajeno" },
  },
  {
    method: "get",
    path: "/admin/departments/:id",
    url: (ids) => `/admin/departments/${ids.departmentId}`,
  },
  {
    method: "patch",
    path: "/admin/departments/:id",
    url: (ids) => `/admin/departments/${ids.departmentId}`,
    body: { name: "Ajeno" },
  },
  { method: "delete", path: "/admin/departments/:id", url: () => "/admin/departments/x" },
  {
    method: "post",
    path: "/admin/departments/:id/members",
    url: (ids) => `/admin/departments/${ids.departmentId}/members`,
    body: { membershipIds: ["x"] },
  },
  {
    method: "get",
    path: "/admin/departments/:id/members",
    url: (ids) => `/admin/departments/${ids.departmentId}/members`,
  },
  {
    method: "post",
    path: "/admin/departments/:id/members/:membershipId/move",
    url: (ids) => `/admin/departments/${ids.departmentId}/members/y/move`,
    body: { toDepartmentId: "z" },
  },
  {
    method: "put",
    path: "/admin/departments/:id/members/:membershipId/position",
    url: (ids) => `/admin/departments/${ids.departmentId}/members/y/position`,
    body: { position: "HEAD" },
  },
  {
    method: "delete",
    path: "/admin/departments/:id/members/:membershipId",
    url: (ids) => `/admin/departments/${ids.departmentId}/members/y`,
  },
  {
    method: "get",
    path: "/admin/departments/:id/access",
    url: (ids) => `/admin/departments/${ids.departmentId}/access`,
  },
  { method: "get", path: "/admin/invitations", url: () => "/admin/invitations" },
  {
    method: "post",
    path: "/admin/invitations",
    url: () => "/admin/invitations",
    body: { emails: ["ajeno@test.local"], roleId: "x" },
  },
  { method: "delete", path: "/admin/invitations/:id", url: () => "/admin/invitations/x" },
  {
    method: "post",
    path: "/admin/invitations/:id/resend",
    url: () => "/admin/invitations/x/resend",
  },
  { method: "get", path: "/admin/seats", url: () => "/admin/seats" },
  { method: "get", path: "/admin/members", url: () => "/admin/members" },
  { method: "get", path: "/admin/members/summary", url: () => "/admin/members/summary" },
  { method: "get", path: "/admin/members/pin-settings", url: () => "/admin/members/pin-settings" },
  {
    method: "patch",
    path: "/admin/members/pin-settings",
    url: () => "/admin/members/pin-settings",
    body: { enabled: true },
  },
  {
    method: "post",
    path: "/admin/members/pin",
    url: () => "/admin/members/pin",
    body: { name: "Ajeno", loginName: "ajeno", roleId: "x" },
  },
  {
    method: "post",
    path: "/admin/members/:id/pin/reset",
    url: (ids) => `/admin/members/${ids.memberId}/pin/reset`,
    body: {},
  },
  { method: "get", path: "/directory", url: () => "/directory" },
  { method: "get", path: "/spaces", url: () => "/spaces" },
  { method: "post", path: "/spaces", url: () => "/spaces", body: { name: "Ajeno" } },
  { method: "get", path: "/spaces/:id", url: (ids) => `/spaces/${ids.spaceId}` },
  {
    method: "patch",
    path: "/spaces/:id",
    url: (ids) => `/spaces/${ids.spaceId}`,
    body: { name: "Ajeno" },
  },
  { method: "post", path: "/spaces/:id/archive", url: (ids) => `/spaces/${ids.spaceId}/archive` },
  { method: "post", path: "/spaces/:id/restore", url: (ids) => `/spaces/${ids.spaceId}/restore` },
  {
    method: "get",
    path: "/spaces/:id/members/options",
    url: (ids) => `/spaces/${ids.spaceId}/members/options`,
  },
  { method: "get", path: "/spaces/:id/nodes", url: (ids) => `/spaces/${ids.spaceId}/nodes` },
  { method: "patch", path: "/profile", url: () => "/profile", body: { jobTitle: null } },
  { method: "get", path: "/admin/structure-review", url: () => "/admin/structure-review" },
  {
    method: "post",
    path: "/spaces/:id/pages",
    url: (ids) => `/spaces/${ids.spaceId}/pages`,
    body: {},
  },
  { method: "get", path: "/nodes/:id/access", url: (ids) => `/nodes/${ids.nodeId}/access` },
  { method: "get", path: "/spaces/:id/access", url: (ids) => `/spaces/${ids.spaceId}/access` },
  {
    method: "put",
    path: "/nodes/:id/permissions",
    url: (ids) => `/nodes/${ids.nodeId}/permissions`,
    body: { membershipId: "x", level: "VIEW" },
  },
  {
    method: "put",
    path: "/spaces/:id/permissions",
    url: (ids) => `/spaces/${ids.spaceId}/permissions`,
    body: { membershipId: "x", level: "VIEW" },
  },
  { method: "delete", path: "/permissions/:id", url: () => "/permissions/x" },
  {
    method: "patch",
    path: "/nodes/:id/inheritance",
    url: (ids) => `/nodes/${ids.nodeId}/inheritance`,
    body: { inheritAccess: false },
  },
  { method: "get", path: "/admin/access/matrix", url: () => "/admin/access/matrix" },
  { method: "get", path: "/admin/access/targets", url: () => "/admin/access/targets" },
  {
    method: "get",
    path: "/admin/access/who/export",
    url: (ids) => `/admin/access/who/export?type=space&id=${ids.spaceId}`,
  },
  {
    method: "get",
    path: "/admin/access/who",
    url: (ids) => `/admin/access/who?type=node&id=${ids.nodeId}`,
  },
  {
    method: "get",
    path: "/admin/access/people/:membershipId",
    url: (ids) => `/admin/access/people/${ids.memberId}`,
  },
  {
    method: "get",
    path: "/admin/access/reports/:kind/export",
    url: () => "/admin/access/reports/guests/export",
  },
  {
    method: "get",
    path: "/admin/access/reports/:kind",
    url: () => "/admin/access/reports/expiring",
  },
  { method: "get", path: "/shared-by-me", url: () => "/shared-by-me" },
  { method: "get", path: "/shared-with-me/summary", url: () => "/shared-with-me/summary" },
  { method: "post", path: "/nodes/:id/seen", url: (ids) => `/nodes/${ids.nodeId}/seen` },
  {
    method: "get",
    path: "/admin/access/matrix/cell",
    url: (ids) =>
      `/admin/access/matrix/cell?departmentId=${ids.departmentId}&spaceId=${ids.spaceId}`,
  },
  { method: "get", path: "/notifications", url: () => "/notifications" },
  { method: "get", path: "/notifications/summary", url: () => "/notifications/summary" },
  { method: "post", path: "/notifications/read-all", url: () => "/notifications/read-all" },
  {
    method: "post",
    path: "/notifications/:id/read",
    url: () => "/notifications/x/read",
    ownStatus: 404,
  },
  { method: "get", path: "/admin/access/spaces", url: () => "/admin/access/spaces" },
  {
    method: "get",
    path: "/admin/access/people/:membershipId/items",
    url: (ids) => `/admin/access/people/${ids.memberId}/items`,
  },
  {
    method: "get",
    path: "/nodes/:id/controlled/readings/access-gaps",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings/access-gaps`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/readings/grant-access",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings/grant-access`,
    body: {},
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/readings/remind",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings/remind`,
    body: {},
  },
  {
    method: "put",
    path: "/spaces/favorites/order",
    url: () => "/spaces/favorites/order",
    body: { ids: ["x"] },
  },
  { method: "get", path: "/search/quick", url: () => "/search/quick?q=ajena" },
  { method: "get", path: "/search", url: () => "/search?q=ajena" },
  {
    method: "get",
    path: "/nodes/:id/qr",
    url: (ids) => `/nodes/${ids.pageId}/qr`,
    // Una persona sin permiso de edición no lista los QR: su propio recurso responde 200.
  },
  {
    method: "post",
    path: "/nodes/:id/qr",
    url: (ids) => `/nodes/${ids.pageId}/qr`,
    body: {},
  },
  {
    method: "delete",
    path: "/qr/:qrId",
    url: () => "/qr/no-existe",
    body: {},
  },
  {
    method: "get",
    path: "/qr/:qrId/image",
    url: () => "/qr/no-existe/image",
    // No hay un QR de prueba en la empresa B: también es 404 para ella.
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/qr/:qrId/labels",
    url: () => "/qr/no-existe/labels",
    ownStatus: 404,
  },
  {
    method: "patch",
    path: "/nodes/:id/controlled",
    url: (ids) => `/nodes/${ids.nodeId}/controlled`,
    body: { ownerDepartmentId: null },
  },
  {
    method: "get",
    path: "/nodes/:id/controlled/approvers",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/approvers`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/submit",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/submit`,
    body: { approverIds: ["x"] },
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/decision",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/decision`,
    body: { decision: "APPROVED" },
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/withdraw",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/withdraw`,
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/publish",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/publish`,
  },
  {
    method: "get",
    path: "/nodes/:id/controlled/compare",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/compare`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  {
    method: "post",
    path: "/nodes/:id/controlled/acknowledge",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/acknowledge`,
  },
  {
    method: "get",
    path: "/nodes/:id/controlled/readings/export",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings/export`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  {
    method: "get",
    path: "/nodes/:id/controlled/readings",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  {
    method: "put",
    path: "/nodes/:id/controlled/readings",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings`,
    body: { membershipId: "x" },
  },
  {
    method: "delete",
    path: "/nodes/:id/controlled/readings/:requirementId",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/readings/x`,
  },
  { method: "get", path: "/documents/readings", url: () => "/documents/readings" },
  {
    method: "get",
    path: "/nodes/:id/controlled/pdf",
    url: (ids) => `/nodes/${ids.nodeId}/controlled/pdf`,
    // Su nodo no es un documento controlado: 400, no 404.
    ownStatus: 400,
  },
  { method: "get", path: "/admin/documents", url: () => "/admin/documents" },
  { method: "get", path: "/admin/documents/approvals", url: () => "/admin/documents/approvals" },
  {
    method: "get",
    path: "/admin/documents/compliance/departments",
    url: () => "/admin/documents/compliance/departments",
  },
  { method: "get", path: "/admin/documents/compliance", url: () => "/admin/documents/compliance" },
  { method: "get", path: "/admin/documents/types", url: () => "/admin/documents/types" },
  {
    method: "post",
    path: "/admin/documents/types",
    url: () => "/admin/documents/types",
    body: { code: "ZZZ", name: "Ajeno" },
  },
  {
    method: "patch",
    path: "/admin/documents/types/:code",
    url: () => "/admin/documents/types/PRC",
    body: { name: "Ajeno" },
  },
  { method: "get", path: "/documents/recent", url: () => "/documents/recent" },
  { method: "get", path: "/documents/news", url: () => "/documents/news" },
  { method: "get", path: "/documents/approvals", url: () => "/documents/approvals" },
  { method: "get", path: "/document-types", url: () => "/document-types" },
  {
    method: "get",
    path: "/nodes/:id/controlled",
    url: (ids) => `/nodes/${ids.nodeId}/controlled`,
  },
  {
    method: "post",
    path: "/nodes/:id/controlled",
    url: (ids) => `/nodes/${ids.nodeId}/controlled`,
    body: { docType: "PRC" },
  },
  { method: "get", path: "/shared-with-me", url: () => "/shared-with-me" },
  { method: "get", path: "/search/nodes", url: () => "/search/nodes?q=a" },
  { method: "post", path: "/nodes/resolve", url: () => "/nodes/resolve", body: { ids: ["x"] } },
  {
    method: "post",
    path: "/pages/:id/duplicate",
    url: (ids) => `/pages/${ids.pageId}/duplicate`,
  },
  { method: "get", path: "/pages/:id", url: (ids) => `/pages/${ids.pageId}` },
  {
    method: "put",
    path: "/pages/:id/content",
    url: (ids) => `/pages/${ids.pageId}/content`,
    body: { baseRevision: 1, content: { type: "doc", content: [{ type: "paragraph" }] } },
  },
  {
    method: "post",
    path: "/pages/:id/images",
    url: (ids) => `/pages/${ids.pageId}/images`,
    body: { contentType: "image/webp", size: 100 },
  },
  { method: "get", path: "/pages/:id/comments", url: (ids) => `/pages/${ids.pageId}/comments` },
  {
    method: "post",
    path: "/pages/:id/comments",
    url: (ids) => `/pages/${ids.pageId}/comments`,
    body: { body: "Hola" },
  },
  {
    method: "get",
    path: "/pages/:id/mention-candidates",
    url: (ids) => `/pages/${ids.pageId}/mention-candidates?q=`,
  },
  {
    method: "post",
    path: "/pages/:id/images/:imageId/confirm",
    url: (ids) => `/pages/${ids.pageId}/images/x/confirm`,
  },
  {
    method: "get",
    path: "/pages/:id/images/:imageId",
    url: (ids) => `/pages/${ids.pageId}/images/x`,
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/pages/:id/comments/:threadId/replies",
    url: (ids) => `/pages/${ids.pageId}/comments/x/replies`,
    body: { body: "Hola" },
  },
  {
    method: "post",
    path: "/pages/:id/comments/:threadId/resolve",
    url: (ids) => `/pages/${ids.pageId}/comments/x/resolve`,
  },
  {
    method: "post",
    path: "/pages/:id/comments/:threadId/reopen",
    url: (ids) => `/pages/${ids.pageId}/comments/x/reopen`,
  },
  {
    method: "patch",
    path: "/pages/:id/comments/:threadId/messages/:commentId",
    url: (ids) => `/pages/${ids.pageId}/comments/x/messages/y`,
    body: { body: "Hola" },
  },
  {
    method: "delete",
    path: "/pages/:id/comments/:threadId/messages/:commentId",
    url: (ids) => `/pages/${ids.pageId}/comments/x/messages/y`,
  },
  { method: "get", path: "/spaces/recent", url: () => "/spaces/recent" },
  {
    method: "put",
    path: "/spaces/:id/favorite",
    url: (ids) => `/spaces/${ids.spaceId}/favorite`,
    body: { favorite: true },
  },
  { method: "post", path: "/spaces/:id/visit", url: (ids) => `/spaces/${ids.spaceId}/visit` },
  {
    method: "post",
    path: "/spaces/:id/download-zip",
    url: (ids) => `/spaces/${ids.spaceId}/download-zip`,
    body: { nodeIds: ["x"] },
  },
  {
    method: "post",
    path: "/spaces/:id/folders",
    url: (ids) => `/spaces/${ids.spaceId}/folders`,
    body: { name: "Ajena" },
  },
  {
    method: "post",
    path: "/spaces/:id/uploads",
    url: (ids) => `/spaces/${ids.spaceId}/uploads`,
    body: { name: "a.txt", size: 3 },
  },
  {
    method: "get",
    path: "/spaces/department-options",
    url: () => "/spaces/department-options",
  },
  { method: "get", path: "/uploads/:id", url: () => "/uploads/x", ownStatus: 404 },
  {
    method: "post",
    path: "/uploads/:id/parts",
    url: () => "/uploads/x/parts",
    body: { partNumbers: [1] },
  },
  { method: "post", path: "/uploads/:id/complete", url: () => "/uploads/x/complete" },
  { method: "delete", path: "/uploads/:id", url: () => "/uploads/x" },
  {
    method: "get",
    path: "/files/:id/download",
    url: (ids) => `/files/${ids.nodeId}/download`,
    ownStatus: 400,
  },
  {
    method: "post",
    path: "/spaces/:id/import-plan",
    url: (ids) => `/spaces/${ids.spaceId}/import-plan`,
    body: { entries: [{ path: "Ajena/a.txt", size: 3 }] },
  },
  {
    method: "post",
    path: "/files/:id/import-zip",
    url: (ids) => `/files/${ids.nodeId}/import-zip`,
    body: {},
    ownStatus: 400,
  },
  { method: "get", path: "/imports/:id", url: () => "/imports/x", ownStatus: 404 },
  { method: "get", path: "/spaces/:id/trash", url: (ids) => `/spaces/${ids.spaceId}/trash` },
  { method: "delete", path: "/nodes/:id", url: (ids) => `/nodes/${ids.nodeId}` },
  { method: "post", path: "/nodes/:id/restore", url: (ids) => `/nodes/${ids.nodeId}/restore` },
  { method: "delete", path: "/nodes/:id/purge", url: (ids) => `/nodes/${ids.nodeId}/purge` },
  {
    method: "get",
    path: "/files/:id/versions",
    url: (ids) => `/files/${ids.nodeId}/versions`,
    ownStatus: 400,
  },
  {
    method: "post",
    path: "/files/:id/versions/:version/restore",
    url: (ids) => `/files/${ids.nodeId}/versions/1/restore`,
  },
  { method: "get", path: "/nodes/:id", url: (ids) => `/nodes/${ids.nodeId}` },
  {
    method: "patch",
    path: "/nodes/:id",
    url: (ids) => `/nodes/${ids.nodeId}`,
    body: { name: "Ajena" },
  },
  {
    method: "post",
    path: "/nodes/:id/move",
    url: (ids) => `/nodes/${ids.nodeId}/move`,
    body: { parentId: null },
  },
  {
    method: "get",
    path: "/directory/departments/:id/members",
    url: (ids) => `/directory/departments/${ids.departmentId}/members`,
  },
  { method: "get", path: "/admin/security", url: () => "/admin/security" },
  {
    method: "patch",
    path: "/admin/security",
    url: () => "/admin/security",
    body: { memberVisibility: "department" },
  },
  { method: "get", path: "/bian/usage", url: () => "/bian/usage" },
  {
    method: "post",
    path: "/bian/draft",
    url: () => "/bian/draft",
    body: { spaceId: "x", templateId: "blank", notes: "notas" },
  },
  { method: "post", path: "/bian/summarize", url: () => "/bian/summarize", body: { nodeId: "x" } },
  { method: "post", path: "/bian/changes", url: () => "/bian/changes", body: { nodeId: "x" } },
  {
    method: "post",
    path: "/bian/feedback",
    url: () => "/bian/feedback",
    body: { rating: "UP", nodeIds: [] },
  },
  {
    method: "patch",
    path: "/bian/feedback/:id",
    url: () => "/bian/feedback/no-existe",
    body: { reason: "OTHER" },
    ownStatus: 404,
  },
  {
    method: "delete",
    path: "/bian/feedback/:id",
    url: () => "/bian/feedback/no-existe",
    ownStatus: 404,
  },
  { method: "post", path: "/bian/request-more", url: () => "/bian/request-more" },
  { method: "get", path: "/admin/bian/feedback", url: () => "/admin/bian/feedback" },
  { method: "get", path: "/admin/bian/overview", url: () => "/admin/bian/overview" },
  {
    method: "patch",
    path: "/admin/bian/settings",
    url: () => "/admin/bian/settings",
    body: { guests: false },
  },
  {
    method: "put",
    path: "/admin/bian/limits",
    url: () => "/admin/bian/limits",
    body: { scope: "GENERAL", mode: "UNLIMITED" },
  },
  {
    method: "delete",
    path: "/admin/bian/limits/:id",
    url: () => "/admin/bian/limits/no-existe",
    ownStatus: 404,
  },
  { method: "get", path: "/admin/audit", url: () => "/admin/audit" },
  { method: "get", path: "/admin/audit/export", url: () => "/admin/audit/export" },
  { method: "get", path: "/plugins", url: () => "/plugins" },
  { method: "get", path: "/admin/license", url: () => "/admin/license" },
  {
    method: "put",
    path: "/admin/license",
    url: () => "/admin/license",
    body: { token: "SFL1.no-es-una-licencia.firma" },
  },
  { method: "delete", path: "/admin/license", url: () => "/admin/license" },
  { method: "get", path: "/admin/limits", url: () => "/admin/limits" },
  {
    method: "patch",
    path: "/admin/limits",
    url: () => "/admin/limits",
    body: { storageGb: null },
  },
  {
    method: "put",
    path: "/admin/bian/total",
    url: () => "/admin/bian/total",
    body: { total: null },
  },
  { method: "get", path: "/admin/bian/usage", url: () => "/admin/bian/usage" },
  { method: "get", path: "/admin/bian/usage/export", url: () => "/admin/bian/usage/export" },
  {
    method: "post",
    path: "/bian/ask",
    url: () => "/bian/ask",
    body: { question: "¿Qué dice el manual?" },
  },
  { method: "get", path: "/admin/email", url: () => "/admin/email" },
  {
    method: "put",
    path: "/admin/email",
    url: () => "/admin/email",
    body: {
      fromName: "Prueba",
      fromEmail: "no-reply@example.com",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecurity: "STARTTLS",
    },
  },
  {
    method: "put",
    path: "/admin/email/domain",
    url: () => "/admin/email/domain",
    body: { domain: "example.com", fromName: "Prueba", fromLocalPart: "avisos" },
  },
  { method: "post", path: "/admin/email/domain/verify", url: () => "/admin/email/domain/verify" },
  { method: "delete", path: "/admin/email/domain", url: () => "/admin/email/domain" },
  { method: "post", path: "/admin/email/test", url: () => "/admin/email/test" },
  { method: "post", path: "/admin/email/activate", url: () => "/admin/email/activate" },
  { method: "post", path: "/admin/email/deactivate", url: () => "/admin/email/deactivate" },
  { method: "get", path: "/admin/members/org-chart", url: () => "/admin/members/org-chart" },
  {
    method: "get",
    path: "/admin/members/org-chart/search",
    url: () => "/admin/members/org-chart/search?q=ana",
  },
  { method: "get", path: "/admin/members/export", url: () => "/admin/members/export" },
  { method: "get", path: "/admin/members/:id", url: (ids) => `/admin/members/${ids.memberId}` },
  {
    method: "patch",
    path: "/admin/members/:id",
    url: (ids) => `/admin/members/${ids.memberId}`,
    body: { jobTitle: "Ajeno" },
  },
  { method: "delete", path: "/admin/members/:id", url: (ids) => `/admin/members/${ids.memberId}` },
  {
    method: "post",
    path: "/admin/members/:id/suspend",
    url: (ids) => `/admin/members/${ids.memberId}/suspend`,
  },
  {
    method: "post",
    path: "/admin/members/:id/reactivate",
    url: (ids) => `/admin/members/${ids.memberId}/reactivate`,
  },
  {
    method: "post",
    path: "/admin/members/:id/2fa/reset",
    url: (ids) => `/admin/members/${ids.memberId}/2fa/reset`,
    // Quien la pide no tiene su propia 2FA activa.
    ownStatus: 403,
  },
  {
    method: "post",
    path: "/admin/members/:id/revoke-sessions",
    url: (ids) => `/admin/members/${ids.memberId}/revoke-sessions`,
  },
  {
    method: "post",
    path: "/admin/members/bulk",
    url: () => "/admin/members/bulk",
    body: { ids: ["x"], action: { type: "suspend" } },
  },
  {
    method: "post",
    path: "/admin/members/import",
    url: () => "/admin/members/import",
    body: { csv: "email" },
  },
  {
    method: "post",
    path: "/admin/members/import/confirm",
    url: () => "/admin/members/import/confirm",
    body: { csv: "email" },
  },
];

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
let a: Awaited<ReturnType<typeof createWorkspace>>;
let b: Awaited<ReturnType<typeof createWorkspace>>;
let bDepartmentId = "";
let bSpaceId = "";
let bNodeId = "";
let bPageId = "";

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
  a = await createWorkspace(ctx, "Aislamiento A");
  b = await createWorkspace(ctx, "Aislamiento B");
  bDepartmentId = (
    await ctx.prisma.department.create({ data: { workspaceId: b.workspaceId, name: "Calidad" } })
  ).id;
  bSpaceId = (
    await ctx.prisma.space.create({
      data: {
        workspaceId: b.workspaceId,
        name: "Procedimientos",
        nameKey: "procedimientos",
        createdById: b.membershipId,
      },
    })
  ).id;
  bNodeId = (
    await ctx.prisma.node.create({
      data: {
        workspaceId: b.workspaceId,
        spaceId: bSpaceId,
        type: "FOLDER",
        name: "Calidad",
        nameKey: "calidad",
        position: "V",
        createdById: b.membershipId,
        updatedById: b.membershipId,
      },
    })
  ).id;
  bPageId = (
    await ctx.prisma.node.create({
      data: {
        workspaceId: b.workspaceId,
        spaceId: bSpaceId,
        type: "PAGE",
        name: "Página",
        nameKey: "pagina",
        position: "W",
        createdById: b.membershipId,
        updatedById: b.membershipId,
      },
    })
  ).id;
  await ctx.prisma.pageContent.create({
    data: {
      nodeId: bPageId,
      workspaceId: b.workspaceId,
      content: { type: "doc", content: [{ type: "paragraph" }] },
      updatedById: b.membershipId,
    },
  });
});

afterAll(async () => {
  await ctx.close();
});

describe("aislamiento entre tenants", () => {
  it("todas las rutas de tenant están cubiertas por este test", () => {
    const declared = tenantRoutes(ctx.deps).map((r) => `${r.method} ${r.path}`);
    const covered = cases.map((c) => `${c.method} ${c.path}`);
    expect(covered.sort()).toEqual(declared.sort());
  });

  it.each(cases)("$method $path: A recibe 404 sobre B", async (c) => {
    const url = `/api/v1/w/${b.slug}${c.url({
      workspaceId: b.workspaceId,
      departmentId: bDepartmentId,
      memberId: b.membershipId,
      spaceId: bSpaceId,
      nodeId: bNodeId,
      pageId: bPageId,
    })}`;
    const res = await request(app)
      [c.method](url)
      .set("Authorization", `Bearer ${a.token}`)
      .send(c.body as object | undefined);
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain(b.workspaceId);
  });

  it.each(cases.filter((c) => c.method === "get"))(
    "$method $path: B sí accede a lo suyo",
    async (c) => {
      const res = await request(app)
        .get(
          `/api/v1/w/${b.slug}${c.url({
            workspaceId: b.workspaceId,
            departmentId: bDepartmentId,
            memberId: b.membershipId,
            spaceId: bSpaceId,
            nodeId: bNodeId,
            pageId: bPageId,
          })}`,
        )
        .set("Authorization", `Bearer ${b.token}`);
      expect(res.status).toBe(c.ownStatus ?? 200);
    },
  );

  describe("espacios confidenciales y subáreas", () => {
    const get = (ws: { slug: string }, token: string, path: string) =>
      request(app).get(`/api/v1/w/${ws.slug}${path}`).set("Authorization", `Bearer ${token}`);

    const spaceData = (ws: typeof a, name: string, extra: object) => ({
      workspaceId: ws.workspaceId,
      name,
      nameKey: name.toLowerCase(),
      createdById: ws.membershipId,
      ...extra,
    });

    it("el administrador no ve ni abre un espacio confidencial; el propietario sí", async () => {
      const w = await createWorkspace(ctx, "Confidencial");
      const admin = await addMember(ctx, w, { base: "ADMIN", name: "Adela Admin" });
      const secret = await ctx.prisma.space.create({
        data: spaceData(w, "Nóminas", { isPrivate: true, isConfidential: true }),
      });
      const open = await ctx.prisma.space.create({ data: spaceData(w, "Manuales", {}) });

      const listed = async (token: string) =>
        (
          (await get(w, token, "/spaces?pageSize=100")).body as { items: { id: string }[] }
        ).items.map((space) => space.id);
      expect(await listed(admin.token)).toEqual([open.id]);
      expect((await listed(w.token)).sort()).toEqual([secret.id, open.id].sort());
      expect((await get(w, admin.token, `/spaces/${secret.id}`)).status).toBe(404);
      expect((await get(w, admin.token, `/spaces/${secret.id}/nodes?parent=root`)).status).toBe(
        404,
      );
      expect((await get(w, w.token, `/spaces/${secret.id}`)).status).toBe(200);
      expect((await get(w, admin.token, `/spaces/${open.id}`)).status).toBe(200);

      // Agregado explícitamente, entra.
      await ctx.prisma.permission.create({
        data: {
          workspaceId: w.workspaceId,
          spaceId: secret.id,
          membershipId: admin.membership.id,
          level: "VIEW",
          grantedById: w.membershipId,
        },
      });
      expect((await get(w, admin.token, `/spaces/${secret.id}`)).status).toBe(200);
    });

    it("un confidencial de otra empresa es 404 para su propietario y para el de la nuestra", async () => {
      const other = await createWorkspace(ctx, "Confidencial ajena");
      const foreign = await ctx.prisma.space.create({
        data: spaceData(other, "Secreto", { isPrivate: true, isConfidential: true }),
      });
      for (const token of [a.token, other.token]) {
        const res = await get(a, token, `/spaces/${foreign.id}`);
        expect(res.status).toBe(404);
      }
      expect((await get(other, other.token, `/spaces/${foreign.id}`)).status).toBe(200);
    });

    it("sin «Incluir subáreas», la subárea no entra al espacio privado del padre", async () => {
      const w = await createWorkspace(ctx, "Subáreas");
      const finanzas = await ctx.prisma.department.create({
        data: { workspaceId: w.workspaceId, name: "Finanzas" },
      });
      const tesoreria = await ctx.prisma.department.create({
        data: { workspaceId: w.workspaceId, name: "Tesorería", parentId: finanzas.id },
      });
      const person = await addMember(ctx, w, { name: "Tomás Tesorero" });
      await ctx.prisma.departmentMember.create({
        data: {
          workspaceId: w.workspaceId,
          departmentId: tesoreria.id,
          membershipId: person.membership.id,
        },
      });
      const space = await ctx.prisma.space.create({
        data: spaceData(w, "Cierres", { isPrivate: true, departmentId: finanzas.id }),
      });
      expect((await get(w, person.token, `/spaces/${space.id}`)).status).toBe(404);

      await ctx.prisma.space.update({ where: { id: space.id }, data: { includeSubareas: true } });
      const res = await get(w, person.token, `/spaces/${space.id}`);
      expect(res.status).toBe(200);
      expect((res.body as { space: { reason: object } }).space.reason).toMatchObject({
        kind: "member",
        subareas: true,
      });
    });
  });

  it("un slug inexistente también es 404 (no se distingue de uno ajeno)", async () => {
    const res = await request(app)
      .get("/api/v1/w/no-existe-este-workspace")
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });

  it("nunca se acepta el workspace por query ni body", async () => {
    const res = await request(app)
      .get(`/api/v1/w/${a.slug}/admin/limits?workspaceId=${b.workspaceId}`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    const own = await request(app)
      .get(`/api/v1/w/${a.slug}/`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(bodyOf(own).workspace.id).toBe(a.workspaceId);
  });
});
