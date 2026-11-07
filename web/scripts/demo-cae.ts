// CAE demo data (docs/spec/cae.md) for a demo company, through the app's own API like a person would:
// CAE and its access log turned on with the food sector's examples, four contractors (one with a
// subcontractor), their workers, documents in every state (real small PDFs uploaded with the normal
// upload flow, so they open), the site information and a handover, two work permits and today's
// accesses. The result shows authorized, incomplete and blocked companies.
//
// Used by capturas.ts (its own *_capturas database) and by a local script on the development database.
// Idempotent: a company that already exists (by name) is left as it is.
import { deflateSync, crc32 } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";

export type DemoLocale = "es" | "en";

export interface DemoCaeTarget {
  /** The API's origin, e.g. http://localhost:4000. */
  base: string;
  /** An owner's access token (the demo owners have no 2FA). */
  token: string;
  slug: string;
  locale: DemoLocale;
  /** The emails of the internal responsible person and of an own-staff member for the permits. */
  responsibleEmail: string;
  staffEmail: string;
  log?: (line: string) => void;
}

// ─── Small PDFs and signatures ───────────────────────────────────────────────────────────

/** A one-page PDF with a title and a few lines (Helvetica): small but valid, so it opens. */
export function demoPdf(title: string, lines: readonly string[]): Buffer {
  const escape = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^\x20-\x7e]/gu, "?")
      .replace(/[\\()]/gu, (char) => `\\${char}`);
  const body = [
    "BT /F1 18 Tf 60 770 Td",
    `(${escape(title)}) Tj`,
    "/F1 11 Tf 0 -30 Td",
    ...lines.map((line, index) => `${index === 0 ? "" : "0 -16 Td "}(${escape(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${String(Buffer.byteLength(body))} >>\nstream\n${body}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** A hand-drawn-looking signature as a real PNG data URL. */
export function demoSignature(seed: number): string {
  const w = 220;
  const h = 70;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const curve = 35 + Math.sin((x + seed * 7) / 11) * 16 * Math.cos(x / 37 + seed);
      rows.push(Math.abs(y - curve) < 1.8 && x > 12 && x < w - 12 ? 20 : 255);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// ─── Texts ───────────────────────────────────────────────────────────────────────────────

interface DemoWorker {
  name: string;
  idNumber: string;
  task: string;
}

interface DemoCompany {
  key: "cleaning" | "cold" | "pests" | "fumigation" | "haulage";
  name: string;
  taxId: string;
  kind: "CONTRACTOR" | "SUBCONTRACTOR" | "CONCURRENT";
  activity: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  workers: DemoWorker[];
}

const COMPANIES: Record<DemoLocale, DemoCompany[]> = {
  es: [
    {
      key: "cleaning",
      name: "Limpiezas Industriales Norte S.L.",
      taxId: "B12345678",
      kind: "CONTRACTOR",
      activity: "Limpieza nocturna de las salas de producción y de las cámaras.",
      contactName: "Marta Gil",
      contactEmail: "marta.gil@limpiezas-norte.example",
      contactPhone: "+34 600 111 222",
      workers: [
        { name: "Andrea Ruiz Campos", idNumber: "12345678Z", task: "Limpiadora de producción" },
        {
          name: "Jorge Molina Vidal",
          idNumber: "87654321X",
          task: "Encargado de turno de limpieza",
        },
        { name: "Lucía Ferrer Soto", idNumber: "11223344B", task: "Limpiadora de cámaras" },
      ],
    },
    {
      key: "cold",
      name: "Frío Técnico Levante S.A.",
      taxId: "A87654321",
      kind: "CONTRACTOR",
      activity: "Mantenimiento de los equipos de frío de las cámaras y del túnel de congelación.",
      contactName: "Raúl Pastor",
      contactEmail: "raul.pastor@friotecnico.example",
      contactPhone: "+34 600 333 444",
      workers: [
        { name: "Sergio Navarro Gil", idNumber: "22334455C", task: "Frigorista" },
        { name: "Iván Romero Prieto", idNumber: "33445566D", task: "Ayudante de frigorista" },
      ],
    },
    {
      key: "pests",
      name: "Control de Plagas Ibérica S.L.",
      taxId: "B55667788",
      kind: "CONTRACTOR",
      activity: "Control de plagas mensual: cebos, trampas de insectos e informes.",
      contactName: "Elena Ortiz",
      contactEmail: "elena.ortiz@plagas-iberica.example",
      contactPhone: "+34 600 555 666",
      workers: [
        { name: "Pablo Herrera Luna", idNumber: "44556677E", task: "Aplicador de biocidas" },
        { name: "Nuria Castro Peña", idNumber: "55667788F", task: "Técnica de control de plagas" },
      ],
    },
    {
      key: "fumigation",
      name: "Fumigaciones del Sur S.L.",
      taxId: "B99887766",
      kind: "SUBCONTRACTOR",
      activity:
        "Fumigación de los almacenes de materia prima, subcontratada por el control de plagas.",
      contactName: "Tomás León",
      contactEmail: "tomas.leon@fumigaciones-sur.example",
      contactPhone: "+34 600 777 888",
      workers: [
        { name: "Diego Santos Mora", idNumber: "66778899G", task: "Fumigador" },
        { name: "Alba Cano Ríos", idNumber: "77889900H", task: "Fumigadora" },
      ],
    },
    {
      key: "haulage",
      name: "Transportes Rápidos Mediterráneo S.L.",
      taxId: "B44332211",
      kind: "CONCURRENT",
      activity:
        "Carga y descarga en los muelles de expedición (comparte el centro con sus camiones).",
      contactName: "Carlos Vega",
      contactEmail: "carlos.vega@trm.example",
      contactPhone: "+34 600 999 000",
      workers: [
        { name: "Manuel Díaz Ortega", idNumber: "88990011J", task: "Conductor" },
        { name: "Rosa Blanco Iglesias", idNumber: "99001122K", task: "Conductora" },
      ],
    },
  ],
  en: [
    {
      key: "cleaning",
      name: "Northline Industrial Cleaning Ltd",
      taxId: "GB123456789",
      kind: "CONTRACTOR",
      activity: "Night cleaning of the production rooms and the cold rooms.",
      contactName: "Megan Price",
      contactEmail: "megan.price@northline.example",
      contactPhone: "+44 7700 900111",
      workers: [
        { name: "Chloe Bennett", idNumber: "QQ123456A", task: "Production cleaner" },
        { name: "Liam Turner", idNumber: "QQ234567B", task: "Cleaning shift supervisor" },
        { name: "Sophie Walker", idNumber: "QQ345678C", task: "Cold room cleaner" },
      ],
    },
    {
      key: "cold",
      name: "Coldtech Refrigeration Services",
      taxId: "GB987654321",
      kind: "CONTRACTOR",
      activity: "Maintenance of the cold room equipment and the blast freezer.",
      contactName: "Ian Fletcher",
      contactEmail: "ian.fletcher@coldtech.example",
      contactPhone: "+44 7700 900222",
      workers: [
        { name: "Owen Harris", idNumber: "QQ456789D", task: "Refrigeration engineer" },
        { name: "Callum Reid", idNumber: "QQ567890E", task: "Refrigeration apprentice" },
      ],
    },
    {
      key: "pests",
      name: "Pestguard Hygiene Services",
      taxId: "GB555666777",
      kind: "CONTRACTOR",
      activity: "Monthly pest control: bait stations, insect traps and reports.",
      contactName: "Laura Hughes",
      contactEmail: "laura.hughes@pestguard.example",
      contactPhone: "+44 7700 900333",
      workers: [
        { name: "Daniel Cooper", idNumber: "QQ678901F", task: "Pest control technician" },
        { name: "Amelia Ward", idNumber: "QQ789012G", task: "Field biologist" },
      ],
    },
    {
      key: "fumigation",
      name: "Southern Fumigation Ltd",
      taxId: "GB999888777",
      kind: "SUBCONTRACTOR",
      activity: "Fumigation of the raw material stores, subcontracted by the pest control company.",
      contactName: "Tom Lewis",
      contactEmail: "tom.lewis@southernfumigation.example",
      contactPhone: "+44 7700 900444",
      workers: [
        { name: "Ethan Morris", idNumber: "QQ890123H", task: "Fumigator" },
        { name: "Isla Griffiths", idNumber: "QQ901234J", task: "Fumigator" },
      ],
    },
    {
      key: "haulage",
      name: "Rapid Haulage Ltd",
      taxId: "GB444333222",
      kind: "CONCURRENT",
      activity: "Loading and unloading at the dispatch docks (shares the site with its lorries).",
      contactName: "Carl Evans",
      contactEmail: "carl.evans@rapidhaulage.example",
      contactPhone: "+44 7700 900555",
      workers: [
        { name: "George Phillips", idNumber: "QQ012345K", task: "Driver" },
        { name: "Ruby Clarke", idNumber: "QQ123450L", task: "Driver" },
      ],
    },
  ],
};

const TEXTS: Record<
  DemoLocale,
  {
    issued: string;
    pdfLine: (company: string, worker: string | null) => string;
    blockReason: string;
    rejectReason: string;
    receivedBy: string;
    hotWork: { location: string; description: string };
    height: { location: string; description: string; note: string };
  }
> = {
  es: {
    issued: "Documento de ejemplo de la demo de SpiderFolio.",
    pdfLine: (company, worker) =>
      worker === null ? `Empresa: ${company}` : `Trabajador: ${worker} (${company})`,
    blockReason: "Certificado de control de plagas caducado: no puede entrar hasta renovarlo.",
    rejectReason: "El recibo del seguro no corresponde a este año: sube el vigente.",
    receivedBy: "Marta Gil",
    hotWork: {
      location: "Sala de máquinas de frío",
      description: "Soldadura de un soporte de la tubería de la cámara 2.",
    },
    height: {
      location: "Cubierta de la nave de expedición",
      description: "Limpieza de los lucernarios desde la plataforma elevadora.",
      note: "Trabajo terminado sin incidencias; zona recogida.",
    },
  },
  en: {
    issued: "Example document from the SpiderFolio demo.",
    pdfLine: (company, worker) =>
      worker === null ? `Company: ${company}` : `Worker: ${worker} (${company})`,
    blockReason: "Pest control certificate expired: they can't come in until it's renewed.",
    rejectReason: "The insurance receipt isn't this year's: upload the current one.",
    receivedBy: "Megan Price",
    hotWork: {
      location: "Refrigeration plant room",
      description: "Welding a bracket on cold room 2's pipework.",
    },
    height: {
      location: "Dispatch building roof",
      description: "Cleaning the skylights from the mobile elevating work platform.",
      note: "Work finished with no incidents; area tidied up.",
    },
  },
};

// ─── API ─────────────────────────────────────────────────────────────────────────────────

function apiOf(target: DemoCaeTarget) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${target.base}/api/v1/w/${target.slug}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${target.token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 429) {
        // The API's global limit (300 a minute): wait as it says.
        const wait = Number(res.headers.get("retry-after") ?? "20");
        await sleep((Number.isFinite(wait) ? wait : 20) * 1000 + 500);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)} ${await res.text()}`);
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
    throw new Error(`${method} ${path}: too many retries`);
  };
  /** Uploads a file to a folder with the normal flow (ticket, PUT, complete) and returns its node. */
  const upload = async (spaceId: string, folderId: string, name: string, bytes: Buffer) => {
    const { upload: ticket } = await call<{
      upload: { id: string; url: string | null; contentType: string };
    }>("POST", `/spaces/${spaceId}/uploads`, {
      parentId: folderId,
      name,
      size: bytes.length,
      onConflict: "keep_both",
    });
    if (ticket.url === null) throw new Error("multipart upload not expected for a small file");
    const put = await fetch(ticket.url, {
      method: "PUT",
      headers: { "content-type": ticket.contentType },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) throw new Error(`PUT ${name}: ${String(put.status)}`);
    const done = await call<{ node: { id: string } }>("POST", `/uploads/${ticket.id}/complete`);
    return done.node.id;
  };
  return { call, upload };
}

