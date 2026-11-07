// CAE status and authorization rules (docs/spec/cae.md, «Estado y autorización»): pure functions, no
// database. A company is authorized within its dates, not blocked nor archived, with its required
// documents ok or due soon, its site information received and, for a subcontractor, its contractor
// authorized; a worker also needs their company authorized.
import { describe, expect, it } from "vitest";
import {
  appliesToKind,
  companyStatus,
  documentState,
  workerStatus,
  type CaeDocumentRef,
  type CaeRequirementRef,
  type CaeStatus,
  type CompanyForStatus,
  type CurrentDocuments,
} from "../src/modules/safety/cae-status.ts";

const TODAY = "2026-11-07";

const company = (over: Partial<CompanyForStatus> = {}): CompanyForStatus => ({
  name: "Limpiezas Norte",
  kind: "CONTRACTOR",
  blockedAt: null,
  blockedReason: null,
  archivedAt: null,
  startsOn: null,
  endsOn: null,
  ...over,
});

const requirement = (over: Partial<CaeRequirementRef> = {}): CaeRequirementRef => ({
  id: "req-1",
  name: "Seguro RC",
  scope: "COMPANY",
  appliesTo: "ALL",
  required: true,
  validityMonths: 12,
  ...over,
});

const doc = (over: Partial<CaeDocumentRef> = {}): CaeDocumentRef => ({
  id: "doc-1",
  nodeId: "node-1",
  fileName: "seguro.pdf",
  status: "ACCEPTED",
  validUntil: "2027-06-01",
  rejectReason: null,
  fromPortal: false,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});

const docsOf = (entries: [string, CaeDocumentRef[]][]): CurrentDocuments =>
  new Map(
    entries.flatMap(([id, list]) => {
      const state = documentState(list, TODAY);
      return state === null ? [] : [[id, state] as const];
    }),
  );

const authorized: CaeStatus = {
  authorized: true,
  state: "authorized",
  reasons: [],
  requirements: [],
};
const notAuthorized: CaeStatus = {
  authorized: false,
  state: "incomplete",
  reasons: ["x"],
  requirements: [],
};

describe("appliesToKind", () => {
  it("ALL a todas; CONTRACTOR a contratas y subcontratas; CONCURRENT solo a concurrentes", () => {
    expect(appliesToKind("ALL", "CONCURRENT")).toBe(true);
    expect(appliesToKind("CONTRACTOR", "CONTRACTOR")).toBe(true);
    expect(appliesToKind("CONTRACTOR", "SUBCONTRACTOR")).toBe(true);
    expect(appliesToKind("CONTRACTOR", "CONCURRENT")).toBe(false);
    expect(appliesToKind("CONCURRENT", "CONCURRENT")).toBe(true);
    expect(appliesToKind("CONCURRENT", "SUBCONTRACTOR")).toBe(false);
  });
});

describe("documentState", () => {
  it("vigente, por vencer y vencido según la fecha", () => {
    expect(documentState([doc()], TODAY)?.state).toBe("ok");
    expect(documentState([doc({ validUntil: "2026-11-20" })], TODAY)?.state).toBe("due_soon");
    expect(documentState([doc({ validUntil: "2026-11-01" })], TODAY)?.state).toBe("expired");
    expect(documentState([doc({ validUntil: null })], TODAY)?.state).toBe("ok");
    expect(documentState([], TODAY)).toBeNull();
  });

  it("uno nuevo pendiente sobre uno vencido queda pendiente; sin aceptado, rechazado", () => {
    const newer = doc({
      id: "doc-2",
      status: "PENDING",
      validUntil: null,
      createdAt: new Date("2026-11-05T00:00:00Z"),
    });
    const state = documentState([newer, doc({ validUntil: "2026-11-01" })], TODAY);
    expect(state?.state).toBe("pending");
    expect(state?.latest?.id).toBe("doc-2");
    expect(
      documentState([doc({ status: "REJECTED", rejectReason: "Ilegible" })], TODAY)?.state,
    ).toBe("rejected");
    // A pending one on top of a valid one doesn't take the authorization away.
    expect(documentState([newer, doc()], TODAY)?.state).toBe("ok");
  });
});

