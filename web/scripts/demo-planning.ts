// Demo data for the planning of the preventive activity (docs/spec/seguridad-salud.md, «Planificación»)
// through the app's own API: measures from a risk assessment (an EVR document, created if the company
// has none), from a non-conforming inspection record (if there's one), and others; one overdue and one
// done. Used by capturas.ts (its *_capturas database) and by a local script on the development
// database. Idempotent: if its first measure is already there, nothing is done.
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";

export type PlanningLocale = "es" | "en";

export interface DemoPlanningTarget {
  base: string;
  token: string;
  slug: string;
  locale: PlanningLocale;
  db: pg.Client;
  /** Emails of the people the measures go to. */
  responsibleEmails: string[];
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface Plan {
  origin: "RISK_ASSESSMENT" | "INSPECTION" | "OTHER";
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** Cents. */
  cost: number | null;
  due: number;
  done?: true;
}

const TEXTS: Record<PlanningLocale, { evr: { name: string; text: string }; plans: Plan[] }> = {
  es: {
    evr: {
      name: "Evaluación de riesgos · Sala de despiece",
      text: "Riesgos de corte con sierra de cinta y cuchillos, sobreesfuerzos al mover canales y frío.",
    },
    plans: [
      {
        origin: "RISK_ASSESSMENT",
        description:
          "Instalar una protección regulable en la sierra de cinta de la sala de despiece",
        priority: "HIGH",
        cost: 185_000,
        due: 21,
      },
      {
        origin: "RISK_ASSESSMENT",
        description: "Poner un polipasto para mover las canales y evitar sobreesfuerzos",
        priority: "MEDIUM",
        cost: 420_000,
        due: 75,
      },
      {
        origin: "INSPECTION",
        description: "Reponer el extintor que faltaba en el muelle de expedición",
        priority: "HIGH",
        cost: 9_500,
        due: -3,
      },
      {
        origin: "OTHER",
        description: "Señalizar el paso de carretillas frente a las cámaras frigoríficas",
        priority: "MEDIUM",
        cost: 35_000,
        due: 30,
      },
      {
        origin: "OTHER",
        description: "Revisar el contenido de los botiquines de planta",
        priority: "LOW",
        cost: null,
        due: -10,
        done: true,
      },
    ],
  },
  en: {
    evr: {
      name: "Risk assessment · Cutting room",
      text: "Cut risks from the band saw and knives, strain from moving carcasses, and cold.",
    },
    plans: [
      {
        origin: "RISK_ASSESSMENT",
        description: "Fit an adjustable guard on the cutting room band saw",
        priority: "HIGH",
        cost: 185_000,
        due: 21,
      },
      {
        origin: "RISK_ASSESSMENT",
        description: "Install a hoist to move carcasses and avoid strain",
        priority: "MEDIUM",
        cost: 420_000,
        due: 75,
      },
      {
        origin: "INSPECTION",
        description: "Replace the missing extinguisher at the dispatch dock",
        priority: "HIGH",
        cost: 9_500,
        due: -3,
      },
      {
        origin: "OTHER",
        description: "Mark the forklift crossing in front of the cold rooms",
        priority: "MEDIUM",
        cost: 35_000,
        due: 30,
      },
      {
        origin: "OTHER",
        description: "Check the contents of the plant's first aid kits",
        priority: "LOW",
        cost: null,
        due: -10,
        done: true,
      },
    ],
  },
};

function apiOf(target: DemoPlanningTarget) {
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

export async function demoPlanning(target: DemoPlanningTarget): Promise<Record<string, number>> {
  const call = apiOf(target);
  const t = TEXTS[target.locale];
  const counts: Record<string, number> = {};
  const first = t.plans[0];
  const { rows: existing } = await target.db.query<{ id: string }>(
    `SELECT a.id FROM "SafetyAction" a JOIN "Workspace" w ON w.id = a."workspaceId"
      WHERE w.slug = $1 AND a.description = $2 LIMIT 1`,
    [target.slug, first?.description ?? ""],
  );
  if (existing.length > 0) return counts;

  const members = await call<{ items: { id: string; email: string | null }[] }>(
    "GET",
    "/admin/members?pageSize=100",
  );
  const responsibles = target.responsibleEmails
    .map((email) => members.items.find((item) => item.email === email)?.id)
    .filter((id): id is string => id !== undefined);
  if (responsibles.length === 0) throw new Error("No responsible people for the planning demo");

  // The EVR document: the company's first one, or a new page in the module's space.
  const evr = await target.db.query<{ nodeId: string }>(
    `SELECT c."nodeId" FROM "ControlledDocument" c JOIN "Workspace" w ON w.id = c."workspaceId"
       JOIN "Node" n ON n.id = c."nodeId"
      WHERE w.slug = $1 AND c."docType" = 'EVR' AND n."trashedAt" IS NULL
      ORDER BY c."createdAt" LIMIT 1`,
    [target.slug],
  );
  let evrNodeId = evr.rows[0]?.nodeId;
  if (evrNodeId === undefined) {
    const { safety } = await call<{ safety: { space: { id: string } | null } }>(
      "GET",
      "/admin/safety",
    );
    if (safety.space !== null) {
      const { page } = await call<{ page: { node: { id: string } } }>(
        "POST",
        `/spaces/${safety.space.id}/pages`,
        {
          name: t.evr.name,
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: t.evr.text }] }],
          },
        },
      );
      await call("POST", `/nodes/${page.node.id}/controlled`, { docType: "EVR" });
      evrNodeId = page.node.id;
      counts["evr documents"] = 1;
    }
  }
  // A non-conforming inspection record, if the company has one.
  const record = await target.db.query<{ id: string }>(
    `SELECT r.id FROM "FormRecord" r JOIN "Workspace" w ON w.id = r."workspaceId"
      WHERE w.slug = $1 AND r."voidedAt" IS NULL AND cardinality(r."nonConforming") > 0
      ORDER BY r."submittedAt" DESC LIMIT 1`,
    [target.slug],
  );
  const recordId = record.rows[0]?.id;

  for (const [index, plan] of t.plans.entries()) {
    const reference =
      plan.origin === "RISK_ASSESSMENT"
        ? evrNodeId === undefined
          ? null
          : { origin: plan.origin, nodeId: evrNodeId }
        : plan.origin === "INSPECTION"
          ? recordId === undefined
            ? null
            : { origin: plan.origin, recordId }
          : { origin: plan.origin };
    if (reference === null) continue;
    const { action } = await call<{ action: { id: string } }>("POST", "/safety/planning", {
      ...reference,
      description: plan.description,
      responsibleId: responsibles[index % responsibles.length],
      dueOn: day(plan.due),
      priority: plan.priority,
      estimatedCost: plan.cost,
    });
    counts[`actions ${plan.origin}`] = (counts[`actions ${plan.origin}`] ?? 0) + 1;
    if (plan.done === true) {
      await call("POST", `/safety/actions/${action.id}/done`, {});
      counts["actions done"] = (counts["actions done"] ?? 0) + 1;
    }
  }
  return counts;
}
