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
  if (existing.length > 0) return counts;

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
  return counts;
}
