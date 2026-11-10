// Demo data for the maintenance module (docs/spec/mantenimiento.md) through the app's own API: the module
// on, a line with its machines, a cold room and a scale, the warehouse's catalogue (through the SGA
// integration API, with a token), preventive and calibration plans with a meter, and work orders in every
// state (reported, in progress, closed with their time, parts and hygiene release) so the summary has
// figures. Used by capturas.ts (its *_capturas database). Idempotent: if the filler is already there, it
// only finds the ids the captures need.
import { setTimeout as sleep } from "node:timers/promises";

export type MaintenanceLocale = "es" | "en";

export interface DemoMaintenanceTarget {
  base: string;
  /** The owner's token. */
  token: string;
  slug: string;
  locale: MaintenanceLocale;
}

/** The ids the captures open. */
export interface DemoMaintenanceIds {
  /** The urgent breakdown, in progress (the work order's screen). */
  urgent: string;
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const TEXTS = {
  es: {
    line: { code: "L1", name: "Línea 1 · Embutidos", location: "Nave 1" },
    filler: { code: "EMB-02", name: "Embutidora 2" },
    clipper: { code: "CLI-01", name: "Clipadora 1" },
    room: { code: "CAM-1", name: "Cámara 1", location: "Nave 1" },
    dryer: { code: "SEC-2", name: "Secadero 2", location: "Nave 2" },
    scale: { code: "BAS-01", name: "Báscula de expedición", location: "Expediciones" },
    hours: { name: "Horas de funcionamiento", unit: "h" },
    parts: [
      {
        code: "RET-0042",
        description: "Retén de la bomba de vacío",
        unit: "ud",
        stock: 3,
        minStock: 2,
        location: "Estante B4",
      },
      {
        code: "ROD-6204",
        description: "Rodamiento 6204 2RS",
        unit: "ud",
        stock: 12,
        minStock: 4,
        location: "Estante A1",
      },
      {
        code: "GRA-H1",
        description: "Grasa alimentaria H1",
        unit: "kg",
        stock: 5,
        minStock: 1,
        location: "Armario de lubricantes",
      },
      {
        code: "SON-PT100",
        description: "Sonda PT100 de cámara",
        unit: "ud",
        stock: 1,
        minStock: 2,
        location: "Estante C2",
      },
    ],
    plans: {
      grease: {
        name: "Engrase de la embutidora",
        steps: [
          "Consignar la máquina",
          "Engrasar los puntos 1 a 8 con grasa H1",
          "Revisar la correa del motor",
        ],
      },
      overhaul: {
        name: "Revisión general de la embutidora",
        steps: ["Cambiar los retenes de la bomba", "Revisar la presión de vacío"],
      },
      scale: {
        name: "Calibración de la báscula",
        steps: ["Pesas patrón de 1, 5 y 20 kg", "Anotar el certificado"],
      },
      probes: {
        name: "Calibración de las sondas de la cámara 1",
        steps: ["Comparar con el termómetro patrón", "Ajustar si se desvía más de 0,5 °C"],
      },
    },
    urgent: {
      title: "Embutidora 2: pierde presión de vacío",
      description:
        "Desde esta mañana pierde presión y hace un ruido en la bomba. La línea va a media velocidad.",
    },
    clip: {
      title: "Clipadora 1: se atasca el clip",
      description: "Cada 20 o 30 piezas se atasca y hay que abrirla.",
    },
    lights: {
      title: "Cambiar los fluorescentes de la nave 2 por LED",
      description: "Mejora: menos consumo y sin cristal en la zona de producto.",
    },
    room1: {
      title: "Cámara 1: no baja de 6 °C",
      description: "El registro de temperatura salió fuera de límite.",
      cause: "Ventilador del evaporador bloqueado por hielo.",
      solution:
        "Desescarche manual, limpieza del evaporador y comprobación del ventilador. Vuelve a 2 °C en una hora.",
    },
    noise: {
      title: "Embutidora 2: ruido en la bomba",
      description: "Ruido metálico al arrancar.",
      cause: "Rodamiento del motor gastado.",
      solution: "Cambiado el rodamiento y probado con producto.",
    },
  },
  en: {
    line: { code: "L1", name: "Line 1 · Sausages", location: "Building 1" },
    filler: { code: "EMB-02", name: "Filler 2" },
    clipper: { code: "CLI-01", name: "Clipper 1" },
    room: { code: "CAM-1", name: "Cold room 1", location: "Building 1" },
    dryer: { code: "SEC-2", name: "Dryer 2", location: "Building 2" },
    scale: { code: "BAS-01", name: "Dispatch scale", location: "Dispatch" },
    hours: { name: "Operating hours", unit: "h" },
    parts: [
      {
        code: "RET-0042",
        description: "Vacuum pump seal",
        unit: "pc",
        stock: 3,
        minStock: 2,
        location: "Shelf B4",
      },
      {
        code: "ROD-6204",
        description: "Bearing 6204 2RS",
        unit: "pc",
        stock: 12,
        minStock: 4,
        location: "Shelf A1",
      },
      {
        code: "GRA-H1",
        description: "H1 food-grade grease",
        unit: "kg",
        stock: 5,
        minStock: 1,
        location: "Lubricants cabinet",
      },
      {
        code: "SON-PT100",
        description: "PT100 cold room probe",
        unit: "pc",
        stock: 1,
        minStock: 2,
        location: "Shelf C2",
      },
    ],
    plans: {
      grease: {
        name: "Greasing the filler",
        steps: [
          "Lock out the machine",
          "Grease points 1 to 8 with H1 grease",
          "Check the motor belt",
        ],
      },
      overhaul: {
        name: "Filler overhaul",
        steps: ["Replace the pump seals", "Check the vacuum pressure"],
      },
      scale: {
        name: "Scale calibration",
        steps: ["1, 5 and 20 kg test weights", "Write down the certificate"],
      },
      probes: {
        name: "Cold room 1 probes calibration",
        steps: ["Compare with the reference thermometer", "Adjust if it's off by more than 0.5 °C"],
      },
    },
    urgent: {
      title: "Filler 2: losing vacuum pressure",
      description:
        "Since this morning it loses pressure and the pump makes a noise. The line runs at half speed.",
    },
    clip: {
      title: "Clipper 1: the clip jams",
      description: "Every 20 or 30 pieces it jams and has to be opened.",
    },
    lights: {
      title: "Replace building 2's fluorescent tubes with LED",
      description: "Improvement: less energy and no glass in the product zone.",
    },
    room1: {
      title: "Cold room 1: won't go below 6 °C",
      description: "The temperature record was out of limits.",
      cause: "Evaporator fan blocked by ice.",
      solution: "Manual defrost, evaporator cleaned and fan checked. Back to 2 °C in an hour.",
    },
    noise: {
      title: "Filler 2: noise in the pump",
      description: "Metallic noise on starting.",
      cause: "Worn motor bearing.",
      solution: "Bearing replaced and tested with product.",
    },
  },
} as const;

function apiOf(base: string, slug: string, token: string) {
  return async <T>(method: string, path: string, body?: unknown, raw = false): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(raw ? `${base}${path}` : `${base}/api/v1/w/${slug}${path}`, {
        method,
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
        },
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

interface Asset {
  id: string;
  code: string;
}
interface WorkOrder {
  id: string;
  title: string;
}

export async function demoMaintenance(target: DemoMaintenanceTarget): Promise<DemoMaintenanceIds> {
  const api = apiOf(target.base, target.slug, target.token);
  const t = TEXTS[target.locale];
  await api("PUT", "/admin/maintenance", { enabled: true });
  const found = await api<{ items: WorkOrder[] }>(
    "GET",
    `/maintenance/work-orders?q=${encodeURIComponent(t.urgent.title)}`,
  );
  const done = found.items.find((order) => order.title === t.urgent.title);
  if (done !== undefined) return { urgent: done.id };
  const existing = await api<{ assets: Asset[] }>("GET", "/maintenance/assets");

  // Equipment: a line with its machines, a cold room, a dryer and a scale.
  const asset = async (input: Record<string, unknown> & { code: string }) =>
    existing.assets.find((item) => item.code === input.code) ??
    (await api<{ asset: Asset }>("POST", "/maintenance/assets", input)).asset;
  const line = await asset({ ...t.line, criticality: "A" });
  const filler = await asset({
    ...t.filler,
    parentId: line.id,
    location: t.line.location,
    manufacturer: "Handtmann",
    model: "VF 608",
    criticality: "A",
    foodContact: true,
  });
  const clipper = await asset({
    ...t.clipper,
    parentId: line.id,
    location: t.line.location,
    manufacturer: "Poly-clip",
    criticality: "B",
    foodContact: true,
  });
  const room = await asset({ ...t.room, criticality: "A", foodContact: true });
  await asset({ ...t.dryer, criticality: "A", foodContact: true });
  const scale = await asset({ ...t.scale, criticality: "B" });

  // The warehouse's catalogue, as the SGA would send it (an integration token).
  const created = await api<{ token: string }>("POST", "/admin/maintenance/tokens", {
    name: "SGA",
    scopes: ["parts.write", "consumption.read"],
  });
  const sga = apiOf(target.base, target.slug, created.token);
  await sga("PUT", "/api/v1/integrations/maintenance/parts", { parts: t.parts }, true);

  // Preventive and calibration plans, and the filler's meter.
  const technicians = await api<{ technicians: { id: string }[] }>(
    "GET",
    "/maintenance/technicians",
  );
  const me = technicians.technicians[0]?.id ?? null;
  const meters = await api<{ meters: { id: string; name: string }[] }>(
    "GET",
    "/maintenance/meters",
  );
  const meter = {
    meter:
      meters.meters.find((item) => item.name === t.hours.name) ??
      (
        await api<{ meter: { id: string } }>("POST", "/maintenance/meters", {
          assetId: filler.id,
          ...t.hours,
        })
      ).meter,
  };
  if (!meters.meters.some((item) => item.name === t.hours.name)) {
    await api("POST", `/maintenance/meters/${meter.meter.id}/readings`, { value: 1180 });
  }
  const plans = await api<{ plans: { name: string }[] }>("GET", "/maintenance/plans");
  const plan = async (input: Record<string, unknown> & { name: string }) => {
    if (!plans.plans.some((item) => item.name === input.name)) {
      await api("POST", "/maintenance/plans", input);
    }
  };
  await plan({
    assetId: filler.id,
    name: t.plans.grease.name,
    checklist: t.plans.grease.steps,
    every: 2,
    everyUnit: "WEEKS",
    firstDueOn: day(2),
    assignedToId: me,
    estimatedMinutes: 30,
    lockout: true,
  });
  await plan({
    assetId: filler.id,
    name: t.plans.overhaul.name,
    checklist: t.plans.overhaul.steps,
    meterId: meter.meter.id,
    meterEvery: 500,
    firstMeterAt: 1500,
    assignedToId: me,
    estimatedMinutes: 120,
  });
  await plan({
    assetId: scale.id,
    kind: "CALIBRATION",
    name: t.plans.scale.name,
    checklist: t.plans.scale.steps,
    every: 12,
    everyUnit: "MONTHS",
    firstDueOn: day(40),
  });
  await plan({
    assetId: room.id,
    kind: "CALIBRATION",
    name: t.plans.probes.name,
    checklist: t.plans.probes.steps,
    every: 6,
    everyUnit: "MONTHS",
    firstDueOn: day(-3),
    assignedToId: me,
  });

  // Work orders in every state.
  const act = (id: string, body: Record<string, unknown>) =>
    api("POST", `/maintenance/work-orders/${id}/actions`, body);
  const report = async (input: Record<string, unknown>) =>
    (await api<{ workOrder: WorkOrder }>("POST", "/maintenance/reports", input)).workOrder;
  const closed = async (
    texts: { title: string; description: string; cause: string; solution: string },
    assetId: string,
    minutes: number,
    downtime: number,
    part: (typeof t.parts)[number],
  ) => {
    const order = await report({
      title: texts.title,
      description: texts.description,
      assetId,
      priority: "HIGH",
    });
    await act(order.id, { action: "take" });
    await act(order.id, { action: "start" });
    await act(order.id, { action: "stop", note: "" });
    await act(order.id, { action: "labor", minutes, note: "", day: day(0) });
    await act(order.id, {
      action: "part",
      partCode: part.code,
      description: part.description,
      quantity: 1,
      unit: part.unit,
    });
    await act(order.id, {
      action: "done",
      cause: texts.cause,
      solution: texts.solution,
      downtimeMinutes: downtime,
    });
    await act(order.id, { action: "release_hygiene" });
    await act(order.id, { action: "close" });
  };
  const [rodPart, probePart] = [t.parts[1], t.parts[3]];
  await closed(
    {
      title: t.room1.title,
      description: t.room1.description,
      cause: t.room1.cause,
      solution: t.room1.solution,
    },
    room.id,
    75,
    60,
    probePart,
  );
  await closed(
    {
      title: t.noise.title,
      description: t.noise.description,
      cause: t.noise.cause,
      solution: t.noise.solution,
    },
    filler.id,
    40,
    30,
    rodPart,
  );
  await report({ ...t.clip, assetId: clipper.id, priority: "HIGH" });
  await api("POST", "/maintenance/work-orders", {
    ...t.lights,
    kind: "IMPROVEMENT",
    priority: "LOW",
    assignedToId: me,
    dueOn: day(10),
  });
  const urgent = await report({ ...t.urgent, assetId: filler.id, priority: "URGENT" });
  await act(urgent.id, { action: "take" });
  await act(urgent.id, { action: "start" });
  await act(urgent.id, {
    action: "part",
    partCode: t.parts[0].code,
    description: t.parts[0].description,
    quantity: 2,
    unit: t.parts[0].unit,
  });
  return { urgent: urgent.id };
}
