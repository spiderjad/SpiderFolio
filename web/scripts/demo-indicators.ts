// Demo data for the accident rates (docs/spec/seguridad-salud.md, «Indicadores de siniestralidad»)
// through the app's own API: the company's hours worked and average headcount for the last 14 months,
// the same for its first department this year, and the days of leave of the accidents with leave that
// don't have them. Used by capturas.ts and by a local script on the development database. Idempotent:
// a month already entered is left as it is.
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";

export interface DemoIndicatorsTarget {
  base: string;
  /** An owner's token (safety.manage and safety.health). */
  token: string;
  slug: string;
  locale: "es" | "en";
  db: pg.Client;
}

/** Accidents with leave reported through the module's form when the company has none. */
const ACCIDENTS: Record<"es" | "en", { place: string; what: string; causes: string }[]> = {
  es: [
    {
      place: "Muelle de expedición",
      what: "Torcedura de tobillo al bajar del muelle de carga con un palé.",
      causes: "Escalón del muelle sin señalizar.",
    },
    {
      place: "Sala de despiece",
      what: "Corte en el antebrazo al manipular una pieza con el cuchillo.",
      causes: "Se trabajó sin el manguito de malla.",
    },
    {
      place: "Cámara frigorífica 2",
      what: "Golpe en la espalda al resbalar en el suelo de la cámara.",
      causes: "Suelo con hielo en la entrada de la cámara.",
    },
  ],
  en: [
    {
      place: "Dispatch dock",
      what: "Sprained ankle stepping down from the loading dock with a pallet.",
      causes: "Unmarked step at the dock.",
    },
    {
      place: "Cutting room",
      what: "Cut on the forearm while handling a piece with a knife.",
      causes: "Worked without the chain mail sleeve.",
    },
    {
      place: "Cold room 2",
      what: "Back injury after slipping on the cold room floor.",
      causes: "Ice on the floor at the cold room entrance.",
    },
  ],
};

function apiOf(target: DemoIndicatorsTarget) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${target.base}/api/v1/w/${target.slug}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${target.token}` },
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

/** «YYYY-MM-01» `offset` months from this one. */
function monthFrom(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
}

interface Stat {
  month: string;
  hoursWorked: number | null;
  avgHeadcount: number | null;
}

export async function demoIndicators(
  target: DemoIndicatorsTarget,
): Promise<Record<string, number>> {
  const call = apiOf(target);
  const counts: Record<string, number> = {};
  const add = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const known = new Map<string, Stat>();
  const load = async (year: number, department: string | null) => {
    const query = department === null ? "" : `&department=${department}`;
    const { items } = await call<{ items: Stat[] }>(
      "GET",
      `/safety/indicators/stats?year=${String(year)}${query}`,
    );
    for (const item of items) known.set(`${department ?? ""}:${item.month}`, item);
  };
  const years = new Set([monthFrom(-13), monthFrom(0)].map((month) => Number(month.slice(0, 4))));
  for (const year of years) await load(year, null);
  // The company: ~42 people, ~160 hours each, a little different every month.
  for (let offset = -13; offset <= 0; offset++) {
    const month = monthFrom(offset);
    if (known.get(`:${month}`)?.hoursWorked != null) continue;
    const headcount = 40 + ((offset + 13) % 5);
    await call("PUT", "/safety/indicators/stats", {
      month,
      departmentId: null,
      hoursWorked: headcount * (150 + ((offset + 20) % 3) * 6),
      avgHeadcount: headcount,
    });
    add("company months");
  }
  // The first department (by name), this year.
  const department = await target.db.query<{ id: string }>(
    `SELECT d.id FROM "Department" d JOIN "Workspace" w ON w.id = d."workspaceId"
      WHERE w.slug = $1 ORDER BY d.name LIMIT 1`,
    [target.slug],
  );
  const departmentId = department.rows[0]?.id;
  if (departmentId !== undefined) {
    const year = Number(monthFrom(0).slice(0, 4));
    await load(year, departmentId);
    for (let offset = -11; offset <= 0; offset++) {
      const month = monthFrom(offset);
      if (!month.startsWith(String(year))) continue;
      if (known.get(`${departmentId}:${month}`)?.hoursWorked != null) continue;
      await call("PUT", "/safety/indicators/stats", {
        month,
        departmentId,
        hoursWorked: 15 * 158,
        avgHeadcount: 15,
      });
      add("department months");
    }
  }
  // Accidents with leave through the base form (only if the company has none).
  const existing = await target.db.query<{ count: string }>(
    `SELECT count(*) FROM "SafetyIncident" i JOIN "Workspace" w ON w.id = i."workspaceId"
      WHERE w.slug = $1 AND i.type = 'leave'`,
    [target.slug],
  );
  if (Number(existing.rows[0]?.count ?? 0) === 0) {
    const { form } = await call<{ form: { formId: string } | null }>(
      "GET",
      "/safety/incident-form",
    );
    const people = await target.db.query<{ id: string }>(
      `SELECT m.id FROM "Membership" m JOIN "Workspace" w ON w.id = m."workspaceId"
         JOIN "DepartmentMember" d ON d."membershipId" = m.id
        WHERE w.slug = $1 AND m.status = 'ACTIVE' ORDER BY m."createdAt", m.id LIMIT 3`,
      [target.slug],
    );
    if (form !== null) {
      const version = await target.db.query<{ currentVersion: number }>(
        `SELECT "currentVersion" FROM "Node" WHERE id = $1`,
        [form.formId],
      );
      const when = [-9, -4, -1];
      for (const [index, accident] of ACCIDENTS[target.locale].entries()) {
        const day = `${monthFrom(when[index] ?? -1).slice(0, 8)}${String(8 + index * 5).padStart(2, "0")}`;
        const person = people.rows[index % Math.max(1, people.rows.length)]?.id;
        await call("POST", `/forms/${form.formId}/records`, {
          version: version.rows[0]?.currentVersion ?? 1,
          answers: {
            sst_fecha: day,
            sst_hora: "09:15",
            sst_lugar: accident.place,
            ...(person === undefined ? {} : { sst_persona: person }),
            sst_tipo: "baja",
            sst_gravedad: "leve",
            sst_que: accident.what,
            sst_causas: accident.causes,
          },
        });
        add("accidents with leave");
      }
    }
  }
  // Days of leave of the accidents with leave that don't have them.
  const accidents = await target.db.query<{ id: string }>(
    `SELECT i.id FROM "SafetyIncident" i JOIN "Workspace" w ON w.id = i."workspaceId"
      WHERE w.slug = $1 AND i.type = 'leave' AND i."lostDays" IS NULL ORDER BY i."occurredOn"`,
    [target.slug],
  );
  for (const [index, row] of accidents.rows.entries()) {
    await call("PUT", `/safety/incidents/${row.id}/lost-days`, {
      lostDays: [12, 4, 27, 7][index % 4],
    });
    add("lost days");
  }
  return counts;
}
