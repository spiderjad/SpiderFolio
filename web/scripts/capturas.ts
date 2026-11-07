// Capturas reales de la app para la web y la documentación, con las empresas demo del seed (datos
// inventados), en español e inglés y en tema claro y oscuro. Guarda WebP en
// web/public/capturas/<idioma>/<nombre>-<tema>.webp (la lista: CAPTURES, abajo).
//
//   1. Una base aparte con el seed:  createdb spiderfolio_capturas
//      DATABASE_URL=…/spiderfolio_capturas npx prisma migrate deploy   (en backend/)
//      DATABASE_URL=…/spiderfolio_capturas SEED_DEMO_PASSWORD=… node prisma/seed.ts
//   2. La app compilada:  npm run build -w @spiderfolio/frontend
//   3. node web/scripts/capturas.ts   (CAPTURAS_DATABASE_URL y SEED_DEMO_PASSWORD en el entorno)
//
// Levanta la API (que sirve la app) en un puerto propio con esa base y la apaga al terminar. Nunca
// apunta a la base de desarrollo: se niega si CAPTURAS_DATABASE_URL no termina en _capturas.
//
// Plugin screens (plugin-*, and licencia with its plugins): the plugins built in the plugins
// repository (node tools/build-plugin.ts <id>) and, for the paid ones, a license per demo company
// signed with the production key (the core accepts no other):
//   CAPTURAS_PLUGINS_DIR=<plugins repo>/dist  CAPTURAS_LICENCIAS=<file, one SFL1 token per line>
// The assistant's capture reads a real certificate: the plugins repo's Samba AD test image listening
// on 127.0.0.1:636 (docker run -d -p 127.0.0.1:636:636 spiderfolio-plugins-samba-ad).
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import {
  fromMenu,
  idsOf,
  LABELS,
  PEOPLE,
  root,
  signIn,
  startServer,
  waitUntilReady,
  type Ids,
  type Locale,
  type Who,
} from "./demo-app.ts";
import { BIAN_TEXT, BIAN_USAGE, bianRecording, fakeBian, fakeBianUsage } from "./bian-recording.ts";
import { demoCae, demoCaeNames } from "./demo-cae.ts";
import { demoCommittee } from "./demo-committee.ts";
import { demoEmergencies } from "./demo-emergencies.ts";
import { demoIndicators } from "./demo-indicators.ts";
import { demoPlanning } from "./demo-planning.ts";
const out = join(root, "web", "public", "capturas");
const PORT = 4100;
const BASE = `http://localhost:${String(PORT)}`;
const databaseUrl = process.env.CAPTURAS_DATABASE_URL ?? "";
const password = process.env.SEED_DEMO_PASSWORD ?? "";
if (!/_capturas(\?|$)/u.test(databaseUrl)) {
  throw new Error(
    "CAPTURAS_DATABASE_URL tiene que apuntar a una base *_capturas (nunca a la de desarrollo)",
  );
}
if (password === "") throw new Error("Falta SEED_DEMO_PASSWORD (la misma del seed)");
const pluginsDir = process.env.CAPTURAS_PLUGINS_DIR;
const licenses = (
  process.env.CAPTURAS_LICENCIAS === undefined
    ? ""
    : readFileSync(process.env.CAPTURAS_LICENCIAS, "utf8")
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("SFL1."));

type Theme = "light" | "dark";

interface Capture {
  name: string;
  who: Who;
  path: (ids: Ids, locale: Locale) => string;
  /** Algo que tiene que verse antes de capturar. */
  ready?: string;
  /** Acción extra antes de capturar (abrir un diálogo…). */
  then?: (page: Page, locale: Locale) => Promise<void>;
  /** Bian available, answering with the recording shared with the clip (bian-recording.ts). */
  bian?: true;
  /** With the paid plugins' license loaded (true) or without it (false); undefined: either. */
  license?: boolean;
  /** Where the screen lives, if it's outside the app (the consent screen). */
  prefix?: string;
  /** Another window size (a phone at the gatehouse); 1440 × 900 otherwise. */
  viewport?: { width: number; height: number };
  /** Data the screen needs, set right before it (only in this database). */
  before?: (input: {
    workspaceId: string;
    slug: string;
    locale: Locale;
    ids: Ids;
  }) => Promise<void>;
}

/** The license read is remembered 30 s by the API (LICENSE_CACHE_MS): wait it out after a change. */
const LICENSE_CACHE_WAIT_MS = 31_000;

/** The demo company's license from CAPTURAS_LICENCIAS (the token naming its id), or none. */
function licenseFor(workspaceId: string): string | null {
  return (
    licenses.find((token) => {
      const payload = token.split(".")[1] ?? "";
      const json = Buffer.from(payload, "base64url").toString("utf8");
      return (JSON.parse(json) as { workspaceId?: string }).workspaceId === workspaceId;
    }) ?? null
  );
}

/** Owner tokens already issued: reused for a few minutes so the demos don't hit the login limit. */
const ownerTokens = new Map<Locale, { token: string; at: number }>();
const OWNER_TOKEN_REUSE_MS = 5 * 60_000;

/** An owner's API session (the demo owners have no 2FA), to set a plugin up like the screen does. */
async function ownerToken(locale: Locale): Promise<string> {
  const cached = ownerTokens.get(locale);
  if (cached !== undefined && Date.now() - cached.at < OWNER_TOKEN_REUSE_MS) return cached.token;
  const token = await freshOwnerToken(locale);
  ownerTokens.set(locale, { token, at: Date.now() });
  return token;
}

