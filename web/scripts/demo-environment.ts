// Demo data for the environment module (docs/spec/medio-ambiente.md) through the app's own API: the
// module on, permits and obligations, the meat industry's waste with a manager and a year of
// collections, a discharge permit with its limits and analyses (one out of limits), meters with a year of
// readings and production, and cooling units with their log. Used by capturas.ts (its *_capturas
// database). Idempotent: if the discharge permit is already there, nothing is done.
import { setTimeout as sleep } from "node:timers/promises";

export type EnvironmentLocale = "es" | "en";

export interface DemoEnvironmentTarget {
  base: string;
  /** The owner's token. */
  token: string;
  slug: string;
  locale: EnvironmentLocale;
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** «YYYY-MM» `back` months before the current one. */
function monthBack(back: number): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return date.toISOString().slice(0, 7);
}

const TEXTS = {
  es: {
    license: {
      name: "Licencia ambiental de la planta",
      authority: "Ayuntamiento de Vic",
      reference: "LA-2019-0042",
    },
    discharge: {
      name: "Vertido al colector municipal",
      authority: "Consorcio de aguas",
      reference: "VER-2024-0153",
    },
    sandach: { name: "Registro SANDACH", authority: "Generalitat", reference: "S08123456" },
    obligations: [
      { name: "Analítica de vertido", every: 3, due: 12 },
      { name: "Control de emisiones de la caldera", every: 36, due: 45 },
      { name: "Declaración anual de residuos", every: 12, due: 80 },
    ],
    manager: { name: "Reciclajes Costa SL", nima: "1700012345" },
    rendering: { name: "Transformados Cárnicos del Ter", nima: "0800098765" },
    carrier: { name: "Transportes Pla", nima: "1700054321" },
    point: "Arqueta final",
    lab: "Laboratorio Aigües",
    meters: [
      { name: "Agua de red", kind: "WATER_NETWORK", unit: "m³", base: 1800, perTonne: 6 },
      { name: "Electricidad", kind: "ELECTRICITY", unit: "kWh", base: 95000, perTonne: 320 },
      { name: "Gas natural", kind: "NATURAL_GAS", unit: "kWh", base: 42000, perTonne: 140 },
    ],
    units: [
      { name: "Cámara de producto fresco", location: "Nave 1", refrigerant: "R-404A", charge: 20 },
      { name: "Túnel de congelación", location: "Nave 2", refrigerant: "R-449A", charge: 45 },
      { name: "Sala de despiece", location: "Nave 1", refrigerant: "R-744", charge: 30 },
    ],
    installer: "Frío Industrial Girona",
  },
  en: {
    license: {
      name: "Plant environmental license",
      authority: "City council",
      reference: "EL-2019-0042",
    },
    discharge: {
      name: "Discharge to the municipal sewer",
      authority: "Water authority",
      reference: "DIS-2024-0153",
    },
    sandach: {
      name: "Animal by-products registration",
      authority: "Regional government",
      reference: "S08123456",
    },
    obligations: [
      { name: "Discharge analysis", every: 3, due: 12 },
      { name: "Boiler emissions check", every: 36, due: 45 },
      { name: "Annual waste declaration", every: 12, due: 80 },
    ],
    manager: { name: "Coast Recycling Ltd", nima: "1700012345" },
    rendering: { name: "Ter Meat Rendering", nima: "0800098765" },
    carrier: { name: "Pla Transport", nima: "1700054321" },
    point: "Final manhole",
    lab: "Water lab",
    meters: [
      { name: "Mains water", kind: "WATER_NETWORK", unit: "m³", base: 1800, perTonne: 6 },
      { name: "Electricity", kind: "ELECTRICITY", unit: "kWh", base: 95000, perTonne: 320 },
      { name: "Natural gas", kind: "NATURAL_GAS", unit: "kWh", base: 42000, perTonne: 140 },
    ],
    units: [
      {
        name: "Fresh product cold room",
        location: "Building 1",
        refrigerant: "R-404A",
        charge: 20,
      },
      { name: "Freezing tunnel", location: "Building 2", refrigerant: "R-449A", charge: 45 },
      { name: "Cutting room", location: "Building 1", refrigerant: "R-744", charge: 30 },
    ],
    installer: "Industrial Cooling Co.",
  },
} as const;

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

