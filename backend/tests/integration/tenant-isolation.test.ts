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
  /** A form of B (with its version 1). */
  formId: string;
  /** A record of that form, and its photo. */
  recordId: string;
  fileId: string;
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
  { method: "get", path: "/admin/positions", url: () => "/admin/positions" },
  {
    method: "post",
    path: "/admin/positions",
    url: () => "/admin/positions",
    body: { name: "Ajeno" },
  },
  {
    method: "patch",
    path: "/admin/positions/:id",
    url: () => "/admin/positions/x",
    body: { name: "Ajeno" },
  },
  {
    method: "delete",
    path: "/admin/positions/:id",
    url: () => "/admin/positions/x",
  },
  { method: "get", path: "/admin/safety", url: () => "/admin/safety" },
  // Food quality (docs/spec/calidad.md). B's module is off: its own reads are 404 too.
  { method: "get", path: "/admin/quality", url: () => "/admin/quality" },
  // Food quality, phase 5: complaints, units sold, crisis and recall.
  { method: "get", path: "/quality/complaints", url: () => "/quality/complaints", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/complaints",
    url: () => "/quality/complaints",
    body: {
      source: "CUSTOMER",
      from: "Ajeno",
      product: "Ajeno",
      category: "OTHER",
      description: "Ajeno",
      receivedOn: "2026-11-01",
    },
  },
  {
    method: "get",
    path: "/quality/complaints/indicators",
    url: () => "/quality/complaints/indicators?year=2026",
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/quality/units",
    url: () => "/quality/units",
    body: { month: "2026-11-01", units: 1 },
  },
  {
    method: "get",
    path: "/quality/complaints/:id",
    url: () => "/quality/complaints/x",
    ownStatus: 404,
  },
  {
    method: "patch",
    path: "/quality/complaints/:id",
    url: () => "/quality/complaints/x",
    body: { product: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/complaints/:id/answer",
    url: () => "/quality/complaints/x/answer",
    body: { response: "Ajena", justified: false, respondedOn: "2026-11-01" },
  },
  {
    method: "post",
    path: "/quality/complaints/:id/close",
    url: () => "/quality/complaints/x/close",
  },
  {
    method: "post",
    path: "/quality/complaints/:id/nc",
    url: () => "/quality/complaints/x/nc",
    body: { severity: "MINOR" },
  },
  { method: "get", path: "/quality/crisis", url: () => "/quality/crisis", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/crisis/members",
    url: () => "/quality/crisis/members",
    body: { membershipId: "x", role: "Ajeno" },
  },
  { method: "delete", path: "/quality/crisis/members/:id", url: () => "/quality/crisis/members/x" },
  {
    method: "post",
    path: "/quality/crisis/contacts",
    url: () => "/quality/crisis/contacts",
    body: { kind: "OTHER", name: "Ajeno" },
  },
  {
    method: "patch",
    path: "/quality/crisis/contacts/:id",
    url: () => "/quality/crisis/contacts/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/crisis/contacts/:id/archive",
    url: () => "/quality/crisis/contacts/x/archive",
  },
  {
    method: "post",
    path: "/quality/recall-tests",
    url: () => "/quality/recall-tests",
    body: {
      kind: "DRILL",
      date: "2026-11-01",
      product: "Ajeno",
      lot: "Ajeno",
      direction: "BOTH",
      minutes: 1,
      result: "Ajeno",
    },
  },
  // Food quality, phase 6a: prerequisite programmes and the dashboard.
  { method: "get", path: "/quality/dashboard", url: () => "/quality/dashboard", ownStatus: 404 },
  { method: "get", path: "/quality/prps", url: () => "/quality/prps", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/prps",
    url: () => "/quality/prps",
    body: { kind: "CLEANING", name: "Ajeno", everyDays: 1 },
  },
  {
    method: "patch",
    path: "/quality/prps/:id",
    url: () => "/quality/prps/x",
    body: { name: "Ajeno" },
  },
  { method: "post", path: "/quality/prps/:id/archive", url: () => "/quality/prps/x/archive" },
  { method: "post", path: "/quality/prps/:id/restore", url: () => "/quality/prps/x/restore" },
  {
    method: "get",
    path: "/quality/prps/:id/checks",
    url: () => "/quality/prps/x/checks",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/prps/:id/checks",
    url: () => "/quality/prps/x/checks",
    body: { doneOn: "2026-11-01", conforming: true },
  },
  // Food quality, phase 6b: products, labels and the sampling plan.
  { method: "get", path: "/quality/products", url: () => "/quality/products", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/products",
    url: () => "/quality/products",
    body: { name: "Ajeno", ingredients: "Ajeno" },
  },
  {
    method: "get",
    path: "/quality/products/:id",
    url: () => "/quality/products/x",
    ownStatus: 404,
  },
  {
    method: "patch",
    path: "/quality/products/:id",
    url: () => "/quality/products/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/products/:id/archive",
    url: () => "/quality/products/x/archive",
    body: { archived: true },
  },
  { method: "post", path: "/quality/products/:id/folder", url: () => "/quality/products/x/folder" },
  {
    method: "get",
    path: "/quality/products/:id/files",
    url: () => "/quality/products/x/files",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/products/:id/studies",
    url: () => "/quality/products/x/studies",
    body: { startedOn: "2026-11-01", targetDays: 30 },
  },
  {
    method: "post",
    path: "/quality/studies/:id/result",
    url: () => "/quality/studies/x/result",
    body: { result: "PASSED", resultOn: "2026-11-01" },
  },
  {
    method: "post",
    path: "/quality/products/:id/labels",
    url: () => "/quality/products/x/labels",
    body: {},
  },
  {
    method: "post",
    path: "/quality/labels/:id/review",
    url: () => "/quality/labels/x/review",
    body: {
      decision: "REJECT",
      checks: Object.fromEntries(
        [
          "name",
          "ingredients",
          "allergens",
          "netQuantity",
          "date",
          "storage",
          "operator",
          "lot",
          "origin",
          "nutrition",
        ].map((check) => [check, "ok"]),
      ),
      reviewNote: "Ajeno",
    },
  },
  { method: "get", path: "/quality/sampling", url: () => "/quality/sampling", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/sampling",
    url: () => "/quality/sampling",
    body: { kind: "WATER", name: "Ajeno", parameter: "Ajeno", everyDays: 30 },
  },
  {
    method: "patch",
    path: "/quality/sampling/:id",
    url: () => "/quality/sampling/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/sampling/:id/archive",
    url: () => "/quality/sampling/x/archive",
  },
  {
    method: "post",
    path: "/quality/sampling/:id/restore",
    url: () => "/quality/sampling/x/restore",
  },
  { method: "post", path: "/quality/sampling/:id/folder", url: () => "/quality/sampling/x/folder" },
  {
    method: "get",
    path: "/quality/sampling/:id/files",
    url: () => "/quality/sampling/x/files",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/quality/sampling/:id/results",
    url: () => "/quality/sampling/x/results",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/sampling/:id/results",
    url: () => "/quality/sampling/x/results",
    body: { sampledOn: "2026-11-01", conforming: true },
  },
  // Food quality, phase 4: suppliers.
  { method: "get", path: "/quality/suppliers", url: () => "/quality/suppliers", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/suppliers",
    url: () => "/quality/suppliers",
    body: { name: "Ajeno", category: "OTHER", supplies: "Ajeno", risk: "LOW" },
  },
  {
    method: "get",
    path: "/quality/suppliers/:id",
    url: () => "/quality/suppliers/x",
    ownStatus: 404,
  },
  {
    method: "patch",
    path: "/quality/suppliers/:id",
    url: () => "/quality/suppliers/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/suppliers/:id/archive",
    url: () => "/quality/suppliers/x/archive",
    body: { archived: true },
  },
  {
    method: "post",
    path: "/quality/suppliers/:id/folder",
    url: () => "/quality/suppliers/x/folder",
  },
  {
    method: "get",
    path: "/quality/suppliers/:id/files",
    url: () => "/quality/suppliers/x/files",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/suppliers/:id/docs",
    url: () => "/quality/suppliers/x/docs",
    body: { kind: "OTHER", name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/supplier-docs/:id/archive",
    url: () => "/quality/supplier-docs/x/archive",
  },
  {
    method: "post",
    path: "/quality/suppliers/:id/reviews",
    url: () => "/quality/suppliers/x/reviews",
    body: {
      reviewedOn: "2026-11-01",
      scores: { quality: 3, service: 3, documents: 3, incidents: 3 },
      result: "APPROVED",
      note: "Ajeno",
    },
  },
  // Food quality, phase 3: audits and findings.
  {
    method: "get",
    path: "/quality/audits",
    url: () => "/quality/audits?year=2026",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/quality/audits/coverage",
    url: () => "/quality/audits/coverage?year=2026",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/audits",
    url: () => "/quality/audits",
    body: { scheme: "INTERNAL", title: "Ajena", plannedOn: "2026-12-01" },
  },
  { method: "get", path: "/quality/audits/:id", url: () => "/quality/audits/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/quality/audits/:id",
    url: () => "/quality/audits/x",
    body: { title: "Ajena" },
  },
  {
    method: "post",
    path: "/quality/audits/:id/done",
    url: () => "/quality/audits/x/done",
    body: { doneOn: "2026-12-01" },
  },
  {
    method: "post",
    path: "/quality/audits/:id/cancel",
    url: () => "/quality/audits/x/cancel",
    body: { reason: "Ajena" },
  },
  {
    method: "post",
    path: "/quality/audits/:id/findings",
    url: () => "/quality/audits/x/findings",
    body: { clause: "1.1", description: "Ajena", severity: "MINOR" },
  },
  {
    method: "post",
    path: "/quality/findings/:id/nc",
    url: () => "/quality/findings/x/nc",
    body: {},
  },
  // Food quality, phase 2: HACCP and product on hold.
  { method: "post", path: "/admin/quality/template", url: () => "/admin/quality/template" },
  { method: "get", path: "/quality/haccp", url: () => "/quality/haccp", ownStatus: 404 },
  {
    method: "get",
    path: "/quality/ccps/form-options",
    url: () => "/quality/ccps/form-options",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/quality/ccps",
    url: () => "/quality/ccps",
    body: {
      code: "PCC-9",
      name: "Ajeno",
      step: "Ajeno",
      hazard: "Ajeno",
      hazardType: "PHYSICAL",
      criticalLimit: "Ajeno",
      frequency: "Ajeno",
      correctiveAction: "Ajeno",
      verification: "Ajeno",
    },
  },
  {
    method: "put",
    path: "/quality/ccps/order",
    url: () => "/quality/ccps/order",
    body: { ids: ["x"] },
  },
  {
    method: "patch",
    path: "/quality/ccps/:id",
    url: () => "/quality/ccps/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/quality/ccps/:id/archive",
    url: () => "/quality/ccps/x/archive",
    body: { archived: true },
  },
  { method: "get", path: "/quality/holds", url: () => "/quality/holds", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/holds",
    url: () => "/quality/holds",
    body: { product: "Ajeno", reason: "Ajeno" },
  },
  { method: "get", path: "/quality/holds/:id", url: () => "/quality/holds/x", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/holds/:id/decision",
    url: () => "/quality/holds/x/decision",
    body: { status: "RELEASED", note: "Ajeno", signature: "data:image/png;base64,AAAA" },
  },
  {
    method: "put",
    path: "/admin/quality",
    url: () => "/admin/quality",
    body: { verifyDays: 15 },
  },
  { method: "get", path: "/quality/summary", url: () => "/quality/summary", ownStatus: 404 },
  { method: "get", path: "/quality/ncs", url: () => "/quality/ncs", ownStatus: 404 },
  {
    method: "post",
    path: "/quality/ncs",
    url: () => "/quality/ncs",
    body: {
      title: "Ajena",
      description: "Ajena",
      detectedOn: "2026-11-01",
      origin: "OTHER",
      severity: "MINOR",
      ownerId: "x",
    },
  },
  {
    method: "post",
    path: "/quality/ncs/report",
    url: () => "/quality/ncs/report",
    body: { title: "Ajena", description: "Ajena", detectedOn: "2026-11-01" },
  },
  {
    method: "post",
    path: "/quality/ncs/from-record",
    url: () => "/quality/ncs/from-record",
    body: { recordId: "x" },
  },
  {
    method: "get",
    path: "/quality/records/:id/nc",
    url: (ids) => `/quality/records/${ids.recordId}/nc`,
  },
  { method: "get", path: "/quality/ncs/export", url: () => "/quality/ncs/export", ownStatus: 404 },
  { method: "get", path: "/quality/ncs/:id", url: () => "/quality/ncs/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/quality/ncs/:id",
    url: () => "/quality/ncs/x",
    body: { title: "Ajena" },
  },
  {
    method: "post",
    path: "/quality/ncs/:id/cancel",
    url: () => "/quality/ncs/x/cancel",
    body: { reason: "Ajena" },
  },
  {
    method: "post",
    path: "/quality/ncs/:id/reopen",
    url: () => "/quality/ncs/x/reopen",
    body: { reason: "Ajena" },
  },
  {
    method: "get",
    path: "/quality/ncs/:id/events",
    url: () => "/quality/ncs/x/events",
    ownStatus: 404,
  },
  { method: "post", path: "/quality/ncs/:id/folder", url: () => "/quality/ncs/x/folder" },
  {
    method: "post",
    path: "/quality/ncs/:id/actions",
    url: () => "/quality/ncs/x/actions",
    body: { kind: "CORRECTIVE", description: "Ajena", responsibleId: "x", dueOn: "2026-12-01" },
  },
  {
    method: "put",
    path: "/quality/ncs/:id/verify-on",
    url: () => "/quality/ncs/x/verify-on",
    body: { date: "2026-12-01" },
  },
  {
    method: "post",
    path: "/quality/ncs/:id/verifications",
    url: () => "/quality/ncs/x/verifications",
    body: { effective: true, note: "Ajena" },
  },
  {
    method: "get",
    path: "/quality/forms/:id",
    url: (ids) => `/quality/forms/${ids.formId}`,
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/quality/forms/:id",
    url: (ids) => `/quality/forms/${ids.formId}`,
    body: { autoNc: true, severity: null, ownerId: null },
  },
  { method: "get", path: "/quality/actions", url: () => "/quality/actions", ownStatus: 404 },
  {
    method: "patch",
    path: "/quality/actions/:id",
    url: () => "/quality/actions/x",
    body: { description: "Ajena" },
  },
  {
    method: "post",
    path: "/quality/actions/:id/done",
    url: () => "/quality/actions/x/done",
    body: {},
  },
  // Audit rooms: A's room is 404 for B (each one sees only its own rooms).
  { method: "get", path: "/admin/audit-rooms", url: () => "/admin/audit-rooms" },
  {
    method: "post",
    path: "/admin/audit-rooms",
    url: () => "/admin/audit-rooms",
    body: { name: "Ajena", auditorEmail: "auditor@ajeno.test", expiresOn: "2099-01-01" },
  },
  {
    method: "get",
    path: "/admin/audit-rooms/:id",
    url: () => "/admin/audit-rooms/x",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/admin/audit-rooms/:id/items",
    url: () => "/admin/audit-rooms/x/items",
    body: { kind: "node", nodeId: "x" },
  },
  {
    method: "delete",
    path: "/admin/audit-rooms/:id/items/:itemId",
    url: () => "/admin/audit-rooms/x/items/y",
  },
  {
    method: "post",
    path: "/admin/audit-rooms/:id/revoke",
    url: () => "/admin/audit-rooms/x/revoke",
  },
  {
    method: "post",
    path: "/admin/audit-rooms/:id/resend",
    url: () => "/admin/audit-rooms/x/resend",
  },
  // The module is off in B: its own screens are 404 too.
  { method: "get", path: "/safety/items", url: () => "/safety/items", ownStatus: 404 },
  { method: "post", path: "/safety/items", url: () => "/safety/items", body: { name: "Ajeno" } },
  {
    method: "patch",
    path: "/safety/items/:id",
    url: () => "/safety/items/x",
    body: { name: "Ajeno" },
  },
  { method: "get", path: "/safety/deliveries", url: () => "/safety/deliveries", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/deliveries",
    url: () => "/safety/deliveries",
    body: {
      membershipId: "x",
      lines: [{ itemId: "x", quantity: 1 }],
      signature: "data:image/png;base64,AA==",
    },
  },
  {
    method: "get",
    path: "/safety/deliveries/:id",
    url: () => "/safety/deliveries/x",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/deliveries/:id/signature",
    url: () => "/safety/deliveries/x/signature",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/deliveries/:id/pdf",
    url: () => "/safety/deliveries/x/pdf",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/safety/deliveries/:id/void",
    url: () => "/safety/deliveries/x/void",
    body: { reason: "Ajeno" },
  },
  {
    method: "get",
    path: "/safety/incident-form",
    url: () => "/safety/incident-form",
    ownStatus: 404,
  },
  { method: "get", path: "/safety/incidents", url: () => "/safety/incidents", ownStatus: 404 },
  {
    method: "get",
    path: "/safety/incidents/export",
    url: () => "/safety/incidents/export",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/incidents/:id",
    url: () => "/safety/incidents/x",
    ownStatus: 404,
  },
  { method: "post", path: "/safety/incidents/:id/close", url: () => "/safety/incidents/x/close" },
  { method: "post", path: "/safety/incidents/:id/reopen", url: () => "/safety/incidents/x/reopen" },
  {
    method: "post",
    path: "/safety/incidents/:id/investigate",
    url: () => "/safety/incidents/x/investigate",
  },
  {
    method: "post",
    path: "/safety/incidents/:id/actions",
    url: () => "/safety/incidents/x/actions",
    body: { description: "Ajena", responsibleId: "x", dueOn: "2026-12-01" },
  },
  { method: "get", path: "/safety/actions", url: () => "/safety/actions", ownStatus: 404 },
  {
    method: "patch",
    path: "/safety/actions/:id",
    url: () => "/safety/actions/x",
    body: { description: "Ajena" },
  },
  {
    method: "post",
    path: "/safety/actions/:id/done",
    url: () => "/safety/actions/x/done",
    body: {},
  },
  { method: "get", path: "/safety/courses", url: () => "/safety/courses", ownStatus: 404 },
  { method: "post", path: "/safety/courses", url: () => "/safety/courses", body: { nodeId: "x" } },
  { method: "get", path: "/safety/courses/:id", url: () => "/safety/courses/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/safety/courses/:id",
    url: () => "/safety/courses/x",
    body: { validityMonths: 12 },
  },
  {
    method: "post",
    path: "/safety/courses/:id/attendance",
    url: () => "/safety/courses/x/attendance",
    body: {
      attendees: [{ membershipId: "x", signature: "data:image/png;base64,AA==" }],
      completedOn: "2026-10-30",
    },
  },
  {
    method: "get",
    path: "/safety/courses/:id/attendance/pdf",
    url: () => "/safety/courses/x/attendance/pdf?day=2026-10-30",
    ownStatus: 404,
  },
  { method: "post", path: "/safety/courses/:id/confirm", url: () => "/safety/courses/x/confirm" },
  {
    method: "post",
    path: "/safety/courses/:id/sign-sessions",
    url: () => "/safety/courses/x/sign-sessions",
    body: { attendeeIds: ["x"], completedOn: "2026-11-03" },
  },
  {
    method: "get",
    path: "/safety/courses/:id/sign-sessions",
    url: () => "/safety/courses/x/sign-sessions",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/sign-sessions/:id",
    url: () => "/safety/sign-sessions/x",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/safety/sign-sessions/:id/sign",
    url: () => "/safety/sign-sessions/x/sign",
    body: { signature: "data:image/png;base64,AA==" },
  },
  {
    method: "post",
    path: "/safety/sign-sessions/:id/close",
    url: () => "/safety/sign-sessions/x/close",
  },
  {
    method: "get",
    path: "/safety/people/:id/training",
    url: (ids) => `/safety/people/${ids.memberId}/training`,
    ownStatus: 404,
  },
  { method: "get", path: "/safety/people", url: () => "/safety/people", ownStatus: 404 },
  { method: "get", path: "/safety/summary", url: () => "/safety/summary", ownStatus: 404 },
  // Off in B: no alerts (null), not 404, so Home doesn't fail.
  { method: "get", path: "/safety/me/alerts", url: () => "/safety/me/alerts" },
  { method: "get", path: "/safety/me/count", url: () => "/safety/me/count" },
  {
    method: "get",
    path: "/safety/people/:id/fitness",
    url: (ids) => `/safety/people/${ids.memberId}/fitness`,
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/safety/people/:id/fitness",
    url: (ids) => `/safety/people/${ids.memberId}/fitness`,
    body: { status: "APT" },
  },
  {
    method: "get",
    path: "/safety/people/:id/ppe",
    url: (ids) => `/safety/people/${ids.memberId}/ppe`,
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/people/:id/pdf",
    url: (ids) => `/safety/people/${ids.memberId}/pdf`,
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/admin/safety",
    url: () => "/admin/safety",
    body: { terms: "latam" },
  },
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
  // ids.nodeId is a folder, and folders have no expiry: 404 in B too.
  {
    method: "get",
    path: "/nodes/:id/expiry",
    url: (ids) => `/nodes/${ids.nodeId}/expiry`,
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/nodes/:id/expiry",
    url: (ids) => `/nodes/${ids.nodeId}/expiry`,
    body: { dueOn: "2030-01-01" },
  },
  { method: "delete", path: "/nodes/:id/expiry", url: (ids) => `/nodes/${ids.nodeId}/expiry` },
  {
    method: "post",
    path: "/nodes/:id/expiry/suggest",
    url: (ids) => `/nodes/${ids.nodeId}/expiry/suggest`,
  },
  {
    method: "get",
    path: "/nodes/:id/expiry/responsible-options",
    url: (ids) => `/nodes/${ids.nodeId}/expiry/responsible-options`,
    ownStatus: 404,
  },
  { method: "get", path: "/expiries/space/:id", url: (ids) => `/expiries/space/${ids.spaceId}` },
  { method: "get", path: "/expiries", url: () => "/expiries" },
  { method: "get", path: "/expiries/export", url: () => "/expiries/export" },
  { method: "get", path: "/expiries/filters", url: () => "/expiries/filters" },
  { method: "get", path: "/expiries/mine", url: () => "/expiries/mine" },
  { method: "get", path: "/expiries/mine/count", url: () => "/expiries/mine/count" },
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
  // Forms: B's form never reaches A, nor does creating one in B's space.
  {
    method: "post",
    path: "/spaces/:id/forms",
    url: (ids) => `/spaces/${ids.spaceId}/forms`,
    body: {},
  },
  { method: "get", path: "/forms/:id", url: (ids) => `/forms/${ids.formId}` },
  { method: "get", path: "/forms/pending", url: () => "/forms/pending" },
  {
    method: "put",
    path: "/forms/:id/settings",
    url: (ids) => `/forms/${ids.formId}/settings`,
    body: { responsible: { type: "default" }, frequency: "none", assignees: {} },
  },
  {
    method: "put",
    path: "/forms/:id/list-fields",
    url: (ids) => `/forms/${ids.formId}/list-fields`,
    body: { fieldIds: [] },
  },
  {
    method: "put",
    path: "/forms/:id/template",
    url: (ids) => `/forms/${ids.formId}/template`,
    body: { baseVersion: 1, fields: [] },
  },
  { method: "get", path: "/forms/:id/versions", url: (ids) => `/forms/${ids.formId}/versions` },
  {
    method: "get",
    path: "/forms/:id/versions/:version",
    url: (ids) => `/forms/${ids.formId}/versions/1`,
  },
  {
    method: "post",
    path: "/forms/:id/files",
    url: (ids) => `/forms/${ids.formId}/files`,
    body: { fieldId: "pic", contentType: "image/png", size: 10 },
  },
  {
    method: "post",
    path: "/forms/:id/files/:fileId/confirm",
    url: (ids) => `/forms/${ids.formId}/files/${ids.fileId}/confirm`,
  },
  {
    method: "post",
    path: "/forms/:id/records",
    url: (ids) => `/forms/${ids.formId}/records`,
    body: { version: 1, answers: {} },
  },
  { method: "get", path: "/forms/:id/records", url: (ids) => `/forms/${ids.formId}/records` },
  {
    method: "get",
    path: "/forms/:id/export/:format",
    url: (ids) => `/forms/${ids.formId}/export/csv`,
  },
  {
    method: "post",
    path: "/forms/:id/records/:recordId/void",
    url: (ids) => `/forms/${ids.formId}/records/${ids.recordId}/void`,
    body: { reason: "Prueba de aislamiento" },
  },
  {
    method: "get",
    path: "/forms/:id/records/:recordId",
    url: (ids) => `/forms/${ids.formId}/records/${ids.recordId}`,
  },
  {
    method: "get",
    path: "/forms/:id/records/:recordId/files/:fileId",
    url: (ids) => `/forms/${ids.formId}/records/${ids.recordId}/files/${ids.fileId}`,
  },
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
  // Connected apps (connector for Claude): a connection id of B is never found from A (nor from B,
  // the test id isn't a connection).
  { method: "get", path: "/me/connections", url: () => "/me/connections" },
  {
    method: "delete",
    path: "/me/connections/:id",
    url: (ids) => `/me/connections/${ids.nodeId}`,
    ownStatus: 404,
  },
  { method: "get", path: "/admin/connections", url: () => "/admin/connections" },
  {
    method: "delete",
    path: "/admin/connections/:id",
    url: (ids) => `/admin/connections/${ids.nodeId}`,
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/admin/connector",
    url: () => "/admin/connector",
    body: { enabled: true },
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
  {
    method: "put",
    path: "/admin/plugins/:pluginId/activation",
    url: () => "/admin/plugins/plugin-de-prueba/activation",
    body: { enabled: true, acceptRisk: true },
  },
  // Signed plugin packages and restarting the server (owner only); A never reaches B's.
  { method: "post", path: "/admin/plugins/packages", url: () => "/admin/plugins/packages" },
  { method: "delete", path: "/admin/plugins/:pluginId", url: () => "/admin/plugins/audit-rooms" },
  { method: "get", path: "/admin/updates", url: () => "/admin/updates" },
  { method: "post", path: "/admin/server/restart", url: () => "/admin/server/restart" },
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
  { method: "get", path: "/admin/email/system", url: () => "/admin/email/system" },
  { method: "post", path: "/admin/email/system/test", url: () => "/admin/email/system/test" },
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
  // CAE (docs/spec/cae.md) and Prevention phases 6 to 9: CAE and the module are off in B, so its own
  // reads are 404 too; A never reaches B (each family is also checked with real ids, inside one
  // company and across companies, in cae-security, cae-portal and safety-prevention).
  {
    method: "get",
    path: "/cae/companies/:id/portal",
    url: () => "/cae/companies/x/portal",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/cae/companies/:id/portal",
    url: () => "/cae/companies/x/portal",
    body: { days: 7 },
  },
  {
    method: "post",
    path: "/cae/companies/:id/portal/revoke",
    url: () => "/cae/companies/x/portal/revoke",
  },
  { method: "get", path: "/cae/info", url: () => "/cae/info", ownStatus: 404 },
  { method: "put", path: "/cae/info", url: () => "/cae/info", body: { required: true } },
  { method: "get", path: "/cae/info/options", url: () => "/cae/info/options", ownStatus: 404 },
  {
    method: "get",
    path: "/cae/companies/:id/info",
    url: () => "/cae/companies/x/info",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/cae/companies/:id/info/deliveries",
    url: () => "/cae/companies/x/info/deliveries",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/cae/companies/:id/info/deliveries",
    url: () => "/cae/companies/x/info/deliveries",
    body: { receivedBy: "Ajeno" },
  },
  {
    method: "get",
    path: "/cae/info/deliveries/:id/pdf",
    url: () => "/cae/info/deliveries/x/pdf",
    ownStatus: 404,
  },
  { method: "get", path: "/cae/permits", url: () => "/cae/permits", ownStatus: 404 },
  {
    method: "post",
    path: "/cae/permits",
    url: () => "/cae/permits",
    body: {
      type: "HOT_WORK",
      location: "Ajena",
      validFrom: "2099-01-01T08:00:00Z",
      validTo: "2099-01-01T10:00:00Z",
      membershipIds: ["x"],
    },
  },
  { method: "get", path: "/cae/permits/:id", url: () => "/cae/permits/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/cae/permits/:id",
    url: () => "/cae/permits/x",
    body: { location: "Ajena" },
  },
  {
    method: "post",
    path: "/cae/permits/:id/approve",
    url: () => "/cae/permits/x/approve",
    body: { signature: "data:image/png;base64,AA==" },
  },
  { method: "post", path: "/cae/permits/:id/close", url: () => "/cae/permits/x/close", body: {} },
  {
    method: "post",
    path: "/cae/permits/:id/cancel",
    url: () => "/cae/permits/x/cancel",
    body: { reason: "Ajeno" },
  },
  { method: "get", path: "/cae/permits/:id/pdf", url: () => "/cae/permits/x/pdf", ownStatus: 404 },
  { method: "get", path: "/cae/check", url: () => "/cae/check?q=Ajeno", ownStatus: 404 },
  { method: "get", path: "/cae/check/:id", url: () => "/cae/check/x", ownStatus: 404 },
  {
    method: "post",
    path: "/cae/access",
    url: () => "/cae/access",
    body: { workerId: "x", direction: "IN" },
  },
  { method: "get", path: "/cae/access", url: () => "/cae/access", ownStatus: 404 },
  { method: "get", path: "/cae/workers/:id/qr", url: () => "/cae/workers/x/qr", ownStatus: 404 },
  {
    method: "get",
    path: "/cae/companies/:id/pdf",
    url: () => "/cae/companies/x/pdf",
    ownStatus: 404,
  },
  { method: "get", path: "/cae/companies", url: () => "/cae/companies", ownStatus: 404 },
  {
    method: "post",
    path: "/cae/companies",
    url: () => "/cae/companies",
    body: { name: "Ajena", kind: "CONTRACTOR", responsibleId: "x" },
  },
  { method: "get", path: "/cae/companies/:id", url: () => "/cae/companies/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/cae/companies/:id",
    url: () => "/cae/companies/x",
    body: { activity: "Ajena" },
  },
  {
    method: "post",
    path: "/cae/companies/:id/block",
    url: () => "/cae/companies/x/block",
    body: { reason: "Ajeno" },
  },
  { method: "post", path: "/cae/companies/:id/unblock", url: () => "/cae/companies/x/unblock" },
  { method: "post", path: "/cae/companies/:id/archive", url: () => "/cae/companies/x/archive" },
  {
    method: "get",
    path: "/cae/companies/:id/workers",
    url: () => "/cae/companies/x/workers",
    ownStatus: 404,
  },
  {
    method: "post",
    path: "/cae/companies/:id/workers",
    url: () => "/cae/companies/x/workers",
    body: { name: "Ajeno" },
  },
  { method: "get", path: "/cae/workers", url: () => "/cae/workers", ownStatus: 404 },
  { method: "get", path: "/cae/workers/:id", url: () => "/cae/workers/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/cae/workers/:id",
    url: () => "/cae/workers/x",
    body: { task: "Ajena" },
  },
  {
    method: "post",
    path: "/cae/workers/:id/block",
    url: () => "/cae/workers/x/block",
    body: { reason: "Ajeno" },
  },
  { method: "post", path: "/cae/workers/:id/unblock", url: () => "/cae/workers/x/unblock" },
  { method: "post", path: "/cae/workers/:id/archive", url: () => "/cae/workers/x/archive" },
  { method: "post", path: "/cae/companies/:id/folder", url: () => "/cae/companies/x/folder" },
  { method: "post", path: "/cae/workers/:id/folder", url: () => "/cae/workers/x/folder" },
  { method: "get", path: "/cae/documents", url: () => "/cae/documents", ownStatus: 404 },
  {
    method: "post",
    path: "/cae/documents",
    url: () => "/cae/documents",
    body: { requirementId: "x", companyId: "x", nodeId: "x" },
  },
  {
    method: "post",
    path: "/cae/documents/:id/accept",
    url: () => "/cae/documents/x/accept",
    body: {},
  },
  {
    method: "post",
    path: "/cae/documents/:id/reject",
    url: () => "/cae/documents/x/reject",
    body: { reason: "Ajeno" },
  },
  { method: "get", path: "/cae/requirements", url: () => "/cae/requirements", ownStatus: 404 },
  {
    method: "post",
    path: "/cae/requirements",
    url: () => "/cae/requirements",
    body: { name: "Ajeno", scope: "COMPANY" },
  },
  {
    method: "put",
    path: "/cae/requirements/order",
    url: () => "/cae/requirements/order",
    body: { scope: "COMPANY", ids: ["x"] },
  },
  {
    method: "patch",
    path: "/cae/requirements/:id",
    url: () => "/cae/requirements/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/cae/requirements/:id/archive",
    url: () => "/cae/requirements/x/archive",
  },
  { method: "get", path: "/safety/emergencies", url: () => "/safety/emergencies", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/emergencies/roles",
    url: () => "/safety/emergencies/roles",
    body: { name: "Ajeno" },
  },
  {
    method: "patch",
    path: "/safety/emergencies/roles/:id",
    url: () => "/safety/emergencies/roles/x",
    body: { name: "Ajeno" },
  },
  {
    method: "post",
    path: "/safety/emergencies/roles/:id/members",
    url: () => "/safety/emergencies/roles/x/members",
    body: { membershipId: "x" },
  },
  {
    method: "delete",
    path: "/safety/emergencies/members/:id",
    url: () => "/safety/emergencies/members/x",
  },
  {
    method: "get",
    path: "/safety/people/:id/emergency",
    url: () => "/safety/people/x/emergency",
    ownStatus: 404,
  },
  { method: "get", path: "/safety/drills", url: () => "/safety/drills", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/drills",
    url: () => "/safety/drills",
    body: { date: "2026-01-01", scenario: "FIRE" },
  },
  { method: "get", path: "/safety/drills/:id", url: () => "/safety/drills/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/safety/drills/:id",
    url: () => "/safety/drills/x",
    body: { area: "Ajena" },
  },
  {
    method: "get",
    path: "/safety/committee/access",
    url: () => "/safety/committee/access",
    ownStatus: 404,
  },
  { method: "get", path: "/safety/committee", url: () => "/safety/committee", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/committee/members",
    url: () => "/safety/committee/members",
    body: { membershipId: "x", role: "DELEGATE" },
  },
  {
    method: "patch",
    path: "/safety/committee/members/:id",
    url: () => "/safety/committee/members/x",
    body: { ended: true },
  },
  {
    method: "get",
    path: "/safety/committee/minutes-options",
    url: () => "/safety/committee/minutes-options",
    ownStatus: 404,
  },
  { method: "get", path: "/safety/meetings", url: () => "/safety/meetings", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/meetings",
    url: () => "/safety/meetings",
    body: { date: "2026-01-01", kind: "ORDINARY" },
  },
  { method: "get", path: "/safety/meetings/:id", url: () => "/safety/meetings/x", ownStatus: 404 },
  {
    method: "patch",
    path: "/safety/meetings/:id",
    url: () => "/safety/meetings/x",
    body: { agenda: "Ajena" },
  },
  {
    method: "get",
    path: "/safety/meetings/:id/agreements",
    url: () => "/safety/meetings/x/agreements",
    ownStatus: 404,
  },
  { method: "post", path: "/safety/meetings/:id/minutes", url: () => "/safety/meetings/x/minutes" },
  {
    method: "get",
    path: "/safety/indicators",
    url: () => "/safety/indicators?year=2026",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/indicators/csv",
    url: () => "/safety/indicators/csv?year=2026",
    ownStatus: 404,
  },
  {
    method: "get",
    path: "/safety/indicators/stats",
    url: () => "/safety/indicators/stats?year=2026",
    ownStatus: 404,
  },
  {
    method: "put",
    path: "/safety/indicators/stats",
    url: () => "/safety/indicators/stats",
    body: { month: "2026-01-01", departmentId: null, hoursWorked: 1, avgHeadcount: 1 },
  },
  {
    method: "put",
    path: "/safety/incidents/:id/lost-days",
    url: () => "/safety/incidents/x/lost-days",
    body: { lostDays: 1 },
  },
  { method: "get", path: "/safety/planning", url: () => "/safety/planning", ownStatus: 404 },
  {
    method: "post",
    path: "/safety/planning",
    url: () => "/safety/planning",
    body: { origin: "OTHER", description: "Ajena", responsibleId: "x", dueOn: "2099-01-01" },
  },
  {
    method: "get",
    path: "/safety/planning/csv",
    url: () => "/safety/planning/csv",
    ownStatus: 404,
  },
  {
    method: "patch",
    path: "/profile/home-area",
    url: () => "/profile/home-area",
    body: { homeArea: "WIKI" },
  },
];

let ctx: TestContext;
let app: ReturnType<typeof createApp>;
let ownApp: ReturnType<typeof createApp>;
let sweepApps: ReturnType<typeof createApp>[] = [];
const SWEEP_PER_APP = 250;
let a: Awaited<ReturnType<typeof createWorkspace>>;
let b: Awaited<ReturnType<typeof createWorkspace>>;
let bDepartmentId = "";
let bSpaceId = "";
let bNodeId = "";
let bPageId = "";
let bFormId = "";
let bRecordId = "";
let bFileId = "";

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
  // The 404 sweep goes over every route: one instance (its own in-memory limit of 300 per minute and
  // IP) for each 250 cases, so the limit never answers instead of the tenant check.
  sweepApps = Array.from({ length: Math.ceil(cases.length / SWEEP_PER_APP) }, () =>
    createApp(ctx.deps),
  );
  // Second instance, with its own in-memory rate limit (300 per minute and IP): the 404 sweep over
  // every route already uses most of the first one.
  ownApp = createApp(ctx.deps);
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
  bFormId = (
    await ctx.prisma.node.create({
      data: {
        workspaceId: b.workspaceId,
        spaceId: bSpaceId,
        type: "FORM",
        name: "Formulario",
        nameKey: "formulario",
        position: "X",
        currentVersion: 1,
        createdById: b.membershipId,
        updatedById: b.membershipId,
      },
    })
  ).id;
  await ctx.prisma.formVersion.create({
    data: {
      nodeId: bFormId,
      workspaceId: b.workspaceId,
      version: 1,
      fields: [{ id: "pic", type: "photo", label: "Foto", required: false, max: 1 }],
      createdById: b.membershipId,
    },
  });
  bRecordId = (
    await ctx.prisma.formRecord.create({
      data: {
        workspaceId: b.workspaceId,
        nodeId: bFormId,
        version: 1,
        answers: {},
        nonConforming: [],
        source: "app",
        submittedById: b.membershipId,
      },
    })
  ).id;
  bFileId = (
    await ctx.prisma.formFile.create({
      data: {
        workspaceId: b.workspaceId,
        nodeId: bFormId,
        fieldId: "pic",
        recordId: bRecordId,
        storageKey: `${b.workspaceId}/forms/${bFormId}/aislamiento.png`,
        mimeType: "image/png",
        sizeBytes: 10n,
        createdById: b.membershipId,
        confirmedAt: new Date(),
      },
    })
  ).id;
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
      formId: bFormId,
      recordId: bRecordId,
      fileId: bFileId,
    })}`;
    const res = await request(sweepApps[Math.floor(cases.indexOf(c) / SWEEP_PER_APP)] ?? app)
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
      const res = await request(ownApp)
        .get(
          `/api/v1/w/${b.slug}${c.url({
            workspaceId: b.workspaceId,
            departmentId: bDepartmentId,
            memberId: b.membershipId,
            spaceId: bSpaceId,
            nodeId: bNodeId,
            pageId: bPageId,
            formId: bFormId,
            recordId: bRecordId,
            fileId: bFileId,
          })}`,
        )
        .set("Authorization", `Bearer ${b.token}`);
      expect(res.status).toBe(c.ownStatus ?? 200);
    },
  );

  describe("espacios confidenciales y subáreas", () => {
    const get = (ws: { slug: string }, token: string, path: string) =>
      request(ownApp).get(`/api/v1/w/${ws.slug}${path}`).set("Authorization", `Bearer ${token}`);

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
    const res = await request(ownApp)
      .get("/api/v1/w/no-existe-este-workspace")
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });

  it("nunca se acepta el workspace por query ni body", async () => {
    const res = await request(ownApp)
      .get(`/api/v1/w/${a.slug}/admin/limits?workspaceId=${b.workspaceId}`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    const own = await request(ownApp)
      .get(`/api/v1/w/${a.slug}/`)
      .set("Authorization", `Bearer ${a.token}`);
    expect(bodyOf(own).workspace.id).toBe(a.workspaceId);
  });
});