async function freshOwnerToken(locale: Locale): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "spiderfolio" },
    body: JSON.stringify({ email: PEOPLE[locale].owner, password }),
  });
  if (!res.ok) throw new Error(`Login de la dueña de la demo: ${String(res.status)}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function pluginCall(locale: Locale, slug: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}/api/v1/w/${slug}/plugins/corporate-directory${path}`, {
    method: path.startsWith("/ad/wizard") || path === "/ad/test" ? "POST" : "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await ownerToken(locale)}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${String(res.status)} ${await res.text()}`);
  return (await res.json()) as unknown;
}

/** The consent screen's address for a real request (an app registered for the capture). */
let consentUrl = "";

/** The demo form (not in the seed): a daily cold-room check with three records, one non-conforming. */
const FORM: Record<
  Locale,
  {
    name: string;
    room: string;
    rooms: [string, string];
    temp: string;
    doors: string;
    photo: string;
    notes: string;
    note: string;
  }
> = {
  es: {
    name: "Control de temperatura de cámaras",
    room: "Cámara",
    rooms: ["Cámara 1 · lácteos", "Cámara 2 · fiambres"],
    temp: "Temperatura",
    doors: "¿Las puertas cierran bien?",
    photo: "Foto del termómetro",
    notes: "Observaciones",
    note: "Burlete de la puerta gastado; aviso a mantenimiento.",
  },
  en: {
    name: "Cold room temperature check",
    room: "Cold room",
    rooms: ["Cold room 1 · dairy", "Cold room 2 · deli"],
    temp: "Temperature",
    doors: "Do the doors close properly?",
    photo: "Photo of the thermometer",
    notes: "Notes",
    note: "Door seal worn; maintenance told.",
  },
};
const demoForms = new Map<Locale, { id: string; record: string }>();

/** The demo company's job positions (not in the seed), with how many people each one gets. */
const POSITIONS: Record<Locale, [string, number][]> = {
  es: [
    ["Operario de producción", 3],
    ["Operario de cámaras frigoríficas", 2],
    ["Técnico de mantenimiento", 1],
    ["Encargado de turno", 1],
    ["Operario de expedición", 0],
  ],
  en: [
    ["Production operator", 3],
    ["Cold room operator", 2],
    ["Maintenance technician", 1],
    ["Shift supervisor", 1],
    ["Dispatch operator", 0],
  ],
};

/** The demo PPE (not in the seed): item, category, by size, life in months and the positions (by index). */
const PPE: Record<Locale, [string, string, boolean, number | null, number[]][]> = {
  es: [
    ["Guantes anticorte", "Manos", true, 6, [0]],
    ["Calzado de seguridad", "Pies", true, 12, [0, 1, 4]],
    ["Chaqueta para cámara frigorífica", "Cuerpo", true, 24, [1]],
    ["Protección auditiva", "Oídos", false, 1, [0, 2]],
    ["Gafas de seguridad", "Ojos", false, 12, [2]],
  ],
  en: [
    ["Cut-resistant gloves", "Hands", true, 6, [0]],
    ["Safety footwear", "Feet", true, 12, [0, 1, 4]],
    ["Cold room jacket", "Body", true, 24, [1]],
    ["Hearing protection", "Ears", false, 1, [0, 2]],
    ["Safety glasses", "Eyes", false, 12, [2]],
  ],
};
/** Who gets the sheet capture and who the new handout capture (membership ids). */
const demoSafetyPeople = new Map<Locale, { sheet: string; next: string; course: string }>();

/** The demo incident, course and fitness texts. */
const SAFETY_DEMO: Record<
  Locale,
  { place: string; what: string; causes: string; restriction: string }
> = {
  es: {
    place: "Sala de despiece",
    what: "Corte superficial en la mano izquierda al limpiar la sierra de cinta con la máquina parada.",
    causes: "Se limpió sin el guante de malla.",
    restriction: "Sin cargas de más de 15 kg",
  },
  en: {
    place: "Cutting room",
    what: "Shallow cut on the left hand while cleaning the band saw with the machine stopped.",
    causes: "Cleaned without the chain mail glove.",
    restriction: "No loads over 15 kg",
  },
};

/** A drawn signature, as the app sends it. */
async function signaturePng(): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160"><rect width="600" height="160" fill="#fff"/><path d="M30 110 C 70 20, 100 150, 140 70 S 210 40, 240 105 S 310 130, 350 60 S 430 95, 470 82 L 560 78" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Turns the module on and creates the catalog and three handouts through the API, the first time. */
async function demoSafety(locale: Locale, slug: string): Promise<void> {
  if (demoSafetyPeople.has(locale)) return;
  await demoPositions(locale, slug);
  const owner = await ownerToken(locale);
  await formCall(owner, slug, "PUT", "/admin/safety", { enabled: true, terms: "es" });
  const holders = await db.query<{ id: string; position: string }>(
    `SELECT m.id, p.name AS position FROM "Membership" m JOIN "Position" p ON p.id = m."positionId"
       JOIN "Workspace" w ON w.id = m."workspaceId" WHERE w.slug = $1 ORDER BY m."createdAt", m.id`,
    [slug],
  );
  const names = POSITIONS[locale].map(([name]) => name);
  const holder = (position: number, nth = 0) =>
    holders.rows.filter((row) => row.position === names[position])[nth]?.id ?? "";
  const people = { sheet: holder(0), next: holder(2), course: "" };
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM "SafetyItem" i JOIN "Workspace" w ON w.id = i."workspaceId" WHERE w.slug = $1`,
    [slug],
  );
  const existing = await db.query<{ id: string }>(
    `SELECT c.id FROM "SafetyCourse" c JOIN "Workspace" w ON w.id = c."workspaceId" WHERE w.slug = $1 LIMIT 1`,
    [slug],
  );
  if (existing.rows[0] !== undefined) {
    demoSafetyPeople.set(locale, { ...people, course: existing.rows[0].id });
    return;
  }
  // The PPE part may already be there (an earlier run): then only what came after it.
  const hasPpe = Number(rows[0]?.count ?? 0) > 0;
  const positionIds = new Map(
    (
      await db.query<{ id: string; name: string }>(
        `SELECT p.id, p.name FROM "Position" p JOIN "Workspace" w ON w.id = p."workspaceId" WHERE w.slug = $1`,
        [slug],
      )
    ).rows.map((row) => [row.name, row.id]),
  );
  const items: string[] = [];
  const signature = await signaturePng();
  if (!hasPpe) {
    for (const [name, category, hasSizes, lifeMonths, positions] of PPE[locale]) {
      const { item } = (await formCall(owner, slug, "POST", "/safety/items", {
        name,
        category,
        hasSizes,
        lifeMonths,
        positionIds: positions.flatMap((index) => positionIds.get(names[index] ?? "") ?? []),
      })) as { item: { id: string } };
      items.push(item.id);
    }
    const hand = (membershipId: string, lines: [number, number, string | null][]) =>
      formCall(owner, slug, "POST", "/safety/deliveries", {
        membershipId,
        lines: lines.map(([index, quantity, size]) => ({ itemId: items[index], quantity, size })),
        signature,
      });
    await hand(holder(0), [
      [0, 2, "8"],
      [3, 10, null],
    ]);
    await hand(holder(0, 1), [
      [0, 2, "9"],
      [1, 1, "43"],
      [3, 10, null],
    ]);
    await hand(holder(1), [
      [2, 1, "L"],
      [1, 1, "39"],
    ]);
    // The sheet's hearing protection is about to be replaced.
    await db.query(
      `UPDATE "SafetyDeliveryLine" l SET "replaceOn" = current_date + 5
       FROM "SafetyDelivery" d WHERE d.id = l."deliveryId" AND d."membershipId" = $1 AND l."itemId" = $2`,
      [holder(0), items[3]],
    );
  }
  // An incident through the base form, with a measure.
  const text = SAFETY_DEMO[locale];
  const { form } = (await formCall(owner, slug, "GET", "/safety/incident-form", undefined)) as {
    form: { formId: string };
  };
  const formRow = await db.query<{ currentVersion: number }>(
    `SELECT "currentVersion" FROM "Node" WHERE id = $1`,
    [form.formId],
  );
  await formCall(owner, slug, "POST", `/forms/${form.formId}/records`, {
    version: formRow.rows[0]?.currentVersion ?? 2,
    answers: {
      sst_fecha: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      sst_hora: "10:30",
      sst_lugar: text.place,
      sst_persona: holder(0),
      sst_tipo: "sin_baja",
      sst_gravedad: "leve",
      sst_que: text.what,
      sst_causas: text.causes,
    },
  });
  await formCall(owner, slug, "POST", `/forms/${form.formId}/records`, {
    version: formRow.rows[0]?.currentVersion ?? 2,
    answers: {
      sst_fecha: new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10),
      sst_lugar: text.place,
      sst_tipo: "casi",
      sst_que: text.causes,
    },
  });
  // A course over a published document of the seed, required by position, two in person.
  const document = await db.query<{ nodeId: string }>(
    `SELECT d."nodeId" FROM "ControlledDocument" d JOIN "Workspace" w ON w.id = d."workspaceId"
      WHERE w.slug = $1 AND d."publishedVersion" IS NOT NULL ORDER BY d.code LIMIT 1`,
    [slug],
  );
  const nodeId = document.rows[0]?.nodeId ?? "";
  await formCall(owner, slug, "PUT", `/nodes/${nodeId}/controlled/readings`, {
    positionId: positionIds.get(names[0] ?? ""),
  });
  const { course } = (await formCall(owner, slug, "POST", "/safety/courses", {
    nodeId,
    validityMonths: 12,
  })) as { course: { id: string } };
  await formCall(owner, slug, "POST", `/safety/courses/${course.id}/attendance`, {
    attendees: [
      { membershipId: holder(0), signature },
      { membershipId: holder(0, 1), signature },
    ],
    completedOn: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10),
  });
  await formCall(owner, slug, "POST", `/safety/people/${holder(0)}/fitness`, {
    status: "APT_RESTRICTED",
    validUntil: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10),
    restrictions: text.restriction,
  });
  demoSafetyPeople.set(locale, { ...people, course: course.id });
}

/** The CAE demo (web/scripts/demo-cae.ts) through the API, once per company; then its ids. */
const demoCaeIds = new Map<
  Locale,
  { cleaning: string; cold: string; worker: string; deniedWorker: string; permit: string }
>();

async function demoCaeOf(locale: Locale, slug: string): Promise<void> {
  if (demoCaeIds.has(locale)) return;
  await demoSafety(locale, slug);
  await demoCae({
    base: BASE,
    token: await ownerToken(locale),
    slug,
    locale,
    responsibleEmail: PEOPLE[locale].admin,
    staffEmail: PEOPLE[locale].reader,
  });
  const names = demoCaeNames(locale);
  const one = async (sql: string, values: string[]) => {
    const { rows } = await db.query<{ id: string }>(sql, [slug, ...values]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`CAE demo: nothing for ${values.join(", ")}`);
    return id;
  };
  const company = (key: string) =>
    one(
      `SELECT c.id FROM "CaeCompany" c JOIN "Workspace" w ON w.id = c."workspaceId"
        WHERE w.slug = $1 AND c.name = $2`,
      [names.find((item) => item.key === key)?.name ?? ""],
    );
  const worker = (key: string) =>
    one(
      `SELECT k.id FROM "CaeWorker" k JOIN "Workspace" w ON w.id = k."workspaceId"
        WHERE w.slug = $1 AND k.name = $2`,
      [names.find((item) => item.key === key)?.workers[0]?.name ?? ""],
    );
  demoCaeIds.set(locale, {
    cleaning: await company("cleaning"),
    cold: await company("cold"),
    worker: await worker("cleaning"),
    deniedWorker: await worker("cold"),
    permit: await one(
      `SELECT p.id FROM "CaeWorkPermit" p JOIN "Workspace" w ON w.id = p."workspaceId"
        WHERE w.slug = $1 AND p.type = $2 ORDER BY p."createdAt" LIMIT 1`,
      ["HOT_WORK"],
    ),
  });
}

/** The planning's measures (web/scripts/demo-planning.ts), after CAE and the demo form (its record). */
const demoPlanningDone = new Set<Locale>();

async function demoPlanningOf(locale: Locale, slug: string): Promise<void> {
  if (demoPlanningDone.has(locale)) return;
  await demoCaeOf(locale, slug);
  await demoForm(locale, slug);
  await demoPlanning({
    base: BASE,
    token: await ownerToken(locale),
    slug,
    locale,
    db,
    responsibleEmails: [PEOPLE[locale].admin, PEOPLE[locale].reader],
  });
  // The accident rates: hours, headcount, accidents with leave and their days.
  await demoIndicators({ base: BASE, token: await ownerToken(locale), slug, locale, db });
  // Emergencies: the PEM plan, the team and three drills with a measure.
  await demoEmergencies({
    base: BASE,
    token: await ownerToken(locale),
    slug,
    locale,
    db,
    peopleEmails: [PEOPLE[locale].owner, PEOPLE[locale].admin, PEOPLE[locale].reader],
  });
  const drill = await db.query<{ id: string }>(
    `SELECT d.id FROM "SafetyDrill" d JOIN "Workspace" w ON w.id = d."workspaceId"
      WHERE w.slug = $1 ORDER BY d.date DESC, d.id DESC LIMIT 1`,
    [slug],
  );
  const drillId = drill.rows[0]?.id;
  if (drillId === undefined) throw new Error("demoEmergencies no dejó simulacros");
  demoDrillIds.set(locale, drillId);
  // The committee: members, three meetings with minutes and the last one's agreements.
  await demoCommittee({
    base: BASE,
    token: await ownerToken(locale),
    slug,
    locale,
    peopleEmails: [PEOPLE[locale].admin, PEOPLE[locale].reader, PEOPLE[locale].owner],
  });
  const meeting = await db.query<{ id: string }>(
    `SELECT m.id FROM "SafetyMeeting" m JOIN "Workspace" w ON w.id = m."workspaceId"
      WHERE w.slug = $1 ORDER BY m.date DESC, m.id DESC LIMIT 1`,
    [slug],
  );
  const meetingId = meeting.rows[0]?.id;
  if (meetingId === undefined) throw new Error("demoCommittee no dejó reuniones");
  demoMeetingIds.set(locale, meetingId);
  demoPlanningDone.add(locale);
}

/** The latest demo committee meeting of each language, for its capture. */
const demoMeetingIds = new Map<Locale, string>();
const meetingIdOf = (locale: Locale) => {
  const id = demoMeetingIds.get(locale);
  if (id === undefined) throw new Error("demoPlanningOf todavía no corrió");
  return id;
};

/** The latest demo drill of each language, for its capture. */
const demoDrillIds = new Map<Locale, string>();
const drillIdOf = (locale: Locale) => {
  const id = demoDrillIds.get(locale);
  if (id === undefined) throw new Error("demoPlanningOf todavía no corrió");
  return id;
};

const caeIdsOf = (locale: Locale) => {
  const ids = demoCaeIds.get(locale);
  if (ids === undefined) throw new Error("demoCaeOf todavía no corrió");
  return ids;
};

/** The worker card's button, in each language. */
const CAE_CARD: Record<Locale, string> = { es: "Tarjeta con QR", en: "QR card" };

const safetyPeopleOf = (locale: Locale) => {
  const people = demoSafetyPeople.get(locale);
  if (people === undefined) throw new Error("demoSafety todavía no corrió");
  return people;
};

/** Creates the positions through the API the first time and gives them to some members. */
async function demoPositions(locale: Locale, slug: string): Promise<void> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*) FROM "Position" p JOIN "Workspace" w ON w.id = p."workspaceId" WHERE w.slug = $1`,
    [slug],
  );
  if (Number(rows[0]?.count ?? 0) > 0) return;
  const owner = await ownerToken(locale);
  const members = await db.query<{ id: string }>(
    `SELECT m.id FROM "Membership" m JOIN "Workspace" w ON w.id = m."workspaceId"
       JOIN "Role" r ON r.id = m."roleId"
      WHERE w.slug = $1 AND r.base = 'MEMBER' AND m.status = 'ACTIVE' ORDER BY m."createdAt", m.id`,
    [slug],
  );
  let next = 0;
  for (const [name, people] of POSITIONS[locale]) {
    const { position } = (await formCall(owner, slug, "POST", "/admin/positions", { name })) as {
      position: { id: string };
    };
    for (let i = 0; i < people; i += 1) {
      const member = members.rows[next];
      next += 1;
      if (member === undefined) break;
      await formCall(owner, slug, "PATCH", `/admin/members/${member.id}`, {
        positionId: position.id,
      });
    }
  }
}