describe("companyStatus", () => {
  it("con todo en regla está autorizada; sin el documento exigido, no", () => {
    const requirements = [requirement()];
    const ok = companyStatus({
      company: company(),
      requirements,
      documents: docsOf([["req-1", [doc()]]]),
      today: TODAY,
    });
    expect(ok).toMatchObject({ authorized: true, state: "authorized", reasons: [] });
    const missing = companyStatus({ company: company(), requirements, today: TODAY });
    expect(missing.authorized).toBe(false);
    expect(missing.state).toBe("incomplete");
    expect(missing.requirements[0]?.state).toBe("missing");
  });

  it("por vencer autoriza; vencido, no", () => {
    const requirements = [requirement()];
    const soon = companyStatus({
      company: company(),
      requirements,
      documents: docsOf([["req-1", [doc({ validUntil: "2026-11-20" })]]]),
      today: TODAY,
    });
    expect(soon.authorized).toBe(true);
    expect(soon.requirements[0]?.state).toBe("due_soon");
    const expired = companyStatus({
      company: company(),
      requirements,
      documents: docsOf([["req-1", [doc({ validUntil: "2026-11-01" })]]]),
      today: TODAY,
    });
    expect(expired.authorized).toBe(false);
    expect(expired.reasons).toHaveLength(1);
  });

  it("un requisito opcional o de trabajadores, o que no aplica a su tipo, no cuenta", () => {
    const status = companyStatus({
      company: company({ kind: "CONCURRENT" }),
      requirements: [
        requirement({ id: "a", required: false }),
        requirement({ id: "b", scope: "WORKER" }),
        requirement({ id: "c", appliesTo: "CONTRACTOR" }),
      ],
      today: TODAY,
    });
    expect(status.authorized).toBe(true);
    expect(status.requirements.map((item) => item.requirement.id)).toEqual(["a"]);
  });

  it("bloqueada, archivada o fuera de sus fechas no está autorizada", () => {
    const base = { requirements: [], today: TODAY };
    expect(
      companyStatus({
        ...base,
        company: company({ blockedAt: new Date(), blockedReason: "Sin RC" }),
      }),
    ).toMatchObject({ authorized: false, state: "blocked" });
    expect(companyStatus({ ...base, company: company({ archivedAt: new Date() }) })).toMatchObject({
      authorized: false,
      state: "archived",
    });
    expect(
      companyStatus({ ...base, company: company({ startsOn: new Date("2026-12-01T00:00:00Z") }) })
        .authorized,
    ).toBe(false);
    expect(
      companyStatus({ ...base, company: company({ endsOn: new Date("2026-11-06T00:00:00Z") }) })
        .authorized,
    ).toBe(false);
    expect(
      companyStatus({ ...base, company: company({ endsOn: new Date("2026-11-07T00:00:00Z") }) })
        .authorized,
    ).toBe(true);
  });

  it("una subcontrata depende de su contrata", () => {
    const sub = company({ name: "Sub", kind: "SUBCONTRACTOR" });
    expect(
      companyStatus({
        company: sub,
        requirements: [],
        today: TODAY,
        parent: { name: "Contrata", status: authorized },
      }).authorized,
    ).toBe(true);
    const denied = companyStatus({
      company: sub,
      requirements: [],
      today: TODAY,
      parent: { name: "Contrata", status: notAuthorized },
    });
    expect(denied.authorized).toBe(false);
    expect(denied.reasons.join(" ")).toContain("Contrata");
  });

  it("le falta la información del centro: no autorizada, con el motivo", () => {
    const status = companyStatus({
      company: company(),
      requirements: [],
      today: TODAY,
      infoMissing: ["Plan de emergencia"],
    });
    expect(status.authorized).toBe(false);
    expect(status.reasons.join(" ")).toContain("Plan de emergencia");
  });
});

describe("workerStatus", () => {
  const worker = { blockedAt: null, blockedReason: null, archivedAt: null };
  const workerReq = requirement({ id: "w-1", scope: "WORKER", name: "Formación PRL" });

  it("autorizado con su empresa autorizada y sus documentos; si no, con los motivos", () => {
    const ok = workerStatus({
      worker,
      company: { name: "Limpiezas Norte", kind: "CONTRACTOR", status: authorized },
      requirements: [workerReq],
      documents: docsOf([["w-1", [doc()]]]),
    });
    expect(ok.authorized).toBe(true);
    const companyDown = workerStatus({
      worker,
      company: { name: "Limpiezas Norte", kind: "CONTRACTOR", status: notAuthorized },
      requirements: [workerReq],
      documents: docsOf([["w-1", [doc()]]]),
    });
    expect(companyDown.authorized).toBe(false);
    expect(companyDown.reasons.join(" ")).toContain("Limpiezas Norte");
    const missing = workerStatus({
      worker,
      company: { name: "Limpiezas Norte", kind: "CONTRACTOR", status: authorized },
      requirements: [workerReq],
    });
    expect(missing.authorized).toBe(false);
  });

  it("bloqueado o archivado no entra", () => {
    const companyOk = { name: "E", kind: "CONTRACTOR" as const, status: authorized };
    expect(
      workerStatus({
        worker: { ...worker, blockedAt: new Date(), blockedReason: "Sin EPI" },
        company: companyOk,
        requirements: [],
      }).state,
    ).toBe("blocked");
    expect(
      workerStatus({
        worker: { ...worker, archivedAt: new Date() },
        company: companyOk,
        requirements: [],
      }).state,
    ).toBe("archived");
  });
});
