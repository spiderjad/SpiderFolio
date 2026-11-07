// Demo data for emergencies and drills (docs/spec/seguridad-salud.md, «Emergencias y simulacros»)
// through the app's own API: the emergency plan as a controlled PEM page, people in the emergency
// team's default roles (one role requires the company's first course), three drills (an ammonia leak,
// an evacuation and a fire) and a measure from the last one. Used by capturas.ts and by a local script
// on the development database. Idempotent: a company that already has drills is left as it is.
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";

export interface DemoEmergenciesTarget {
  base: string;
  /** An owner's token (safety.manage). */
  token: string;
  slug: string;
  locale: "es" | "en";
  db: pg.Client;
  /** People to put in the team, in order (the first one also owns the drill's measure). */
  peopleEmails: string[];
}

type Scenario = "FIRE" | "EVACUATION" | "SPILL" | "AMMONIA" | "OTHER";

interface DrillDemo {
  daysAgo: number;
  scenario: Scenario;
  area: string;
  announced: boolean;
  participants: number;
  evacuationSeconds: number;
  incidents: string | null;
  observers: string;
}

const TEXTS: Record<
  "es" | "en",
  {
    plan: { name: string; text: string };
    locations: string[];
    drills: DrillDemo[];
    measure: string;
  }
> = {
  es: {
    plan: {
      name: "Plan de emergencia y evacuación",
      text: "Organización de la respuesta ante incendio, fuga de amoníaco, derrame y evacuación de la planta.",
    },
    locations: ["Turno de mañana", "Turno de tarde", "Sala de máquinas"],
    drills: [
      {
        daysAgo: 420,
        scenario: "FIRE",
        area: "Almacén de embalaje",
        announced: true,
        participants: 38,
        evacuationSeconds: 312,
        incidents: null,
        observers: "Bomberos voluntarios del polígono",
      },
      {
        daysAgo: 200,
        scenario: "EVACUATION",
        area: "Toda la planta",
        announced: true,
        participants: 41,
        evacuationSeconds: 275,
        incidents: "Dos personas de mantenimiento fueron al punto de reunión equivocado.",
        observers: "Servicio de prevención ajeno",
      },
      {
        daysAgo: 35,
        scenario: "AMMONIA",
        area: "Sala de máquinas de frío",
        announced: false,
        participants: 40,
        evacuationSeconds: 248,
        incidents:
          "La alarma de la sala de máquinas no se oyó en la cámara frigorífica 2. El equipo de segunda intervención tardó en encontrar los equipos de respiración autónomos.",
        observers: "Técnico de la empresa de mantenimiento de frío",
      },
    ],
    measure:
      "Instalar una sirena y una luz de alarma de amoníaco dentro de la cámara frigorífica 2.",
  },
  en: {
    plan: {
      name: "Emergency and evacuation plan",
      text: "How the plant responds to a fire, an ammonia leak, a spill and an evacuation.",
    },
    locations: ["Morning shift", "Afternoon shift", "Engine room"],
    drills: [
      {
        daysAgo: 420,
        scenario: "FIRE",
        area: "Packaging warehouse",
        announced: true,
        participants: 38,
        evacuationSeconds: 312,
        incidents: null,
        observers: "Local fire brigade",
      },
      {
        daysAgo: 200,
        scenario: "EVACUATION",
        area: "Whole plant",
        announced: true,
        participants: 41,
        evacuationSeconds: 275,
        incidents: "Two maintenance workers went to the wrong assembly point.",
        observers: "External prevention service",
      },
      {
        daysAgo: 35,
        scenario: "AMMONIA",
        area: "Refrigeration engine room",
        announced: false,
        participants: 40,
        evacuationSeconds: 248,
        incidents:
          "The engine room alarm couldn't be heard in cold room 2. The second response team took long to find the breathing apparatus.",
        observers: "Refrigeration maintenance contractor",
      },
    ],
    measure: "Fit an ammonia alarm siren and light inside cold room 2.",
  },
};

function apiOf(target: DemoEmergenciesTarget) {
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
      const text = await res.text();
      return (text === "" ? undefined : JSON.parse(text)) as T;
    }
    throw new Error(`${method} ${path}: too many retries`);
  };
}

/** «YYYY-MM-DD» `days` days ago (UTC). */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

interface Team {
  roles: {
    id: string;
    course: { id: string } | null;
    members: { person: { id: string } }[];
  }[];
  plan: { id: string } | null;
}

export async function demoEmergencies(
  target: DemoEmergenciesTarget,
): Promise<Record<string, number>> {
  const call = apiOf(target);
  const t = TEXTS[target.locale];
  const counts: Record<string, number> = {};
  const add = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const drills = await call<{ items: unknown[] }>("GET", "/safety/drills?pageSize=1");
  if (drills.items.length > 0) return counts;

  // Opening the team also creates the PEM type and the default roles in a company that had the
  // module on before this phase.
  const { team } = await call<{ team: Team }>("GET", "/safety/emergencies");

  // The emergency plan, as a controlled PEM page in the module's space.
  if (team.plan === null) {
    const { safety } = await call<{ safety: { space: { id: string } | null } }>(
      "GET",
      "/admin/safety",
    );
    if (safety.space !== null) {
      const { page } = await call<{ page: { node: { id: string } } }>(
        "POST",
        `/spaces/${safety.space.id}/pages`,
        {
          name: t.plan.name,
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: t.plan.text }] }],
          },
        },
      );
      await call("POST", `/nodes/${page.node.id}/controlled`, { docType: "PEM" });
      add("plan");
    }
  }

  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const people = target.peopleEmails
    .map((email) => members.items.find((item) => item.email === email)?.id)
    .filter((id): id is string => id !== undefined);
  if (people.length === 0) throw new Error("No people for the emergencies demo");

  // The first-response team requires the company's first course: whoever lacks it shows up.
  const courses = await call<{ items: { id: string }[] }>("GET", "/safety/courses?pageSize=1");
  const firstResponse = team.roles[2];
  const course = courses.items[0];
  if (firstResponse !== undefined && firstResponse.course === null && course !== undefined) {
    await call("PATCH", `/safety/emergencies/roles/${firstResponse.id}`, { courseId: course.id });
    add("role courses");
  }
  // Each person in two roles at most, spread over the first roles.
  for (const [index, role] of team.roles.slice(0, 4).entries()) {
    const person = people[index % people.length];
    if (person === undefined || role.members.some((m) => m.person.id === person)) continue;
    await call("POST", `/safety/emergencies/roles/${role.id}/members`, {
      membershipId: person,
      location: t.locations[index % t.locations.length] ?? null,
    });
    add("members");
  }

  let last: string | undefined;
  for (const drill of t.drills) {
    const { daysAgo: ago, ...rest } = drill;
    const created = await call<{ drill: { id: string } }>("POST", "/safety/drills", {
      ...rest,
      date: daysAgo(ago),
    });
    last = created.drill.id;
    add("drills");
  }
  if (last !== undefined) {
    await call("POST", "/safety/planning", {
      origin: "DRILL",
      drillId: last,
      description: t.measure,
      responsibleId: people[0],
      dueOn: daysAgo(-30),
      priority: "HIGH",
      estimatedCost: 85_000,
    });
    add("actions DRILL");
  }
  return counts;
}