interface Requirement {
  id: string;
  name: string;
  scope: "COMPANY" | "WORKER";
  appliesTo: "ALL" | "CONTRACTOR" | "CONCURRENT";
  required: boolean;
  validityMonths: number | null;
}

const applies = (requirement: Requirement, kind: DemoCompany["kind"]) =>
  requirement.appliesTo === "ALL" ||
  (requirement.appliesTo === "CONCURRENT" ? kind === "CONCURRENT" : kind !== "CONCURRENT");

/** What happens to each document: accepted until a day, pending, rejected or not given. */
type Plan = { state: "ok"; until: string | null } | { state: "pending" | "rejected" | "skip" };

// ─── The demo ────────────────────────────────────────────────────────────────────────────

export async function demoCae(target: DemoCaeTarget): Promise<Record<string, number>> {
  const log = target.log ?? (() => undefined);
  const { call, upload } = apiOf(target);
  const t = TEXTS[target.locale];
  const counts: Record<string, number> = {};
  const count = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  // CAE on with the food sector's examples and the gatehouse log (the module first, if it's off).
  const { safety } = await call<{ safety: { enabled: boolean; cae: { enabled: boolean } } }>(
    "GET",
    "/admin/safety",
  );
  if (!safety.enabled) await call("PUT", "/admin/safety", { enabled: true });
  if (!safety.cae.enabled) {
    await call("PUT", "/admin/safety", { cae: true, examples: true });
    count("cae enabled");
  }
  await call("PUT", "/admin/safety", { caeAccessLog: true });

  // The internal responsible person and an own-staff member.
  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const memberOf = (email: string) => {
    const member = members.items.find((item) => item.email === email);
    if (member === undefined) throw new Error(`Missing member ${email}`);
    return member.id;
  };
  const responsibleId = memberOf(target.responsibleEmail);
  const staffId = memberOf(target.staffEmail);

  // The site information: the first two controlled documents in force.
  const options = await call<{ items: { id: string }[] }>("GET", "/cae/info/options?pageSize=2");
  const info = await call<{ info: { documents: unknown[] } }>("GET", "/cae/info");
  if (info.info.documents.length === 0 && options.items.length > 0) {
    await call("PUT", "/cae/info", { nodeIds: options.items.map((item) => item.id) });
    count("info documents");
  }

  const requirements = (
    await call<{ items: (Requirement & { archived: boolean })[] }>(
      "GET",
      "/cae/requirements?pageSize=100",
    )
  ).items.filter((item) => !item.archived);

  const companies = COMPANIES[target.locale];
  const ids = new Map<DemoCompany["key"], string>();
  const workerIds = new Map<string, string>();

  for (const company of companies) {
    const existing = await call<{ items: { id: string; name: string }[] }>(
      "GET",
      `/cae/companies?q=${encodeURIComponent(company.name)}&status=archived`,
    );
    const found =
      (
        await call<{ items: { id: string; name: string }[] }>(
          "GET",
          `/cae/companies?q=${encodeURIComponent(company.name)}`,
        )
      ).items.find((item) => item.name === company.name) ??
      existing.items.find((item) => item.name === company.name);
    const parentId = company.kind === "SUBCONTRACTOR" ? (ids.get("pests") ?? null) : null;
    // Resumable: an existing company only gets what it's missing.
    const { company: created } =
      found !== undefined
        ? { company: found }
        : await call<{ company: { id: string } }>("POST", "/cae/companies", {
            name: company.name,
            taxId: company.taxId,
            kind: company.kind,
            parentId,
            activity: company.activity,
            contactName: company.contactName,
            contactEmail: company.contactEmail,
            contactPhone: company.contactPhone,
            responsibleId,
            startsOn: day(-120),
            endsOn: company.kind === "CONCURRENT" ? null : day(240),
          });
    ids.set(company.key, created.id);
    if (found === undefined) count("companies");
    const detail = await call<{
      company: {
        blocked: unknown;
        requirements: { requirement: { id: string }; current: unknown; latest: unknown }[];
      };
    }>("GET", `/cae/companies/${created.id}`);
    /** Requirements of a company or worker that already have a document. */
    const given = (items: { requirement: { id: string }; current: unknown; latest: unknown }[]) =>
      new Set(
        items
          .filter((item) => item.current !== null || item.latest !== null)
          .map((item) => item.requirement.id),
      );
    const ownGiven = given(detail.company.requirements);

    const { target: folder } = await call<{ target: { spaceId: string; folderId: string } }>(
      "POST",
      `/cae/companies/${created.id}/folder`,
    );
    /** Uploads the document's file and gives it as the plan says. */
    const give = async (
      requirement: Requirement,
      plan: Plan,
      where: { spaceId: string; folderId: string },
      worker: { id: string; name: string } | null,
    ) => {
      if (plan.state === "skip") return;
      const nodeId = await upload(
        where.spaceId,
        where.folderId,
        // A file name can't have slashes («RNT/ITA»).
        `${requirement.name.replace(/[/\\]/gu, "-")}.pdf`,
        demoPdf(requirement.name, [t.pdfLine(company.name, worker?.name ?? null), t.issued]),
      );
      const { document } = await call<{ document: { id: string } }>("POST", "/cae/documents", {
        requirementId: requirement.id,
        companyId: created.id,
        workerId: worker?.id ?? null,
        nodeId,
        validUntil: plan.state === "ok" ? plan.until : null,
        accept: false,
      });
      if (plan.state === "ok") {
        await call("POST", `/cae/documents/${document.id}/accept`, { validUntil: plan.until });
      } else if (plan.state === "rejected") {
        await call("POST", `/cae/documents/${document.id}/reject`, { reason: t.rejectReason });
      }
      count(`documents ${plan.state}`);
    };
    const valid = (requirement: Requirement, soon = false): Plan => ({
      state: "ok",
      until:
        requirement.validityMonths === null
          ? null
          : soon
            ? day(12)
            : day(Math.min(requirement.validityMonths * 30, 360)),
    });

    // The company's own documents.
    const own = requirements.filter((r) => r.scope === "COMPANY" && applies(r, company.kind));
    for (const [index, requirement] of own.entries()) {
      const plan: Plan =
        company.key === "cleaning" || company.key === "haulage" || company.key === "pests"
          ? // Everything in order (one of them about to expire).
            requirement.required || company.key === "pests"
            ? valid(requirement, index === 1)
            : { state: "skip" }
          : company.key === "cold"
            ? // Every state: valid, expired, rejected, pending and missing.
              ([
                valid(requirement),
                { state: "ok", until: day(-9) } as Plan,
                { state: "rejected" } as Plan,
                { state: "pending" } as Plan,
              ][index] ?? { state: "skip" })
            : // The subcontractor: in order, but its contractor is blocked.
              requirement.required
              ? valid(requirement)
              : { state: "skip" };
      if (!ownGiven.has(requirement.id)) await give(requirement, plan, folder, null);
    }

    // The workers and their documents.
    const workerRequirements = requirements.filter(
      (r) => r.scope === "WORKER" && applies(r, company.kind),
    );
    for (const [index, worker] of company.workers.entries()) {
      const listed = await call<{ items: { id: string; name: string }[] }>(
        "GET",
        `/cae/companies/${created.id}/workers?q=${encodeURIComponent(worker.name)}`,
      );
      const known = listed.items.find((item) => item.name === worker.name);
      const { worker: createdWorker } =
        known !== undefined
          ? { worker: known }
          : await call<{ worker: { id: string } }>(
              "POST",
              `/cae/companies/${created.id}/workers`,
              worker,
            );
      workerIds.set(`${company.key}:${String(index)}`, createdWorker.id);
      if (known === undefined) count("workers");
      // The first worker of each company has everything; the second misses one and has one pending;
      // the rest have nothing yet.
      if (index > 1) continue;
      const { target: workerFolder } = await call<{
        target: { spaceId: string; folderId: string };
      }>("POST", `/cae/workers/${createdWorker.id}/folder`);
      const workerDetail = await call<{
        worker: {
          requirements: { requirement: { id: string }; current: unknown; latest: unknown }[];
        };
      }>("GET", `/cae/workers/${createdWorker.id}`);
      const workerGiven = given(workerDetail.worker.requirements);
      for (const [at, requirement] of workerRequirements.entries()) {
        if (workerGiven.has(requirement.id)) continue;
        const plan: Plan =
          index === 0
            ? valid(requirement, at === 0)
            : at === 0
              ? { state: "skip" }
              : at === 1
                ? { state: "pending" }
                : valid(requirement);
        await give(requirement, plan, workerFolder, { id: createdWorker.id, name: worker.name });
      }
    }

    // The site information, handed over to every company but the refrigeration one.
    if (company.key !== "cold") {
      const companyInfo = await call<{ info: { documents: { delivered: boolean }[] } }>(
        "GET",
        `/cae/companies/${created.id}/info`,
      );
      if (companyInfo.info.documents.some((doc) => !doc.delivered)) {
        await call("POST", `/cae/companies/${created.id}/info/deliveries`, {
          deliveredOn: day(-30),
          receivedBy: company.key === "cleaning" ? t.receivedBy : company.contactName,
          signature: demoSignature(company.name.length),
        });
        count("info deliveries");
      }
    }
    if (company.key === "pests" && detail.company.blocked === null) {
      await call("POST", `/cae/companies/${created.id}/block`, { reason: t.blockReason });
      count("blocked");
    }
    log(`${company.name}: ${found === undefined ? "created" : "completed"}`);
  }

  // Work permits: hot work active now, and a closed job at height. Only once.
  const permits = await call<{ total: number }>("GET", "/cae/permits?pageSize=1");
  const cleaningId = ids.get("cleaning");
  const coldId = ids.get("cold");
  const welder = workerIds.get("cleaning:0");
  if (
    permits.total === 0 &&
    cleaningId !== undefined &&
    coldId !== undefined &&
    welder !== undefined
  ) {
    const now = Date.now();
    const hour = 3_600_000;
    const precautionsOf = (type: string) => {
      const labels = PRECAUTIONS[target.locale][type] ?? [];
      return labels.map((label) => ({ label, done: true }));
    };
    const { permit: hot } = await call<{ permit: { id: string } }>("POST", "/cae/permits", {
      type: "HOT_WORK",
      companyId: cleaningId,
      location: t.hotWork.location,
      description: t.hotWork.description,
      validFrom: new Date(now - hour).toISOString(),
      validTo: new Date(now + 7 * hour).toISOString(),
      workerIds: [welder],
      membershipIds: [staffId],
      precautions: precautionsOf("HOT_WORK"),
    });
    await call("POST", `/cae/permits/${hot.id}/approve`, { signature: demoSignature(3) });
    count("permits");
    const { permit: height } = await call<{ permit: { id: string } }>("POST", "/cae/permits", {
      type: "HEIGHT",
      location: t.height.location,
      description: t.height.description,
      validFrom: new Date(now - 3 * hour).toISOString(),
      validTo: new Date(now + 2 * hour).toISOString(),
      workerIds: [],
      membershipIds: [staffId],
      precautions: precautionsOf("HEIGHT"),
    });
    await call("POST", `/cae/permits/${height.id}/approve`, { signature: demoSignature(5) });
    await call("POST", `/cae/permits/${height.id}/close`, { note: t.height.note });
    count("permits");
  }

  // Today's accesses at the gate: the authorized workers come in, one already left.
  const today = await call<{ total: number }>("GET", "/cae/access?pageSize=1");
  if (today.total === 0) {
    for (const key of ["cleaning:0", "haulage:0"]) {
      const workerId = workerIds.get(key);
      if (workerId === undefined) continue;
      try {
        await call("POST", "/cae/access", { workerId, direction: "IN" });
        count("accesses");
      } catch (error) {
        log(`access ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const leaving = workerIds.get("haulage:0");
    if (leaving !== undefined) {
      await call("POST", "/cae/access", { workerId: leaving, direction: "OUT" });
      count("accesses");
    }
  }
  return counts;
}

/** The precautions the app proposes for each permit type (frontend i18n), ticked. */
const PRECAUTIONS: Record<DemoLocale, Record<string, string[]>> = {
  es: {
    HOT_WORK: [
      "Zona libre de materiales combustibles en 10 m",
      "Extintor a mano",
      "Vigilancia contra incendios durante el trabajo y 30 minutos después",
      "Detectores de la zona anulados y repuestos al terminar",
      "EPI de soldadura",
    ],
    HEIGHT: [
      "Andamio o plataforma revisados",
      "Arnés anclado a un punto o línea de vida",
      "Zona inferior señalizada y acotada",
      "Herramientas atadas",
      "Condiciones meteorológicas comprobadas",
    ],
  },
  en: {
    HOT_WORK: [
      "No combustible materials within 10 m",
      "Extinguisher at hand",
      "Fire watch during the work and 30 minutes after",
      "Area detectors bypassed and restored when done",
      "Welding PPE",
    ],
    HEIGHT: [
      "Scaffold or platform inspected",
      "Harness anchored to a point or lifeline",
      "Area below marked off",
      "Tools tethered",
      "Weather checked",
    ],
  },
};

/** The demo's companies and workers by key (for the captures). */
export function demoCaeNames(locale: DemoLocale) {
  return COMPANIES[locale];
}