async function formCall(token: string, slug: string, method: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}/api/v1/w/${slug}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${path}: ${String(res.status)} ${await res.text()}`);
  return res.status === 204 ? undefined : ((await res.json()) as unknown);
}

/** Creates the demo form through the API the first time (only in this database); then finds it. */
async function demoForm(locale: Locale, slug: string): Promise<void> {
  if (demoForms.has(locale)) return;
  const f = FORM[locale];
  const { rows } = await db.query<{ id: string; record: string }>(
    `SELECT n.id, r.id AS record FROM "Node" n JOIN "FormRecord" r ON r."nodeId" = n.id
       JOIN "Workspace" w ON w.id = n."workspaceId"
      WHERE w.slug = $1 AND n.name = $2 AND n."trashedAt" IS NULL AND cardinality(r."nonConforming") > 0
      LIMIT 1`,
    [slug, f.name],
  );
  const found = rows[0];
  if (found !== undefined) {
    demoForms.set(locale, found);
    return;
  }
  const owner = await ownerToken(locale);
  const ids = await idsOf(db, locale);
  const created = (await formCall(owner, slug, "POST", `/spaces/${ids.procedures}/forms`, {
    name: f.name,
  })) as { form: { node: { id: string } } };
  const id = created.form.node.id;
  await formCall(owner, slug, "PUT", `/forms/${id}/template`, {
    baseVersion: 1,
    fields: [
      {
        id: "room",
        type: "choice",
        label: f.room,
        required: true,
        options: [
          { id: "c1", label: f.rooms[0] },
          { id: "c2", label: f.rooms[1] },
        ],
      },
      { id: "temp", type: "number", label: f.temp, unit: "°C", min: 0, max: 4, required: true },
      { id: "doors", type: "yesno", label: f.doors, nonConforming: "no", required: true },
      { id: "photo", type: "photo", label: f.photo },
      { id: "notes", type: "text", label: f.notes, multiline: true },
    ],
  });
  const department = await db.query<{ id: string }>(
    `SELECT d.id FROM "Department" d JOIN "Workspace" w ON w.id = d."workspaceId"
      WHERE w.slug = $1 ORDER BY d.name LIMIT 1`,
    [slug],
  );
  await formCall(owner, slug, "PUT", `/forms/${id}/settings`, {
    responsible: { type: "default" },
    frequency: "daily",
    weekdays: [1, 2, 3, 4, 5],
    assignees: { people: [], departments: department.rows.map((row) => row.id) },
  });
  const submit = async (answers: object) =>
    (
      (await formCall(owner, slug, "POST", `/forms/${id}/records`, {
        version: 2,
        answers,
        source: "qr",
      })) as { record: { id: string } }
    ).record.id;
  await submit({ room: "c1", temp: 3, doors: "yes" });
  await submit({ room: "c2", temp: 2.5, doors: "yes" });
  const record = await submit({ room: "c2", temp: 7, doors: "no", notes: f.note });
  demoForms.set(locale, { id, record });
}

const demoRooms = new Map<Locale, string>();

/** An audit room with what it shares and a few of the auditor's accesses (docs/spec/salas-de-auditoria.md). */
async function demoAuditRoom(locale: Locale, slug: string, ids: Ids): Promise<void> {
  if (demoRooms.has(locale)) return;
  const owner = await ownerToken(locale);
  const day = (offset: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const es = locale === "es";
  const created = (await formCall(owner, slug, "POST", "/admin/audit-rooms", {
    name: es ? "Auditoría ISO 22000 · noviembre" : "ISO 22000 audit · November",
    auditorEmail: es ? "auditora@certificadora.example" : "auditor@certifier.example",
    expiresOn: day(14),
    allowDownload: true,
  })) as { room: { id: string } };
  const id = created.room.id;
  for (const item of [
    { kind: "space", spaceId: ids.procedures },
    { kind: "approvals", nodeId: ids.control },
    { kind: "readings", nodeId: ids.control },
    { kind: "audit-log", from: day(-30), to: day(0), action: "document." },
  ]) {
    await formCall(owner, slug, "POST", `/admin/audit-rooms/${id}/items`, item);
  }
  const workspace = await db.query<{ id: string }>(`SELECT id FROM "Workspace" WHERE slug = $1`, [
    slug,
  ]);
  const accesses: [string, string | null, number][] = [
    ["enter", null, 50],
    [
      "view",
      es
        ? "Procedimientos › Uso de la cortadora de fiambres"
        : "Procedures › Using the meat slicer",
      46,
    ],
    ["view", es ? "Historial de aprobaciones y versiones" : "Approvals and versions history", 41],
    ["download", es ? "Cumplimiento de lecturas" : "Reading compliance", 38],
  ];
  for (const [action, what, minutes] of accesses) {
    await db.query(
      `INSERT INTO "AuditRoomAccess" (id, "workspaceId", "roomId", action, what, ip, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, '83.45.120.17', now() - ($5 || ' minutes')::interval)`,
      [workspace.rows[0]?.id ?? "", id, action, what, String(minutes)],
    );
  }
  demoRooms.set(locale, id);
}

const roomOf = (locale: Locale) => demoRooms.get(locale) ?? "";

const demoExpiriesDone = new Set<Locale>();

/** Expiries on the demo space's pages and files (docs/spec/vencimientos.md), relative to today. */
async function demoExpiries(locale: Locale, slug: string, ids: Ids): Promise<void> {
  if (demoExpiriesDone.has(locale)) return;
  const owner = await ownerToken(locale);
  const nodes = await db.query<{ id: string }>(
    `SELECT n.id FROM "Node" n WHERE n."spaceId" = $1 AND n.type IN ('PAGE', 'FILE')
      AND n."trashedAt" IS NULL AND n.id NOT IN ($2, $3) ORDER BY n.name LIMIT 4`,
    [ids.procedures, ids.slicer, ids.control],
  );
  const people = await db.query<{ id: string }>(
    `SELECT m.id FROM "Membership" m JOIN "Workspace" w ON w.id = m."workspaceId"
      WHERE w.slug = $1 AND m.status = 'ACTIVE' ORDER BY m."createdAt" LIMIT 3`,
    [slug],
  );
  const department = await db.query<{ id: string }>(
    `SELECT d.id FROM "Department" d JOIN "Workspace" w ON w.id = d."workspaceId"
      WHERE w.slug = $1 ORDER BY d.name LIMIT 1`,
    [slug],
  );
  const day = (offset: number) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const person = (index: number) => {
    const row = people.rows[index % Math.max(1, people.rows.length)];
    return row === undefined ? null : { type: "person", id: row.id };
  };
  const team =
    department.rows[0] === undefined ? null : { type: "department", id: department.rows[0].id };
  const note = locale === "es" ? "Renovar con el proveedor." : "Renew with the supplier.";
  const plan: [string, number, object | null, string | null][] = [
    [ids.slicer, 5, person(0), note],
    [ids.control, -3, team, null],
    ...nodes.rows.map((row, index): [string, number, object | null, string | null] => [
      row.id,
      [12, 40, 2, 90][index] ?? 30,
      index % 2 === 0 ? person(index + 1) : team,
      null,
    ]),
  ];
  for (const [id, offset, responsible, text] of plan) {
    await formCall(owner, slug, "PUT", `/nodes/${id}/expiry`, {
      dueOn: day(offset),
      responsible,
      noticeDays: [30, 7, 0],
      note: text,
    });
  }
  demoExpiriesDone.add(locale);
}

/** The demo form with a QR code already made, so the dialog shows its preview and downloads. */
async function demoFormQr(locale: Locale, slug: string): Promise<void> {
  await demoForm(locale, slug);
  const { id } = formOf(locale);
  const { rows } = await db.query(
    `SELECT id FROM "QrCode" WHERE "nodeId" = $1 AND "revokedAt" IS NULL LIMIT 1`,
    [id],
  );
  if (rows.length === 0)
    await formCall(await ownerToken(locale), slug, "POST", `/nodes/${id}/qr`, {});
}

const formOf = (locale: Locale) => demoForms.get(locale) ?? { id: "", record: "" };

/** The labels of the assistant's first step (corporate-directory's frontend/texts.ts). */
const WIZARD: Record<Locale, { domain: string; find: string; server: string; next: string }> = {
  es: {
    domain: "Dominio de tu red",
    find: "Buscar el servidor",
    server: "Nombre del servidor (controlador de dominio)",
    next: "Siguiente",
  },
  en: {
    domain: "Your network's domain",
    find: "Find the server",
    server: "Server name (domain controller)",
    next: "Next",
  },
};

/** A word that matches several demo documents in each language. */
const SEARCH: Record<Locale, string> = { es: "limpieza", en: "cleaning" };

const CAPTURES: Capture[] = [
  { name: "inicio", who: "owner", path: (i) => `/app/${i.slug}` },
  // Navigation by areas on a phone (docs/spec/diseno.md 10.4.1): the bottom bar and the area's menu.
  {
    name: "navegacion-movil",
    who: "owner",
    viewport: { width: 375, height: 812 },
    path: (i) => `/app/${i.slug}/seguridad/resumen`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "navegacion-menu-movil",
    who: "owner",
    viewport: { width: 375, height: 812 },
    path: (i) => `/app/${i.slug}/seguridad/resumen`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
    then: async (page) => {
      await page.getByRole("button", { name: /^(Abrir el menú de|Open the )/u }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "espacios", who: "owner", path: (i) => `/app/${i.slug}/files` },
  {
    name: "explorador",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/f/${i.plant}`,
  },
  {
    name: "pagina",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
  },
  {
    name: "documento-controlado",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.control}`,
  },
  { name: "documentos", who: "owner", path: (i) => `/app/${i.slug}/admin/documents` },
  { name: "aprobaciones", who: "admin", path: (i) => `/app/${i.slug}/aprobaciones` },
  { name: "mis-documentos", who: "reader", path: (i) => `/app/${i.slug}/mis-documentos` },
  {
    name: "busqueda",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/search?q=${encodeURIComponent(SEARCH[locale])}`,
  },
  { name: "accesos", who: "owner", path: (i) => `/app/${i.slug}/admin/access` },
  { name: "miembros", who: "owner", path: (i) => `/app/${i.slug}/admin/members` },
  { name: "departamentos", who: "owner", path: (i) => `/app/${i.slug}/admin/departments` },
  {
    name: "epis",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/epis`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "epis-catalogo",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/epis/catalogo`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "epis-nueva",
    who: "owner",
    path: (i, locale) =>
      `/app/${i.slug}/seguridad/epis/nueva?persona=${safetyPeopleOf(locale).next}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "resumen",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/resumen`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "accidentes",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/incidentes`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "formacion",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/formacion/${safetyPeopleOf(locale).course}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "epis-ficha",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/personas/${safetyPeopleOf(locale).sheet}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    // The planning of the preventive activity (docs/spec/seguridad-salud.md).
    name: "planificacion",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/planificacion?estado=all`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    // Accident rates (docs/spec/seguridad-salud.md, «Indicadores de siniestralidad»).
    name: "indicadores",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/indicadores`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    // Emergencies and drills (docs/spec/seguridad-salud.md, «Emergencias y simulacros»).
    name: "emergencias",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/emergencias`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "simulacros",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/emergencias/simulacros`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "simulacro",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/emergencias/simulacros/${drillIdOf(locale)}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    // The health and safety committee (docs/spec/seguridad-salud.md, «Consulta y participación»).
    name: "comite",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/comite`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "reuniones",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/comite/reuniones`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "reunion",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/comite/reuniones/${meetingIdOf(locale)}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    // A committee member without safety.manage: only the committee.
    name: "comite-miembro",
    who: "reader",
    path: (i, locale) => `/app/${i.slug}/seguridad/comite/reuniones/${meetingIdOf(locale)}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  // CAE, coordination of business activities (docs/spec/cae.md), with web/scripts/demo-cae.ts.
  {
    name: "cae-empresas",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/cae`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-empresa",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/cae/empresas/${caeIdsOf(locale).cleaning}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-empresa-incompleta",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/cae/empresas/${caeIdsOf(locale).cold}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-trabajador",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/cae/trabajadores/${caeIdsOf(locale).worker}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-tarjeta",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/cae/trabajadores/${caeIdsOf(locale).worker}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
    then: async (page, locale) => {
      await page.getByRole("button", { name: CAE_CARD[locale] }).click();
      await page.getByRole("dialog").locator("img").waitFor();
    },
  },
  {
    name: "cae-revisar",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/cae/revisar`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-porteria-ok",
    who: "owner",
    viewport: { width: 375, height: 812 },
    path: (i, locale) =>
      `/app/${i.slug}/seguridad/cae/porteria?trabajador=${caeIdsOf(locale).worker}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-porteria-no",
    who: "owner",
    viewport: { width: 375, height: 812 },
    path: (i, locale) =>
      `/app/${i.slug}/seguridad/cae/porteria?trabajador=${caeIdsOf(locale).deniedWorker}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-accesos",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/cae/accesos`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-permisos",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/cae/permisos`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-permiso",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/seguridad/cae/permisos/${caeIdsOf(locale).permit}`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "cae-catalogo",
    who: "owner",
    path: (i) => `/app/${i.slug}/seguridad/cae/catalogo`,
    before: ({ slug, locale }) => demoPlanningOf(locale, slug),
  },
  {
    name: "puestos",
    who: "owner",
    path: (i) => `/app/${i.slug}/admin/positions`,
    before: ({ slug, locale }) => demoPositions(locale, slug),
  },
  { name: "roles", who: "owner", path: (i) => `/app/${i.slug}/admin/roles` },
  {
    // With the module and CAE on (its switch, the examples and the gatehouse log).
    name: "seguridad",
    who: "owner",
    path: (i) => `/app/${i.slug}/admin/security`,
    before: ({ slug, locale }) => demoCaeOf(locale, slug),
  },
  {
    name: "seguridad-email",
    who: "owner",
    path: (i) => `/app/${i.slug}/admin/security?tab=email`,
    then: (page, locale) =>
      page
        .getByText(locale === "es" ? "Email del servidor" : "Server email", { exact: true })
        .first()
        .waitFor(),
  },
  {
    name: "bian",
    who: "owner",
    path: (i) => `/app/${i.slug}`,
    bian: true,
    then: async (page, locale) => {
      const t = BIAN_TEXT[locale];
      await page.getByRole("button", { name: t.ask }).first().click();
      const input = page.getByRole("textbox", { name: t.placeholder });
      await input.fill(t.question);
      await input.press("Enter");
      // The recorded answer is written in about 3 s; the citations come with the last event.
      await page.getByRole("link", { name: t.source }).first().waitFor({ timeout: 15_000 });
    },
  },
  { name: "bian-admin", who: "owner", path: (i) => `/app/${i.slug}/admin/bian` },
  { name: "limites", who: "owner", path: (i) => `/app/${i.slug}/admin/limits` },
  { name: "auditoria", who: "owner", path: (i) => `/app/${i.slug}/admin/audit` },
  { name: "perfil", who: "owner", path: (i) => `/app/${i.slug}/profile` },
  {
    name: "compartir",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    then: (page, locale) =>
      page.getByRole("button", { name: LABELS[locale].share, exact: true }).click(),
  },
  {
    name: "control",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.control}`,
    then: (page, locale) => fromMenu(page, locale, LABELS[locale].control),
  },
  {
    name: "qr",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    then: (page, locale) => fromMenu(page, locale, LABELS[locale].qr),
  },
  // Expiries of files and pages (docs/spec/vencimientos.md).
  {
    name: "vencimientos",
    who: "owner",
    path: (i) => `/app/${i.slug}/vencimientos`,
    before: ({ slug, locale, ids }) => demoExpiries(locale, slug, ids),
  },
  {
    name: "vencimientos-calendario",
    who: "owner",
    path: (i) => `/app/${i.slug}/vencimientos?vista=calendar`,
    before: ({ slug, locale, ids }) => demoExpiries(locale, slug, ids),
  },
  {
    name: "vencimiento",
    who: "owner",
    path: (i) => `/app/${i.slug}/files/${i.procedures}/p/${i.slicer}`,
    before: ({ slug, locale, ids }) => demoExpiries(locale, slug, ids),
    then: (page, locale) => fromMenu(page, locale, locale === "es" ? "Vencimiento" : "Expiry"),
  },
  // Audit rooms (docs/spec/salas-de-auditoria.md).
  {
    name: "salas-auditoria",
    who: "owner",
    path: (i) => `/app/${i.slug}/admin/audit-rooms`,
    before: ({ slug, locale, ids }) => demoAuditRoom(locale, slug, ids),
  },
  {
    name: "sala-auditoria",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/admin/audit-rooms/${roomOf(locale)}`,
    before: ({ slug, locale, ids }) => demoAuditRoom(locale, slug, ids),
  },
  {
    name: "sala-auditor",
    who: "owner",
    prefix: "/auditoria/",
    path: (_i, locale) => `/auditoria/${roomOf(locale)}`,
    before: ({ slug, locale, ids }) => demoAuditRoom(locale, slug, ids),
  },
  // Forms and records: the demo form, created the first time (demoForm).
  {
    name: "formulario",
    who: "owner",
    path: (i, locale) =>
      `/app/${i.slug}/files/${i.procedures}/form/${formOf(locale).id}?pestana=diseno`,
    before: ({ slug, locale }) => demoForm(locale, slug),
  },
  {
    name: "formulario-registros",
    who: "owner",
    path: (i, locale) => `/app/${i.slug}/files/${i.procedures}/form/${formOf(locale).id}`,
    before: ({ slug, locale }) => demoForm(locale, slug),
  },
  {
    name: "formulario-llenar",
    who: "reader",
    path: (i, locale) => `/app/${i.slug}/files/${i.procedures}/form/${formOf(locale).id}/fill`,
    before: ({ slug, locale }) => demoForm(locale, slug),
  },
  {
    name: "formulario-registro",
    who: "owner",
    path: (i, locale) =>
      `/app/${i.slug}/files/${i.procedures}/form/${formOf(locale).id}/r/${formOf(locale).record}`,
    before: ({ slug, locale }) => demoForm(locale, slug),
  },
  {
    name: "formulario-qr",
    who: "owner",
    path: (i, locale) =>
      `/app/${i.slug}/files/${i.procedures}/form/${formOf(locale).id}?pestana=ajustes`,
    before: ({ slug, locale }) => demoFormQr(locale, slug),
    then: (page, locale) =>
      page.getByRole("button", { name: LABELS[locale].qr, exact: true }).click(),
  },
  // Plugins: the free one alone first (the paid one replaces it), then with the paid license.
  {
    name: "plugin-microsoft",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/p/microsoft-sign-in/microsoft`,
    // An example connection (invented ids), saved like the screen does.
    before: async ({ workspaceId }) => {
      await db.query(
        `INSERT INTO "PluginSetting" ("id", "workspaceId", "pluginId", "key", "value", "updatedAt")
         VALUES ($1, $2, 'microsoft-sign-in', 'entra', $3, now())
         ON CONFLICT ("workspaceId", "pluginId", "key") DO UPDATE SET "value" = $3, "updatedAt" = now()`,
        [
          `capturas-ms-${workspaceId}`,
          workspaceId,
          JSON.stringify({
            enabled: true,
            label: "",
            tenantId: "3f2a8c51-7d4e-4b9a-9c1e-2b6f0d8e4a17",
            clientId: "9b1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
          }),
        ],
      );
    },
  },
  { name: "licencia", who: "owner", license: true, path: (i) => `/app/${i.slug}/admin/license` },
  // The connector for Claude (free plugin, on in both demo companies).
  {
    name: "plugin-claude",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/p/claude-connector/claude`,
  },
  {
    name: "aplicaciones-conectadas",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/profile`,
    then: async (page, locale) => {
      // The profile column stays fixed while scrolling: in the shot it would cover the section.
      await page.addStyleTag({ content: String.raw`.lg\:sticky { position: static !important; }` });
      await page
        .getByRole("heading", {
          name: locale === "es" ? "Aplicaciones conectadas" : "Connected apps",
        })
        .scrollIntoViewIfNeeded();
    },
  },
  {
    name: "conector-seguridad",
    who: "owner",
    license: false,
    path: (i) => `/app/${i.slug}/admin/security`,
    then: async (page, locale) => {
      // In the page, not the menu (the plugin's section has the same name).
      await page
        .locator("main")
        .getByText(locale === "es" ? "Conector para Claude" : "Connector for Claude", {
          exact: true,
        })
        .scrollIntoViewIfNeeded();
    },
  },
  {
    name: "autorizar-app",
    who: "owner",
    license: false,
    path: () => consentUrl,
    prefix: "/authorize-app",
    // A real request, as Claude starts it: the app registers and asks to authorize.
    before: async () => {
      const registered = await fetch(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      });
      const { client_id: clientId } = (await registered.json()) as { client_id: string };
      const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        scope: "docs:read docs:write",
        state: "capturas",
        resource: `${BASE}/mcp`,
      });
      const answer = await fetch(`${BASE}/oauth/authorize?${query.toString()}`, {
        redirect: "manual",
      });
      const location = new URL(answer.headers.get("location") ?? "");
      consentUrl = `${location.pathname}${location.hash}`;
    },
  },
  {
    name: "plugin-asistente",
    who: "owner",
    license: true,
    path: (i) => `/app/${i.slug}/admin/p/corporate-directory/directory`,
    // The assistant shows until Active Directory is set up.
    before: async ({ workspaceId }) => {
      await db.query(
        `DELETE FROM "PluginSetting" WHERE "workspaceId" = $1 AND "pluginId" = 'corporate-directory'`,
        [workspaceId],
      );
    },
    then: async (page, locale) => {
      const w = WIZARD[locale];
      await page.getByLabel(w.domain).fill("empresa.test");
      await page.getByRole("button", { name: w.find }).click();
      await page.getByLabel(w.server).fill("localhost");
      await page.getByRole("button", { name: w.next }).click();
      await page.getByText("SpiderFolio Test CA").first().waitFor();
    },
  },
  {
    name: "plugin-directorio",
    who: "owner",
    license: true,
    path: (i) => `/app/${i.slug}/admin/p/corporate-directory/directory`,
    // Active Directory set up as the assistant leaves it (the Samba AD test image on 127.0.0.1:636).
    before: async ({ slug, locale }) => {
      const answer = (await pluginCall(locale, slug, "/ad/wizard/certificate", {
        server: "localhost",
      })) as { ok: boolean; certificate?: { pem: string } };
      if (answer.certificate === undefined) throw new Error("Sin Samba AD en 127.0.0.1:636");
      await pluginCall(locale, slug, "/ad", {
        config: {
          enabled: true,
          label: "",
          url: "ldaps://localhost:636",
          startTls: false,
          caCertificate: answer.certificate.pem,
          baseDn: "DC=empresa,DC=test",
          bindDn: "svc-spiderfolio@empresa.test",
          loginAttribute: "sAMAccountName",
          allowedGroups: ["CN=SpiderFolio,OU=Grupos,DC=empresa,DC=test"],
          mappings: [],
          sync: { enabled: true, maxSuspendPercent: 10 },
        },
        // The Samba AD test image's fixed password (plugins repository, test/samba-ad).
        bindPassword: "Clave-Prueba-2026!",
      });
    },
  },
];

/**
 * Fails a blank capture or one with only the splash: almost every pixel is the background color. A
 * real screen (sidebar, text, cards) has well over 1.5% of pixels away from the background; the splash
 * logo alone is about 0.2%.
 */
async function assertNotBlank(png: Buffer): Promise<void> {
  const { data, info } = await sharp(png)
    .resize({ width: 240 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const at = (index: number): number => data[index] ?? 0;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 3) {
    const key = ((at(i) >> 3) << 10) | ((at(i + 1) >> 3) << 5) | (at(i + 2) >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const background = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const [r, g, b] = [
    (background >> 10) << 3,
    ((background >> 5) & 31) << 3,
    (background & 31) << 3,
  ];
  let content = 0;
  for (let i = 0; i < data.length; i += 3) {
    const distance = Math.abs(at(i) - r) + Math.abs(at(i + 1) - g) + Math.abs(at(i + 2) - b);
    if (distance > 40) content++;
  }
  const ratio = content / pixels;
  if (ratio < 0.015) {
    throw new Error(
      `la captura está casi vacía (${(ratio * 100).toFixed(1)} % de contenido): en blanco o con el splash`,
    );
  }
}

async function shoot(page: Page, file: string): Promise<void> {
  const png = await page.screenshot({ type: "png" });
  await assertNotBlank(png);
  // 1600 px de ancho alcanzan para la web; WebP pesa ~5 veces menos que PNG.
  // A phone-sized capture stays its own size (never enlarged).
  await sharp(png)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(file);
}

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
// Los límites de intentos de login viven en la base: entre corridas, se limpian (solo en esta base).
await db.query(`DELETE FROM "RateLimitBucket"`);
// The server email card shows "Working": a recent successful send (only in this database).
await db.query(
  `INSERT INTO "SystemEmailHealth" ("id", "lastSuccessAt", "updatedAt") VALUES ('system', now(), now())
   ON CONFLICT ("id") DO UPDATE
   SET "lastSuccessAt" = now(), "lastErrorAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()`,
);
// Navigation by areas (docs/spec/diseno.md 10.4.1): the plant procedures are listed in Documentación,
// as a fresh seed does (only in this database).
await db.query(
  `UPDATE "Space" SET "area" = 'DOCUMENTS' WHERE "name" IN ('Procedimientos', 'Procedures') AND "area" = 'WIKI'`,
);
// Free plugins are turned on by the owner: on in both demo companies (only in this database).
await db.query(
  `UPDATE "Workspace" SET "settings" = jsonb_set(COALESCE("settings", '{}'::jsonb), '{communityPlugins}',
     COALESCE("settings"->'communityPlugins', '{}'::jsonb) ||
     jsonb_build_object(
       'microsoft-sign-in', jsonb_build_object('enabledAt', now()::text, 'enabledBy', 'capturas'),
       'claude-connector', jsonb_build_object('enabledAt', now()::text, 'enabledBy', 'capturas')))`,
);
let licensed: boolean | null = null;
/** Loads or takes away the paid plugins' license in both demo companies, then waits for the cache. */
async function setLicense(on: boolean): Promise<void> {
  if (licensed === on) return;
  const companies = await db.query<{ id: string }>(`SELECT id FROM "Workspace"`);
  for (const { id } of companies.rows) {
    const token = on ? licenseFor(id) : null;
    if (token === null) {
      await db.query(`DELETE FROM "WorkspaceLicense" WHERE "workspaceId" = $1`, [id]);
    } else {
      await db.query(
        `INSERT INTO "WorkspaceLicense" ("id", "workspaceId", "token", "updatedAt")
         VALUES ($1, $2, $3, now())
         ON CONFLICT ("workspaceId") DO UPDATE SET "token" = $3, "updatedAt" = now()`,
        [`capturas-${id}`, id, token],
      );
    }
  }
  if (licensed !== null) await sleep(LICENSE_CACHE_WAIT_MS);
  licensed = on;
}
const server = await startServer({
  port: PORT,
  databaseUrl,
  ...(pluginsDir === undefined ? {} : { env: { PLUGINS_DIR: pluginsDir } }),
});
const failed: string[] = [];
// CAPTURAS_SOLO=compartir,qr: rehace solo esas (y CAPTURAS_IDIOMA=es, solo un idioma).
const only = process.env.CAPTURAS_SOLO ? new Set(process.env.CAPTURAS_SOLO.split(",")) : null;
const onlyLocale = process.env.CAPTURAS_IDIOMA;
// The CAE demo makes a few hundred API calls: done before anyone signs in, then a minute's pause, so
// the API's per-minute limit never logs the browser out mid-run.
const demoNeeded = CAPTURES.some(
  (capture) =>
    (only === null || only.has(capture.name)) &&
    /demoCaeOf|demoPlanningOf/u.test(capture.before?.toString() ?? ""),
);
if (demoNeeded) {
  for (const locale of ["es", "en"] as const) {
    if (onlyLocale !== undefined && onlyLocale !== locale) continue;
    await demoPlanningOf(locale, (await idsOf(db, locale)).slug);
  }
  await sleep(61_000);
}
const browser = await chromium.launch();
try {
  for (const locale of ["es", "en"] as const) {
    if (onlyLocale !== undefined && onlyLocale !== locale) continue;
    const ids = await idsOf(db, locale);
    const bian = await bianRecording(db, locale, ids);
    mkdirSync(join(out, locale), { recursive: true });
    for (const who of ["owner", "admin", "reader"] as const) {
      const captures = CAPTURES.filter(
        (capture) => capture.who === who && (only === null || only.has(capture.name)),
      );
      if (captures.length === 0) continue;
      // Una sesión por persona: los dos temas se recorren en la misma (un solo login).
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        locale: locale === "es" ? "es-ES" : "en-GB",
        reducedMotion: "reduce",
      });
      // Only /bian/ask is answered in the page; the rest goes to the server.
      await context.addInitScript(fakeBian, bian);
      await signIn(context, BASE, PEOPLE[locale][who], password);
      const page = await context.newPage();
      for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`${BASE}/app`);
        // Let the session refresh finish first: navigating away mid-refresh loses the rotated cookie.
        await waitUntilReady(page);
        await page.evaluate(
          ([key, value]) => {
            window.localStorage.setItem(key, value);
          },
          ["spiderfolio-theme", theme] as const,
        );
        for (const capture of captures) {
          try {
            await page.keyboard.press("Escape");
            if (capture.license !== undefined) await setLicense(capture.license);
            if (capture.before !== undefined) {
              const { rows } = await db.query<{ id: string }>(
                `SELECT id FROM "Workspace" WHERE slug = $1`,
                [ids.slug],
              );
              await capture.before({
                workspaceId: rows[0]?.id ?? "",
                slug: ids.slug,
                locale,
                ids,
              });
            }
            // Only for this capture: the usage shown elsewhere (home, admin) stays the real one.
            if (capture.bian) await page.route(BIAN_USAGE, fakeBianUsage(bian));
            await page.setViewportSize(capture.viewport ?? { width: 1440, height: 900 });
            await page.goto(`${BASE}${capture.path(ids, locale)}`);
            // Some screens poll (notifications): instead of "network idle", wait for the content.
            await waitUntilReady(page, capture.prefix);
            if (capture.ready !== undefined) await page.getByText(capture.ready).first().waitFor();
            await capture.then?.(page, locale);
            // A dialog can load its own skeletons: check again right before the shot.
            await waitUntilReady(page, capture.prefix);
            // Que terminen de pintarse gráficos y avatares.
            await sleep(400);
            await shoot(page, join(out, locale, `${capture.name}-${theme}.webp`));
            console.log(`${locale}/${capture.name}-${theme}`);
          } catch (error) {
            // Una captura que falla no corta las demás: se informa y se sigue.
            failed.push(`${locale}/${capture.name}-${theme}`);
            const reason = String(error).split(/\r?\n/u)[0] ?? "";
            console.error(`FALLÓ ${locale}/${capture.name}-${theme}: ${reason}`);
          }
          if (capture.bian) await page.unroute(BIAN_USAGE);
          // Sin pasar el límite global de pedidos por minuto de la API.
          await sleep(1500);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
  await db.end();
}
if (failed.length > 0) {
  console.error(`Capturas que fallaron: ${failed.join(", ")}`);
  process.exitCode = 1;
}