export async function demoEnvironment(target: DemoEnvironmentTarget): Promise<void> {
  const api = apiOf(target.base, target.slug, target.token);
  const t = TEXTS[target.locale];
  await api("PUT", "/admin/environment", { enabled: true });
  const existing = await api<{ permits: { name: string }[] }>("GET", "/environment/permits");
  if (existing.permits.some((permit) => permit.name === t.discharge.name)) return;

  // Permits and obligations.
  await api("POST", "/environment/permits", {
    kind: "ENVIRONMENTAL_LICENSE",
    ...t.license,
    issuedOn: "2019-05-10",
    reviewOn: day(40),
  });
  const discharge = await api<{ permit: { id: string } }>("POST", "/environment/permits", {
    kind: "DISCHARGE",
    ...t.discharge,
    issuedOn: "2024-03-15",
    expiresOn: day(420),
  });
  await api("POST", "/environment/permits", {
    kind: "SANDACH_REGISTRY",
    ...t.sandach,
    issuedOn: "2018-01-20",
  });
  for (const obligation of t.obligations) {
    await api("POST", "/environment/obligations", {
      name: obligation.name,
      everyMonths: obligation.every,
      nextDueOn: day(obligation.due),
      permitId: obligation.every === 3 ? discharge.permit.id : null,
    });
  }

  // Waste: the template, the companies and a year of collections.
  await api("POST", "/environment/wastes/template");
  const manager = await api<{ contractor: { id: string } }>("POST", "/environment/contractors", {
    name: t.manager.name,
    nima: t.manager.nima,
    authorizations: "G-1234 · T-5678",
    isManager: true,
    isCarrier: true,
    authorizationExpiresOn: day(25),
  });
  const rendering = await api<{ contractor: { id: string } }>("POST", "/environment/contractors", {
    name: t.rendering.name,
    nima: t.rendering.nima,
    authorizations: "SANDACH C3 · 08/123",
    isManager: true,
    isCarrier: false,
    authorizationExpiresOn: day(300),
  });
  const carrier = await api<{ contractor: { id: string } }>("POST", "/environment/contractors", {
    name: t.carrier.name,
    nima: t.carrier.nima,
    isManager: false,
    isCarrier: true,
  });
  const { wastes } = await api<{
    wastes: { id: string; name: string; ler: string; sandach: string | null; operation: string }[];
  }>("GET", "/environment/wastes");
  for (const waste of wastes) {
    const isSandach = waste.sandach !== null;
    await api("PUT", `/environment/wastes/${waste.id}`, {
      name: waste.name,
      ler: waste.ler,
      sandach: waste.sandach,
      operation: waste.operation,
      managerId: isSandach ? rendering.contractor.id : manager.contractor.id,
      carrierId: carrier.contractor.id,
      contractRef: isSandach ? "CT-2025-07" : "CT-2025-03",
      maxStorageMonths: null,
      storageSince: null,
    });
  }
  const byLer = (ler: string) => wastes.find((waste) => waste.ler === ler);
  const plan: { ler: string; every: number; quantity: number; unit: string }[] = [
    { ler: "020203", every: 7, quantity: 3200, unit: "KG" },
    { ler: "150101", every: 30, quantity: 850, unit: "KG" },
    { ler: "150102", every: 30, quantity: 420, unit: "KG" },
    { ler: "020204", every: 60, quantity: 12, unit: "T" },
    { ler: "130205*", every: 150, quantity: 180, unit: "L" },
  ];
  let doc = 1;
  for (const entry of plan) {
    const waste = byLer(entry.ler);
    if (waste === undefined) continue;
    for (let offset = entry.every; offset < 200; offset += entry.every) {
      await api("POST", "/environment/movements", {
        wasteId: waste.id,
        date: day(-offset),
        quantity: Math.round(entry.quantity * (0.85 + ((offset * 7) % 30) / 100)),
        unit: entry.unit,
        documentRef: `DI-${String(new Date().getFullYear())}-${String(doc).padStart(4, "0")}`,
        vehicle: "1234 KLM",
      });
      doc += 1;
    }
  }

  // Discharge: limits and four analyses, the last one out of limits.
  await api("PUT", `/environment/discharge/permits/${discharge.permit.id}/limits`, {
    limits: [
      { parameter: "DQO", unit: "mg/L O2", min: null, max: 1500 },
      { parameter: "DBO5", unit: "mg/L O2", min: null, max: 1000 },
      {
        parameter: target.locale === "es" ? "Sólidos en suspensión" : "Suspended solids",
        unit: "mg/L",
        min: null,
        max: 750,
      },
      {
        parameter: target.locale === "es" ? "Aceites y grasas" : "Oils and fats",
        unit: "mg/L",
        min: null,
        max: 150,
      },
      { parameter: "pH", unit: "", min: 6, max: 9 },
    ],
  });
  const samples = [
    { offset: 270, dqo: 1120, dbo: 640, ss: 410, ag: 95, ph: 7.4 },
    { offset: 180, dqo: 1310, dbo: 720, ss: 520, ag: 110, ph: 7.1 },
    { offset: 90, dqo: 1240, dbo: 690, ss: 480, ag: 132, ph: 7.6 },
    { offset: 8, dqo: 1780, dbo: 940, ss: 610, ag: 168, ph: 6.8 },
  ];
  for (const sample of samples) {
    await api("POST", "/environment/discharge/samples", {
      permitId: discharge.permit.id,
      takenOn: day(-sample.offset),
      point: t.point,
      laboratory: t.lab,
      values: [
        { parameter: "DQO", value: sample.dqo },
        { parameter: "DBO5", value: sample.dbo },
        {
          parameter: target.locale === "es" ? "Sólidos en suspensión" : "Suspended solids",
          value: sample.ss,
        },
        {
          parameter: target.locale === "es" ? "Aceites y grasas" : "Oils and fats",
          value: sample.ag,
        },
        { parameter: "pH", value: sample.ph },
      ],
    });
  }

  // Consumption: twelve months of production and readings, this year and the one before.
  const year = new Date().getFullYear();
  for (let back = 23; back >= 1; back -= 1) {
    const month = monthBack(back);
    const season = 1 + 0.12 * Math.sin((Number(month.slice(5)) / 12) * Math.PI * 2);
    await api("PUT", "/environment/production", {
      month,
      tonnes: Math.round(300 * season * (back > 12 ? 0.95 : 1)),
    });
  }
  for (const meter of t.meters) {
    const created = await api<{ meter: { id: string } }>("POST", "/environment/meters", {
      name: meter.name,
      kind: meter.kind,
      unit: meter.unit,
    });
    let reading = meter.base * 10;
    for (let back = 24; back >= 1; back -= 1) {
      const month = monthBack(back);
      const season = 1 + 0.15 * Math.sin((Number(month.slice(5)) / 12) * Math.PI * 2);
      reading += Math.round(meter.base * season * (back > 12 ? 1.06 : 1));
      await api("PUT", "/environment/readings", {
        meterId: created.meter.id,
        month,
        reading,
        consumption: back === 24 ? Math.round(meter.base * season) : null,
      });
    }
    await api("PUT", "/environment/targets", {
      meterId: created.meter.id,
      year,
      perTonne: meter.perTonne,
    });
  }

  // Cooling units and their log.
  for (const [index, unit] of t.units.entries()) {
    const created = await api<{ unit: { id: string } }>("POST", "/environment/cooling/units", {
      name: unit.name,
      location: unit.location,
      refrigerant: unit.refrigerant,
      chargeKg: unit.charge,
      leakDetection: index === 1,
      installer: t.installer,
      installedOn: "2017-04-01",
    });
    if (unit.refrigerant === "R-744") continue;
    await api("POST", "/environment/cooling/events", {
      unitId: created.unit.id,
      date: day(index === 0 ? -170 : -60),
      kind: "LEAK_CHECK",
      leakFound: false,
      company: t.installer,
      certificateRef: `CF-${String(100 + index)}`,
    });
    if (index === 0) {
      await api("POST", "/environment/cooling/events", {
        unitId: created.unit.id,
        date: day(-120),
        kind: "RECHARGE",
        kgAdded: 2.5,
        company: t.installer,
        certificateRef: "CF-099",
      });
    }
  }
}
