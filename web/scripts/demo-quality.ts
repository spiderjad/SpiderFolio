// Demo data for food quality (docs/spec/calidad.md, phase 1) through the app's own API: the module on,
// a cold room control form whose out-of-limits record opens a nonconformity by itself, and
// nonconformities in every step (open, under analysis with its 5 whys, with actions, one overdue, under
// verification and closed as effective), plus one reported by a member. Used by capturas.ts (its
// *_capturas database) and by a local script on the development database. Idempotent: if its first
// nonconformity is already there, nothing is done.
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";

export type QualityLocale = "es" | "en";

export interface DemoQualityTarget {
  base: string;
  /** The owner's token (turns the module on and manages quality). */
  token: string;
  /** A member's token (reports one nonconformity). */
  memberToken: string;
  slug: string;
  locale: QualityLocale;
  db: pg.Client;
  /** Emails of the people the nonconformities and actions go to. */
  peopleEmails: string[];
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Severity = "MINOR" | "MAJOR" | "CRITICAL";
type Origin = "INTERNAL" | "AUDIT_INTERNAL" | "AUDIT_EXTERNAL" | "COMPLAINT" | "SUPPLIER";
type Kind = "CORRECTION" | "CORRECTIVE" | "PREVENTIVE";

interface Nc {
  title: string;
  description: string;
  origin: Origin;
  severity: Severity;
  detected: number;
  location: string;
  product?: string;
  correction?: string;
  whys?: string[];
  rootCause?: string;
  actions?: { kind: Kind; description: string; due: number; done?: true }[];
  /** «effective» closes it after its check. */
  verify?: { effective: boolean; note: string };
}

interface Texts {
  form: { name: string; temperature: string; room: string; signature: string };
  rooms: string[];
  ncs: Nc[];
  report: { title: string; description: string; location: string };
}

const TEXTS: Record<QualityLocale, Texts> = {
  es: {
    form: {
      name: "Control de temperatura de cámaras",
      temperature: "Temperatura",
      room: "Cámara",
      signature: "Firma",
    },
    rooms: ["Cámara 1 · canales", "Cámara 2 · producto terminado"],
    ncs: [
      {
        title: "Pieza patrón de acero inoxidable no detectada en la línea 3",
        description:
          "En la verificación de las 10:00, el detector de metales de la línea 3 no rechazó la pieza patrón de 2,5 mm de acero inoxidable.",
        origin: "INTERNAL",
        severity: "CRITICAL",
        detected: -1,
        location: "Línea 3 · envasado de loncheados",
        product: "Producción desde la verificación anterior (08:00): lote 24-311, 640 kg retenidos",
        correction: "Línea parada, producto retenido y reinspeccionado en la línea 2.",
      },
      {
        title: "Etiquetas sin el alérgeno mostaza en el chorizo picante",
        description:
          "Un cliente avisó que la etiqueta del chorizo picante 250 g no declara la mostaza, que lleva la mezcla de especias nueva.",
        origin: "COMPLAINT",
        severity: "MAJOR",
        detected: -6,
        location: "Etiquetado · referencia 4021",
        product: "Lotes 24-298 y 24-301 en el almacén de expedición",
        correction:
          "Retirada de los dos lotes del almacén y bloqueo de la referencia en el sistema.",
        whys: [
          "La etiqueta se imprimió con la ficha técnica anterior.",
          "El cambio de proveedor de especias no actualizó la ficha técnica.",
          "La homologación del proveedor nuevo no pasó por calidad.",
        ],
        rootCause:
          "El cambio de proveedor de especias se aprobó en compras sin revisión del APPCC ni de la ficha técnica.",
      },
      {
        title: "Hallazgo de auditoría IFS: registros de limpieza sin firma",
        description:
          "La auditora encontró 6 registros de limpieza de la sala de despiece de octubre sin la firma de quien verifica.",
        origin: "AUDIT_EXTERNAL",
        severity: "MINOR",
        detected: -20,
        location: "Sala de despiece",
        whys: [
          "El encargado de turno no firmaba al verificar.",
          "El registro en papel no deja claro quién verifica.",
        ],
        rootCause: "El registro no tiene un campo de verificación obligatorio.",
        actions: [
          {
            kind: "CORRECTIVE",
            description:
              "Pasar el registro de limpieza a un formulario de la app con firma obligatoria",
            due: 10,
          },
          {
            kind: "CORRECTION",
            description: "Revisar y firmar los registros de octubre pendientes",
            due: -4,
          },
          {
            kind: "PREVENTIVE",
            description: "Formar a los encargados de turno en la verificación de limpieza",
            due: 25,
          },
        ],
      },
      {
        title: "Temperatura del agua de escaldado por debajo de 80 °C",
        description:
          "Durante 40 minutos la temperatura del escaldado quedó entre 74 y 77 °C por una resistencia averiada.",
        origin: "INTERNAL",
        severity: "MAJOR",
        detected: -35,
        location: "Escaldado · línea de sacrificio",
        product: "Canales del turno de mañana reprocesadas",
        whys: [
          "Una resistencia del escaldador se quemó.",
          "No tenía mantenimiento preventivo programado.",
        ],
        rootCause: "El escaldador no estaba en el plan de mantenimiento preventivo.",
        actions: [
          {
            kind: "CORRECTION",
            description: "Cambiar la resistencia averiada",
            due: -30,
            done: true,
          },
          {
            kind: "CORRECTIVE",
            description: "Sumar el escaldador al plan de mantenimiento preventivo trimestral",
            due: -10,
            done: true,
          },
        ],
      },
      {
        title: "Proveedor de tripas sin certificado IFS vigente",
        description:
          "El certificado IFS del proveedor de tripas naturales venció hace 2 meses y nadie lo pidió.",
        origin: "SUPPLIER",
        severity: "MAJOR",
        detected: -70,
        location: "Compras",
        whys: ["Los certificados de proveedores se seguían en una planilla que nadie revisaba."],
        rootCause: "No había aviso de vencimiento de los certificados de proveedores.",
        actions: [
          {
            kind: "CORRECTION",
            description: "Pedir el certificado renovado al proveedor",
            due: -60,
            done: true,
          },
          {
            kind: "PREVENTIVE",
            description: "Cargar los certificados de proveedores con su vencimiento en la app",
            due: -45,
            done: true,
          },
        ],
        verify: {
          effective: true,
          note: "Certificado renovado recibido y todos los certificados de proveedores con aviso de vencimiento.",
        },
      },
    ],
    report: {
      title: "Restos de film plástico en la mesa de despiece",
      description:
        "Al empezar el turno había trozos de film azul sobre la mesa 2, cerca de las canales.",
      location: "Sala de despiece · mesa 2",
    },
  },
  en: {
    form: {
      name: "Cold room temperature check",
      temperature: "Temperature",
      room: "Cold room",
      signature: "Signature",
    },
    rooms: ["Cold room 1 · carcasses", "Cold room 2 · finished product"],
    ncs: [
      {
        title: "Stainless steel test piece not detected on line 3",
        description:
          "At the 10:00 check, line 3's metal detector didn't reject the 2.5 mm stainless steel test piece.",
        origin: "INTERNAL",
        severity: "CRITICAL",
        detected: -1,
        location: "Line 3 · sliced products packing",
        product: "Production since the previous check (08:00): lot 24-311, 640 kg on hold",
        correction: "Line stopped, product held and re-inspected on line 2.",
      },
      {
        title: "Labels missing the mustard allergen on spicy chorizo",
        description:
          "A customer reported that the spicy chorizo 250 g label doesn't declare mustard, which the new spice mix contains.",
        origin: "COMPLAINT",
        severity: "MAJOR",
        detected: -6,
        location: "Labelling · item 4021",
        product: "Lots 24-298 and 24-301 in the dispatch warehouse",
        correction: "Both lots withdrawn from the warehouse and the item blocked in the system.",
        whys: [
          "The label was printed with the previous specification.",
          "The change of spice supplier didn't update the specification.",
          "The new supplier's approval didn't go through quality.",
        ],
        rootCause:
          "The change of spice supplier was approved by purchasing without reviewing the HACCP or the specification.",
      },
      {
        title: "IFS audit finding: cleaning records not signed",
        description:
          "The auditor found 6 October cleaning records of the cutting room without the checker's signature.",
        origin: "AUDIT_EXTERNAL",
        severity: "MINOR",
        detected: -20,
        location: "Cutting room",
        whys: [
          "The shift supervisor didn't sign when checking.",
          "The paper record doesn't make clear who checks.",
        ],
        rootCause: "The record has no mandatory check field.",
        actions: [
          {
            kind: "CORRECTIVE",
            description: "Move the cleaning record to an app form with a mandatory signature",
            due: 10,
          },
          {
            kind: "CORRECTION",
            description: "Review and sign October's pending records",
            due: -4,
          },
          {
            kind: "PREVENTIVE",
            description: "Train shift supervisors on checking the cleaning",
            due: 25,
          },
        ],
      },
      {
        title: "Scalding water temperature below 80 °C",
        description:
          "For 40 minutes the scalding temperature stayed between 74 and 77 °C because of a broken heater.",
        origin: "INTERNAL",
        severity: "MAJOR",
        detected: -35,
        location: "Scalding · slaughter line",
        product: "Morning shift carcasses reprocessed",
        whys: ["One of the scalder's heaters burned out.", "It had no planned maintenance."],
        rootCause: "The scalder wasn't in the preventive maintenance plan.",
        actions: [
          { kind: "CORRECTION", description: "Replace the broken heater", due: -30, done: true },
          {
            kind: "CORRECTIVE",
            description: "Add the scalder to the quarterly preventive maintenance plan",
            due: -10,
            done: true,
          },
        ],
      },
      {
        title: "Casing supplier without a valid IFS certificate",
        description:
          "The natural casing supplier's IFS certificate expired 2 months ago and nobody asked for it.",
        origin: "SUPPLIER",
        severity: "MAJOR",
        detected: -70,
        location: "Purchasing",
        whys: ["Supplier certificates were tracked in a spreadsheet nobody reviewed."],
        rootCause: "There was no expiry notice for supplier certificates.",
        actions: [
          {
            kind: "CORRECTION",
            description: "Ask the supplier for the renewed certificate",
            due: -60,
            done: true,
          },
          {
            kind: "PREVENTIVE",
            description: "Load supplier certificates with their expiry into the app",
            due: -45,
            done: true,
          },
        ],
        verify: {
          effective: true,
          note: "Renewed certificate received and every supplier certificate now has an expiry notice.",
        },
      },
    ],
    report: {
      title: "Plastic film scraps on the cutting table",
      description:
        "At the start of the shift there were bits of blue film on table 2, near the carcasses.",
      location: "Cutting room · table 2",
    },
  },
};

function apiOf(base: string, slug: string, token: string) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${base}/api/v1/w/${slug}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? "20");
        await sleep((Number.isFinite(wait) ? wait : 20) * 1000 + 500);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${path}: ${String(res.status)} ${await res.text()}`);
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
    throw new Error(`${method} ${path}: too many retries`);
  };
}

interface NcView {
  id: string;
  code: string;
  status: string;
  actionItems: { id: string }[];
}

export async function demoQuality(target: DemoQualityTarget): Promise<Record<string, number>> {
  const call = apiOf(target.base, target.slug, target.token);
  const asMember = apiOf(target.base, target.slug, target.memberToken);
  const t = TEXTS[target.locale];
  const counts: Record<string, number> = {};
  const first = t.ncs[0];
  const { rows: existing } = await target.db.query<{ id: string }>(
    `SELECT n.id FROM "QualityNc" n JOIN "Workspace" w ON w.id = n."workspaceId"
      WHERE w.slug = $1 AND n.title = $2 LIMIT 1`,
    [target.slug, first?.title ?? ""],
  );
  if (existing.length > 0) return await demoHaccp(target, counts);

  const { quality } = await call<{ quality: { space: { id: string } | null } }>(
    "PUT",
    "/admin/quality",
    { enabled: true, standards: ["IFS8", "BRCGS9"] },
  );
  if (quality.space === null) throw new Error("The quality module has no space");
  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const people = target.peopleEmails
    .map((email) => members.items.find((item) => item.email === email)?.id)
    .filter((id): id is string => id !== undefined);
  const [owner, other] = people;
  if (owner === undefined) throw new Error("No people for the quality demo");
  const responsible = other ?? owner;

  // The cold room control: above 4 °C it opens a nonconformity by itself.
  const { form } = await call<{ form: { node: { id: string } } }>(
    "POST",
    `/spaces/${quality.space.id}/forms`,
    { name: t.form.name, parentId: null },
  );
  await call("PUT", `/forms/${form.node.id}/template`, {
    baseVersion: 1,
    fields: [
      {
        id: "camara",
        type: "choice",
        label: t.form.room,
        required: true,
        options: t.rooms.map((label, index) => ({ id: `c${String(index + 1)}`, label })),
        nonConforming: [],
      },
      {
        id: "temp",
        type: "number",
        label: t.form.temperature,
        unit: "°C",
        required: true,
        min: 0,
        max: 4,
      },
      { id: "firma", type: "signature", label: t.form.signature, required: false },
    ],
  });
  await call("PUT", `/quality/forms/${form.node.id}`, {
    autoNc: true,
    severity: "MAJOR",
    ownerId: owner,
  });
  const detail = await call<{ form: { template: { version: number } } }>(
    "GET",
    `/forms/${form.node.id}`,
  );
  for (const [room, temperature] of [
    ["c1", 2.1],
    ["c2", 6.4],
  ] as const) {
    await call("POST", `/forms/${form.node.id}/records`, {
      version: detail.form.template.version,
      answers: { camara: room, temp: temperature },
      source: "app",
    });
    counts.records = (counts.records ?? 0) + 1;
  }

  for (const nc of t.ncs) {
    const created = await call<{ nc: NcView }>("POST", "/quality/ncs", {
      title: nc.title,
      description: nc.description,
      origin: nc.origin,
      severity: nc.severity,
      detectedOn: day(nc.detected),
      location: nc.location,
      productAffected: nc.product !== undefined,
      productNote: nc.product ?? null,
      correction: nc.correction ?? null,
      ownerId: owner,
      departmentId: null,
    });
    counts.ncs = (counts.ncs ?? 0) + 1;
    const id = created.nc.id;
    if (nc.whys !== undefined) {
      await call("PATCH", `/quality/ncs/${id}`, {
        causeMethod: "FIVE_WHYS",
        causeAnalysis: { whys: nc.whys },
        rootCause: nc.rootCause ?? null,
      });
    }
    for (const action of nc.actions ?? []) {
      const { nc: after } = await call<{ nc: NcView }>("POST", `/quality/ncs/${id}/actions`, {
        kind: action.kind,
        description: action.description,
        responsibleId: action.kind === "CORRECTION" ? owner : responsible,
        dueOn: day(action.due),
      });
      counts.actions = (counts.actions ?? 0) + 1;
      if (action.done === true) {
        const last = after.actionItems.at(-1);
        if (last !== undefined) await call("POST", `/quality/actions/${last.id}/done`, {});
      }
    }
    if (nc.verify !== undefined) {
      await call("POST", `/quality/ncs/${id}/verifications`, nc.verify);
      counts.closed = (counts.closed ?? 0) + 1;
    }
  }

  await asMember("POST", "/quality/ncs/report", {
    title: t.report.title,
    description: t.report.description,
    detectedOn: day(0),
    location: t.report.location,
    productAffected: false,
    productNote: null,
    correction: null,
  });
  counts.reported = 1;
  return await demoHaccp(target, counts);
}

const HACCP: Record<
  QualityLocale,
  {
    plan: { name: string; text: string };
    product: string;
    reworkProduct: string;
    reason: string;
    reworkReason: string;
    released: string;
  }
> = {
  es: {
    plan: {
      name: "Plan APPCC · Embutidos curados y cocidos",
      text: "Diagrama de flujo, análisis de peligros y cuadro de gestión de los puntos de control crítico de la planta.",
    },
    product: "Loncheado de jamón cocido 100 g",
    reworkProduct: "Chorizo picante 250 g",
    reason: "Producido desde la última verificación correcta del detector de metales.",
    reworkReason: "Etiqueta sin el alérgeno mostaza.",
    released: "Reetiquetado con la ficha técnica vigente y revisado por calidad.",
  },
  en: {
    plan: {
      name: "HACCP plan · Cured and cooked sausages",
      text: "Flow diagram, hazard analysis and the plant's critical control points table.",
    },
    product: "Sliced cooked ham 100 g",
    reworkProduct: "Spicy chorizo 250 g",
    reason: "Made since the metal detector's last correct check.",
    reworkReason: "Label missing the mustard allergen.",
    released: "Relabelled with the current specification and checked by quality.",
  },
};

/** A PNG-looking signature for the demo decision (the app only stores it). */
function demoSignature(): string {
  const bytes = new Uint8Array(320);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let index = 8; index < bytes.length; index++) bytes[index] = (index * 37) % 251;
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/**
 * Phase 2 (docs/spec/calidad.md, «Fase 2»): the HACCP plan as a controlled document, the meat template
 * (forms and CCPs), records in and out of limits (out of limits open their nonconformity by themselves)
 * and product on hold, one decided. Idempotent: if the company has CCPs, nothing is done.
 */
async function demoHaccp(
  target: DemoQualityTarget,
  counts: Record<string, number>,
): Promise<Record<string, number>> {
  const call = apiOf(target.base, target.slug, target.token);
  const t = HACCP[target.locale];
  const { rows } = await target.db.query<{ id: string }>(
    `SELECT c.id FROM "QualityCcp" c JOIN "Workspace" w ON w.id = c."workspaceId" WHERE w.slug = $1 LIMIT 1`,
    [target.slug],
  );
  if (rows.length > 0) return await demoAudits(target, counts);
  const { quality } = await call<{ quality: { space: { id: string } | null } }>(
    "GET",
    "/admin/quality",
  );
  if (quality.space === null) throw new Error("The quality module has no space");
  const loaded = await call<{ forms: number; ccps: number }>("POST", "/admin/quality/template");
  counts.templateForms = loaded.forms;
  counts.ccps = loaded.ccps;
  // The plan itself, as a controlled document of type APPCC.
  const { page } = await call<{ page: { node: { id: string } } }>(
    "POST",
    `/spaces/${quality.space.id}/pages`,
    {
      name: t.plan.name,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: t.plan.text }] }],
      },
    },
  );
  await call("POST", `/nodes/${page.node.id}/controlled`, { docType: "APPCC" });
  const haccp = await call<{ ccps: { code: string; form: { id: string } | null }[] }>(
    "GET",
    "/quality/haccp",
  );
  const formOf = (code: string) => haccp.ccps.find((ccp) => ccp.code === code)?.form?.id;
  const submit = async (code: string, answers: Record<string, unknown>) => {
    const formId = formOf(code);
    if (formId === undefined) return;
    const { form } = await call<{ form: { template: { version: number } } }>(
      "GET",
      `/forms/${formId}`,
    );
    await call("POST", `/forms/${formId}/records`, {
      version: form.template.version,
      answers,
      source: "app",
    });
    counts.haccpRecords = (counts.haccpRecords ?? 0) + 1;
  };
  for (const temperature of [2.4, 3.1, 1.8, 3.6])
    await submit("PCC-2", { camara: "o1", temp: temperature });
  await submit("PCC-2", { camara: "o2", temp: 5.7 });
  await submit("PCC-4", { producto: t.product, lote: "24-315", centro: 74.2 });
  await submit("PCC-4", { producto: t.product, lote: "24-316", centro: 73.5 });
  await submit("PCC-6", { linea: "o3", piezas: ["fe", "nofe", "inox"] });
  await submit("PCC-6", { linea: "o3", piezas: ["fe", "nofe"] });
  // Product on hold: the metal detector's (by itself, CRITICAL) still on hold; a label one, released.
  const { rows: metal } = await target.db.query<{ id: string }>(
    `SELECT n.id FROM "QualityNc" n JOIN "Workspace" w ON w.id = n."workspaceId"
      WHERE w.slug = $1 AND n.origin = 'CCP' AND n.severity = 'CRITICAL' ORDER BY n.number DESC LIMIT 1`,
    [target.slug],
  );
  await call("POST", "/quality/holds", {
    ncId: metal[0]?.id ?? null,
    product: t.product,
    lot: "24-316",
    quantity: "640 kg",
    location: target.locale === "es" ? "Cámara 2" : "Cold room 2",
    reason: t.reason,
  });
  const { hold } = await call<{ hold: { id: string } }>("POST", "/quality/holds", {
    ncId: null,
    product: t.reworkProduct,
    lot: "24-298",
    quantity: "1.200 u",
    location: target.locale === "es" ? "Almacén de expedición" : "Dispatch warehouse",
    reason: t.reworkReason,
  });
  await call("POST", `/quality/holds/${hold.id}/decision`, {
    status: "REWORKED",
    note: t.released,
    signature: demoSignature(),
  });
  counts.holds = 2;
  return await demoAudits(target, counts);
}

interface DemoAudit {
  scheme: "INTERNAL" | "IFS8" | "OFFICIAL";
  title: string;
  planned: string;
  done?: { on: string; result?: string };
  auditor: string;
  chapters?: string[];
  findings?: { clause: string; description: string; severity: "MINOR" | "MAJOR" | "CRITICAL" }[];
}

const AUDITS: Record<QualityLocale, DemoAudit[]> = {
  es: [
    {
      scheme: "INTERNAL",
      title: "Auditoría interna · Dirección, sistema y recursos",
      planned: "02-12",
      done: { on: "02-13" },
      auditor: "Equipo de calidad",
      chapters: ["IFS8:1", "IFS8:2", "IFS8:3", "BRCGS9:1", "BRCGS9:3", "BRCGS9:7"],
    },
    {
      scheme: "INTERNAL",
      title: "Auditoría interna · APPCC y procesos",
      planned: "05-20",
      done: { on: "05-21", result: "2 hallazgos" },
      auditor: "Equipo de calidad",
      chapters: ["IFS8:4", "BRCGS9:2", "BRCGS9:4", "BRCGS9:5", "BRCGS9:6"],
      findings: [
        {
          clause: "4.9.6",
          description:
            "La verificación de las piezas patrón de la línea 2 no se registró dos turnos seguidos.",
          severity: "MAJOR",
        },
        {
          clause: "4.11.2",
          description:
            "Hay un bidón de producto de limpieza sin etiqueta en el almacén de químicos.",
          severity: "MINOR",
        },
      ],
    },
    {
      scheme: "IFS8",
      title: "Auditoría de certificación IFS Food 8",
      planned: "09-16",
      done: { on: "09-17", result: "Nivel superior, 96,3 %" },
      auditor: "Entidad de certificación",
      findings: [
        {
          clause: "5.4.2",
          description:
            "Las tendencias de los análisis microbiológicos no se revisan con la frecuencia del plan.",
          severity: "MINOR",
        },
        {
          clause: "4.3.1",
          description:
            "La etiqueta del chorizo picante no declara la mostaza de la mezcla de especias nueva.",
          severity: "MAJOR",
        },
      ],
    },
    {
      scheme: "INTERNAL",
      title: "Auditoría interna · Mejora, food defense y producto comercializado",
      planned: "12-02",
      auditor: "Equipo de calidad",
      chapters: ["IFS8:5", "IFS8:6", "BRCGS9:8", "BRCGS9:9"],
    },
    {
      scheme: "OFFICIAL",
      title: "Inspección sanitaria anual",
      planned: "12-10",
      auditor: "Servicio de salud pública",
    },
  ],
  en: [
    {
      scheme: "INTERNAL",
      title: "Internal audit · Management, system and resources",
      planned: "02-12",
      done: { on: "02-13" },
      auditor: "Quality team",
      chapters: ["IFS8:1", "IFS8:2", "IFS8:3", "BRCGS9:1", "BRCGS9:3", "BRCGS9:7"],
    },
    {
      scheme: "INTERNAL",
      title: "Internal audit · HACCP and processes",
      planned: "05-20",
      done: { on: "05-21", result: "2 findings" },
      auditor: "Quality team",
      chapters: ["IFS8:4", "BRCGS9:2", "BRCGS9:4", "BRCGS9:5", "BRCGS9:6"],
      findings: [
        {
          clause: "4.9.6",
          description: "Line 2's test piece check wasn't recorded for two shifts in a row.",
          severity: "MAJOR",
        },
        {
          clause: "4.11.2",
          description: "There's an unlabelled drum of cleaning product in the chemicals store.",
          severity: "MINOR",
        },
      ],
    },
    {
      scheme: "IFS8",
      title: "IFS Food 8 certification audit",
      planned: "09-16",
      done: { on: "09-17", result: "Higher level, 96.3 %" },
      auditor: "Certification body",
      findings: [
        {
          clause: "5.4.2",
          description: "Microbiological trends aren't reviewed as often as the plan says.",
          severity: "MINOR",
        },
        {
          clause: "4.3.1",
          description: "The spicy chorizo label doesn't declare the mustard in the new spice mix.",
          severity: "MAJOR",
        },
      ],
    },
    {
      scheme: "INTERNAL",
      title: "Internal audit · Improvement, food defence and traded products",
      planned: "12-02",
      auditor: "Quality team",
      chapters: ["IFS8:5", "IFS8:6", "BRCGS9:8", "BRCGS9:9"],
    },
    {
      scheme: "OFFICIAL",
      title: "Yearly health inspection",
      planned: "12-10",
      auditor: "Public health service",
    },
  ],
};

/**
 * Phase 3 (docs/spec/calidad.md, «Fase 3»): the year's audit programme, with findings that open their
 * nonconformity. Idempotent: if the company has audits, nothing is done.
 */
export async function demoAudits(
  target: DemoQualityTarget,
  counts: Record<string, number>,
): Promise<Record<string, number>> {
  const call = apiOf(target.base, target.slug, target.token);
  const { rows } = await target.db.query<{ id: string }>(
    `SELECT a.id FROM "QualityAudit" a JOIN "Workspace" w ON w.id = a."workspaceId" WHERE w.slug = $1 LIMIT 1`,
    [target.slug],
  );
  if (rows.length > 0) return await demoSuppliers(target, counts);
  const year = new Date().getFullYear();
  for (const audit of AUDITS[target.locale]) {
    const { audit: created } = await call<{ audit: { id: string } }>("POST", "/quality/audits", {
      scheme: audit.scheme,
      title: audit.title,
      plannedOn: `${String(year)}-${audit.planned}`,
      auditor: audit.auditor,
      chapters: audit.chapters ?? [],
    });
    counts.audits = (counts.audits ?? 0) + 1;
    if (audit.done !== undefined) {
      await call("POST", `/quality/audits/${created.id}/done`, {
        doneOn: `${String(year)}-${audit.done.on}`,
        result: audit.done.result ?? null,
      });
    }
    for (const finding of audit.findings ?? []) {
      await call("POST", `/quality/audits/${created.id}/findings`, {
        ...finding,
        openNc: finding.severity !== "MINOR" || audit.scheme !== "INTERNAL",
      });
      counts.findings = (counts.findings ?? 0) + 1;
    }
  }
  return await demoSuppliers(target, counts);
}

interface DemoSupplier {
  name: string;
  category: "RAW_MATERIAL" | "INGREDIENT" | "PACKAGING" | "SERVICE";
  supplies: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  fraudRisk: "LOW" | "MEDIUM" | "HIGH";
  fraudNote?: string;
  docs: { kind: string; name: string; days: number | null }[];
  review?: { result: "APPROVED" | "CONDITIONAL" | "BLOCKED"; months: number; note: string };
  nc?: { title: string; description: string };
}

const SUPPLIERS: Record<QualityLocale, DemoSupplier[]> = {
  es: [
    {
      name: "Cárnicas del Valle S.A.",
      category: "RAW_MATERIAL",
      supplies: "Canal y piezas de cerdo de capa blanca",
      risk: "HIGH",
      fraudRisk: "MEDIUM",
      fraudNote: "Especie y origen verificados por analítica de ADN cada semestre.",
      docs: [
        { kind: "CERT_IFS", name: "Certificado IFS Food 8", days: 210 },
        { kind: "SPEC_SHEET", name: "Ficha técnica · pieza de jamón", days: null },
      ],
      review: {
        result: "APPROVED",
        months: -3,
        note: "Sin incidencias; temperatura de recepción correcta.",
      },
    },
    {
      name: "Especias Mediterráneas S.L.",
      category: "INGREDIENT",
      supplies: "Pimentón, ajo y mezclas de especias (contienen mostaza)",
      risk: "HIGH",
      fraudRisk: "HIGH",
      fraudNote: "Pimentón: riesgo de adulteración con colorantes; analítica por lote.",
      docs: [
        { kind: "CERT_BRCGS", name: "Certificado BRCGS Food Safety 9", days: 18 },
        { kind: "ANALYSIS", name: "Analítica de colorantes Sudán", days: 60 },
      ],
      review: {
        result: "CONDITIONAL",
        months: -2,
        note: "Mezcla nueva sin ficha técnica actualizada.",
      },
      nc: {
        title: "Mezcla de especias sin la mostaza en la ficha técnica",
        description: "La ficha técnica de la mezcla nueva no declara la mostaza que contiene.",
      },
    },
    {
      name: "Tripas Naturales del Norte S.L.",
      category: "RAW_MATERIAL",
      supplies: "Tripa natural de cerdo y vacuno",
      risk: "HIGH",
      fraudRisk: "LOW",
      docs: [{ kind: "CERT_IFS", name: "Certificado IFS Food 8", days: -12 }],
      review: {
        result: "APPROVED",
        months: -13,
        note: "Homologado tras la auditoría de proveedor.",
      },
    },
    {
      name: "Envases Plásticos Ibéricos S.A.",
      category: "PACKAGING",
      supplies: "Bandejas y film para loncheados",
      risk: "LOW",
      fraudRisk: "LOW",
      docs: [
        { kind: "SPEC_SHEET", name: "Declaración de conformidad (Reglamento 10/2011)", days: 400 },
      ],
      review: { result: "APPROVED", months: -6, note: "Documentación completa." },
    },
    {
      name: "Plagas Control Sur S.L.",
      category: "SERVICE",
      supplies: "Control de plagas y mapa de cebos",
      risk: "MEDIUM",
      fraudRisk: "LOW",
      docs: [{ kind: "CERT_OTHER", name: "Inscripción en el ROESB", days: 300 }],
    },
  ],
  en: [
    {
      name: "Valley Meats Ltd",
      category: "RAW_MATERIAL",
      supplies: "White pig carcasses and cuts",
      risk: "HIGH",
      fraudRisk: "MEDIUM",
      fraudNote: "Species and origin checked by DNA analysis every six months.",
      docs: [
        { kind: "CERT_IFS", name: "IFS Food 8 certificate", days: 210 },
        { kind: "SPEC_SHEET", name: "Technical sheet · ham cut", days: null },
      ],
      review: {
        result: "APPROVED",
        months: -3,
        note: "No incidents; correct reception temperature.",
      },
    },
    {
      name: "Mediterranean Spices Ltd",
      category: "INGREDIENT",
      supplies: "Paprika, garlic and spice mixes (contain mustard)",
      risk: "HIGH",
      fraudRisk: "HIGH",
      fraudNote: "Paprika: risk of adulteration with dyes; analysis per lot.",
      docs: [
        { kind: "CERT_BRCGS", name: "BRCGS Food Safety 9 certificate", days: 18 },
        { kind: "ANALYSIS", name: "Sudan dyes analysis", days: 60 },
      ],
      review: {
        result: "CONDITIONAL",
        months: -2,
        note: "New mix without an updated technical sheet.",
      },
      nc: {
        title: "Spice mix without mustard in the technical sheet",
        description: "The new mix's technical sheet doesn't declare the mustard it contains.",
      },
    },
    {
      name: "Northern Natural Casings Ltd",
      category: "RAW_MATERIAL",
      supplies: "Natural pork and beef casings",
      risk: "HIGH",
      fraudRisk: "LOW",
      docs: [{ kind: "CERT_IFS", name: "IFS Food 8 certificate", days: -12 }],
      review: { result: "APPROVED", months: -13, note: "Approved after the supplier audit." },
    },
    {
      name: "Iberian Plastic Packaging Ltd",
      category: "PACKAGING",
      supplies: "Trays and film for sliced products",
      risk: "LOW",
      fraudRisk: "LOW",
      docs: [
        { kind: "SPEC_SHEET", name: "Declaration of compliance (Regulation 10/2011)", days: 400 },
      ],
      review: { result: "APPROVED", months: -6, note: "Complete documents." },
    },
    {
      name: "South Pest Control Ltd",
      category: "SERVICE",
      supplies: "Pest control and bait map",
      risk: "MEDIUM",
      fraudRisk: "LOW",
      docs: [{ kind: "CERT_OTHER", name: "Biocide services registration", days: 300 }],
    },
  ],
};

/**
 * Phase 4 (docs/spec/calidad.md, «Fase 4»): suppliers in every state, with certificates valid, due soon
 * and expired, their reviews and a nonconformity. Idempotent: if the company has suppliers, nothing.
 */
export async function demoSuppliers(
  target: DemoQualityTarget,
  counts: Record<string, number>,
): Promise<Record<string, number>> {
  const call = apiOf(target.base, target.slug, target.token);
  const { rows } = await target.db.query<{ id: string }>(
    `SELECT s.id FROM "QualitySupplier" s JOIN "Workspace" w ON w.id = s."workspaceId" WHERE w.slug = $1 LIMIT 1`,
    [target.slug],
  );
  if (rows.length > 0) return await demoComplaints(target, counts);
  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const ownerId = members.items.find((item) => item.email === target.peopleEmails[0])?.id ?? null;
  const monthsFrom = (months: number) => {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().slice(0, 10);
  };
  for (const supplier of SUPPLIERS[target.locale]) {
    const { supplier: created } = await call<{ supplier: { id: string } }>(
      "POST",
      "/quality/suppliers",
      {
        name: supplier.name,
        category: supplier.category,
        supplies: supplier.supplies,
        risk: supplier.risk,
        fraudRisk: supplier.fraudRisk,
        fraudNote: supplier.fraudNote ?? null,
        ownerId,
      },
    );
    counts.suppliers = (counts.suppliers ?? 0) + 1;
    for (const doc of supplier.docs) {
      await call("POST", `/quality/suppliers/${created.id}/docs`, {
        kind: doc.kind,
        name: doc.name,
        nodeId: null,
        validUntil: doc.days === null ? null : day(doc.days),
      });
    }
    if (supplier.review !== undefined) {
      await call("POST", `/quality/suppliers/${created.id}/reviews`, {
        reviewedOn: monthsFrom(supplier.review.months),
        scores: {
          quality: 4,
          service: 4,
          documents: supplier.review.result === "CONDITIONAL" ? 2 : 4,
          incidents: 4,
        },
        result: supplier.review.result,
        note: supplier.review.note,
      });
    }
    if (supplier.nc !== undefined && ownerId !== null) {
      await call("POST", "/quality/ncs", {
        title: supplier.nc.title,
        description: supplier.nc.description,
        detectedOn: day(-8),
        origin: "SUPPLIER",
        severity: "MAJOR",
        ownerId,
        departmentId: null,
        supplierId: created.id,
      });
    }
  }
  return await demoComplaints(target, counts);
}

interface DemoComplaint {
  source: "CUSTOMER" | "CONSUMER" | "AUTHORITY";
  from: string;
  contact?: string;
  product: string;
  lot: string;
  category: "FOREIGN_BODY" | "ALLERGEN" | "MICROBIOLOGICAL" | "QUALITY" | "LABELLING" | "PACKAGING";
  description: string;
  received: number;
  answer?: { text: string; justified: boolean; after: number };
  nc?: "MINOR" | "MAJOR" | "CRITICAL";
  close?: true;
}

const COMPLAINTS: Record<
  QualityLocale,
  {
    items: DemoComplaint[];
    team: { email: number; role: string }[];
    contacts: { kind: string; name: string; organization: string; phone: string; email?: string }[];
    test: { product: string; lot: string; result: string };
  }
> = {
  es: {
    items: [
      {
        source: "CONSUMER",
        from: "Ana Gómez",
        contact: "600 123 456",
        product: "Chorizo picante 250 g",
        lot: "24-298",
        category: "FOREIGN_BODY",
        description: "Encontró un trozo de plástico duro azul al cortar el chorizo.",
        received: -3,
        nc: "MAJOR",
      },
      {
        source: "CUSTOMER",
        from: "Supermercados Norte",
        product: "Loncheado de jamón cocido 100 g",
        lot: "24-301",
        category: "PACKAGING",
        description: "Doce bandejas con el sellado abierto en la última entrega.",
        received: -9,
        answer: {
          text: "Reponemos las bandejas y revisamos la termoselladora de la línea 3.",
          justified: true,
          after: 2,
        },
        nc: "MINOR",
      },
      {
        source: "CUSTOMER",
        from: "Distribuciones Levante",
        product: "Salchichón extra",
        lot: "24-260",
        category: "QUALITY",
        description: "El cliente percibe el producto más salado que de costumbre.",
        received: -20,
        answer: {
          text: "Los análisis de sal del lote están dentro de especificación.",
          justified: false,
          after: 4,
        },
        close: true,
      },
      {
        source: "AUTHORITY",
        from: "Servicio de salud pública",
        product: "Chorizo picante 250 g",
        lot: "24-298",
        category: "ALLERGEN",
        description: "Consulta por una alerta de alérgeno no declarado (mostaza).",
        received: -14,
      },
    ],
    team: [
      { email: 0, role: "Coordinación de la crisis" },
      { email: 1, role: "Calidad y trazabilidad" },
    ],
    contacts: [
      {
        kind: "AUTHORITY",
        name: "Guardia de alertas alimentarias",
        organization: "Servicio de salud pública",
        phone: "900 000 112",
      },
      {
        kind: "INSURER",
        name: "Siniestros de responsabilidad civil",
        organization: "Aseguradora",
        phone: "900 000 200",
      },
      {
        kind: "LAB",
        name: "Laboratorio Agroalimentario",
        organization: "Laboratorio acreditado ENAC",
        phone: "900 000 300",
        email: "urgencias@laboratorio.example",
      },
      {
        kind: "CUSTOMER",
        name: "Calidad de Supermercados Norte",
        organization: "Supermercados Norte",
        phone: "900 000 400",
      },
    ],
    test: {
      product: "Loncheado de jamón cocido 100 g",
      lot: "24-070",
      result: "Trazabilidad completa en los dos sentidos: 3 proveedores y 14 clientes localizados.",
    },
  },
  en: {
    items: [
      {
        source: "CONSUMER",
        from: "Ann Green",
        contact: "07700 900123",
        product: "Spicy chorizo 250 g",
        lot: "24-298",
        category: "FOREIGN_BODY",
        description: "Found a piece of hard blue plastic when cutting the chorizo.",
        received: -3,
        nc: "MAJOR",
      },
      {
        source: "CUSTOMER",
        from: "North Supermarkets",
        product: "Sliced cooked ham 100 g",
        lot: "24-301",
        category: "PACKAGING",
        description: "Twelve trays with an open seal in the last delivery.",
        received: -9,
        answer: {
          text: "We're replacing the trays and checking line 3's heat sealer.",
          justified: true,
          after: 2,
        },
        nc: "MINOR",
      },
      {
        source: "CUSTOMER",
        from: "East Distribution",
        product: "Extra salami",
        lot: "24-260",
        category: "QUALITY",
        description: "The customer finds the product saltier than usual.",
        received: -20,
        answer: {
          text: "The lot's salt analyses are within specification.",
          justified: false,
          after: 4,
        },
        close: true,
      },
      {
        source: "AUTHORITY",
        from: "Public health service",
        product: "Spicy chorizo 250 g",
        lot: "24-298",
        category: "ALLERGEN",
        description: "Query about an alert for an undeclared allergen (mustard).",
        received: -14,
      },
    ],
    team: [
      { email: 0, role: "Crisis coordination" },
      { email: 1, role: "Quality and traceability" },
    ],
    contacts: [
      {
        kind: "AUTHORITY",
        name: "Food alerts on call",
        organization: "Public health service",
        phone: "0800 000 112",
      },
      { kind: "INSURER", name: "Liability claims", organization: "Insurer", phone: "0800 000 200" },
      {
        kind: "LAB",
        name: "Food Laboratory",
        organization: "UKAS accredited lab",
        phone: "0800 000 300",
        email: "urgent@laboratory.example",
      },
      {
        kind: "CUSTOMER",
        name: "North Supermarkets quality",
        organization: "North Supermarkets",
        phone: "0800 000 400",
      },
    ],
    test: {
      product: "Sliced cooked ham 100 g",
      lot: "24-070",
      result: "Full traceability both ways: 3 suppliers and 14 customers found.",
    },
  },
};

/**
 * Phase 5 (docs/spec/calidad.md, «Fase 5»): complaints in every state (one with its NC), the units sold
 * of the year's months, the crisis team and contacts, and a recall test. Idempotent: if the company has
 * complaints, nothing is done.
 */
export async function demoComplaints(
  target: DemoQualityTarget,
  counts: Record<string, number>,
): Promise<Record<string, number>> {
  const call = apiOf(target.base, target.slug, target.token);
  const { rows } = await target.db.query<{ id: string }>(
    `SELECT c.id FROM "QualityComplaint" c JOIN "Workspace" w ON w.id = c."workspaceId" WHERE w.slug = $1 LIMIT 1`,
    [target.slug],
  );
  if (rows.length > 0) return counts;
  const t = COMPLAINTS[target.locale];
  for (const item of t.items) {
    const { complaint } = await call<{ complaint: { id: string } }>("POST", "/quality/complaints", {
      source: item.source,
      from: item.from,
      contact: item.contact ?? null,
      product: item.product,
      lot: item.lot,
      category: item.category,
      description: item.description,
      receivedOn: day(item.received),
      ownerId: null,
    });
    counts.complaints = (counts.complaints ?? 0) + 1;
    if (item.nc !== undefined) {
      await call("POST", `/quality/complaints/${complaint.id}/nc`, { severity: item.nc });
    }
    if (item.answer !== undefined) {
      await call("POST", `/quality/complaints/${complaint.id}/answer`, {
        response: item.answer.text,
        justified: item.answer.justified,
        respondedOn: day(item.received + item.answer.after),
      });
    }
    if (item.close === true) await call("POST", `/quality/complaints/${complaint.id}/close`);
  }
  // Units sold up to this month: some 240 000 a month.
  const now = new Date();
  for (let month = 1; month <= now.getUTCMonth() + 1; month++) {
    await call("PUT", "/quality/units", {
      month: `${String(now.getUTCFullYear())}-${String(month).padStart(2, "0")}-01`,
      units: 220_000 + ((month * 7919) % 40_000),
    });
  }
  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  for (const member of t.team) {
    const id = members.items.find((item) => item.email === target.peopleEmails[member.email])?.id;
    if (id !== undefined) {
      await call("POST", "/quality/crisis/members", { membershipId: id, role: member.role });
    }
  }
  for (const contact of t.contacts) {
    await call("POST", "/quality/crisis/contacts", { ...contact, email: contact.email ?? null });
  }
  await call("POST", "/quality/recall-tests", {
    kind: "DRILL",
    date: day(-240),
    product: t.test.product,
    lot: t.test.lot,
    direction: "BOTH",
    minutes: 95,
    recoveredPercent: 100,
    result: t.test.result,
  });
  return counts;
}
