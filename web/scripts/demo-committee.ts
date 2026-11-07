// Demo data for the health and safety committee (docs/spec/seguridad-salud.md, «Consulta y
// participación») through the app's own API: members with their roles and terms (one delegate's term
// ends soon), three meetings (two ordinary, one extraordinary), the minutes of the ordinary ones created
// from the template, and the last meeting's agreements as planning measures. Used by capturas.ts and
// by a local script on the development database. Idempotent: a company that already has meetings is
// left as it is.
import { setTimeout as sleep } from "node:timers/promises";

export interface DemoCommitteeTarget {
  base: string;
  /** An owner's token (safety.manage). */
  token: string;
  slug: string;
  locale: "es" | "en";
  /**
   * People for the committee, in order: a delegate whose term ends soon, another delegate, the company
   * representative; then, if there are more in the company, an adviser and a secretary.
   */
  peopleEmails: string[];
}

type Role = "DELEGATE" | "COMPANY_REP" | "ADVISOR" | "SECRETARY";

const TEXTS: Record<
  "es" | "en",
  {
    meetings: { daysAgo: number; kind: "ORDINARY" | "EXTRAORDINARY"; agenda: string[] }[];
    agreements: { description: string; priority: "HIGH" | "MEDIUM" | "LOW"; done: boolean }[];
  }
> = {
  es: {
    meetings: [
      {
        daysAgo: 100,
        kind: "ORDINARY",
        agenda: [
          "Seguimiento de la planificación preventiva",
          "Resultados de la inspección mensual",
          "Ruegos y preguntas",
        ],
      },
      {
        daysAgo: 48,
        kind: "EXTRAORDINARY",
        agenda: ["Análisis del corte en la sala de despiece", "Uso del manguito de malla"],
      },
      {
        daysAgo: 12,
        kind: "ORDINARY",
        agenda: [
          "Simulacro de fuga de amoníaco: conclusiones",
          "Revisión de los EPIs de las cámaras frigoríficas",
          "Calendario de formación del trimestre",
        ],
      },
    ],
    agreements: [
      {
        description: "Repetir el simulacro de fuga de amoníaco en el turno de noche.",
        priority: "HIGH",
        done: false,
      },
      {
        description: "Cambiar los guantes térmicos de la cámara 2 por un modelo con mejor agarre.",
        priority: "MEDIUM",
        done: false,
      },
      {
        description: "Publicar el calendario de formación del trimestre en el tablón.",
        priority: "LOW",
        done: true,
      },
    ],
  },
  en: {
    meetings: [
      {
        daysAgo: 100,
        kind: "ORDINARY",
        agenda: [
          "Follow-up of the preventive planning",
          "Monthly inspection results",
          "Any other business",
        ],
      },
      {
        daysAgo: 48,
        kind: "EXTRAORDINARY",
        agenda: ["Review of the cut in the cutting room", "Use of the chain mail sleeve"],
      },
      {
        daysAgo: 12,
        kind: "ORDINARY",
        agenda: [
          "Ammonia leak drill: conclusions",
          "Review of the cold room PPE",
          "This quarter's training calendar",
        ],
      },
    ],
    agreements: [
      {
        description: "Repeat the ammonia leak drill on the night shift.",
        priority: "HIGH",
        done: false,
      },
      {
        description: "Replace the thermal gloves in cold room 2 with a model with better grip.",
        priority: "MEDIUM",
        done: false,
      },
      {
        description: "Post this quarter's training calendar on the notice board.",
        priority: "LOW",
        done: true,
      },
    ],
  },
};

function apiOf(target: DemoCommitteeTarget) {
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

/** «YYYY-MM-DD» `days` days from today (UTC; negative is the past). */
function dayFrom(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export async function demoCommittee(target: DemoCommitteeTarget): Promise<Record<string, number>> {
  const call = apiOf(target);
  const t = TEXTS[target.locale];
  const counts: Record<string, number> = {};
  const add = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const existing = await call<{ items: unknown[] }>("GET", "/safety/meetings?pageSize=1");
  if (existing.items.length > 0) return counts;

  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const named = target.peopleEmails
    .map((email) => members.items.find((item) => item.email === email)?.id)
    .filter((id): id is string => id !== undefined);
  if (named.length === 0) throw new Error("No people for the committee demo");
  const others = members.items
    .filter((item) => item.email !== null && !named.includes(item.id))
    .slice(0, 2)
    .map((item) => item.id);
  const roles: { role: Role; termStart: string; termEnd: string | null }[] = [
    { role: "DELEGATE", termStart: dayFrom(-1420), termEnd: dayFrom(40) },
    { role: "DELEGATE", termStart: dayFrom(-300), termEnd: dayFrom(1160) },
    { role: "COMPANY_REP", termStart: dayFrom(-300), termEnd: null },
    { role: "ADVISOR", termStart: dayFrom(-300), termEnd: null },
    { role: "SECRETARY", termStart: dayFrom(-300), termEnd: null },
  ];
  const plan = roles.flatMap((row, index) => {
    const membershipId = [...named, ...others][index];
    return membershipId === undefined ? [] : [{ ...row, membershipId }];
  });

  const { committee } = await call<{
    committee: { members: { id: string; person: { id: string } }[] };
  }>("GET", "/safety/committee");
  for (const row of plan) {
    if (committee.members.some((member) => member.person.id === row.membershipId)) continue;
    await call("POST", "/safety/committee/members", row);
    add("members");
  }
  const { committee: after } = await call<{
    committee: { members: { id: string }[] };
  }>("GET", "/safety/committee");
  const attendeeIds = after.members.map((member) => member.id);

  let last: string | undefined;
  for (const meeting of t.meetings) {
    const { meeting: created } = await call<{ meeting: { id: string } }>(
      "POST",
      "/safety/meetings",
      {
        date: dayFrom(-meeting.daysAgo),
        kind: meeting.kind,
        // At the extraordinary one, only the delegates and the company.
        attendeeIds: meeting.kind === "ORDINARY" ? attendeeIds : attendeeIds.slice(0, 3),
        agenda: meeting.agenda.join("\n"),
      },
    );
    add("meetings");
    if (meeting.kind === "ORDINARY") {
      await call("POST", `/safety/meetings/${created.id}/minutes`);
      add("minutes");
    }
    last = created.id;
  }
  if (last !== undefined) {
    for (const [index, agreement] of t.agreements.entries()) {
      const { action } = await call<{ action: { id: string } }>("POST", "/safety/planning", {
        origin: "COMMITTEE",
        meetingId: last,
        description: agreement.description,
        responsibleId: named[index % named.length],
        dueOn: dayFrom(20 + index * 15),
        priority: agreement.priority,
        estimatedCost: null,
      });
      add("agreements");
      if (agreement.done) {
        await call("POST", `/safety/actions/${action.id}/done`, {});
        add("agreements done");
      }
    }
  }
  return counts;
}
