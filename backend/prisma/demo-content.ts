// Contenido de demo (datos inventados) para el seed y las capturas de la web: departamentos con jefes,
// espacios, carpetas, páginas y documentos controlados en cada estado (borrador, en revisión, vigente y
// obsoleto), lecturas obligatorias y un QR. Todo se crea con los servicios de la app, como lo haría una
// persona, así respeta las mismas reglas (permisos, códigos, versiones, auditoría).
import type { JSONContent } from "@tiptap/core";
import type { Jobs } from "../src/jobs/boss.ts";
import type { PrismaClient } from "../src/lib/prisma.ts";
import { loadTenantContext } from "../src/middleware/tenant.ts";
import type { AdminContext } from "../src/modules/admin/admin-context.ts";
import {
  addDepartmentMembers,
  createDepartment,
} from "../src/modules/departments/departments.service.ts";
import { makeControlled } from "../src/modules/documents/documents.service.ts";
import { decide, publish, submitForReview } from "../src/modules/documents/approvals.service.ts";
import { acknowledge, addRequirement } from "../src/modules/documents/readings.service.ts";
import { createFolder } from "../src/modules/nodes/nodes.service.ts";
import { createPage, savePage } from "../src/modules/nodes/pages.service.ts";
import { createQr } from "../src/modules/qr/qr.service.ts";
import { createSpace } from "../src/modules/spaces/spaces.service.ts";

export type DemoLocale = "es" | "en";

/** Sin worker: los avisos y los PDF del seed no se encolan. */
const noJobs: Pick<Jobs, "enqueue"> = { enqueue: () => Promise.resolve() };

// ─── Texto de páginas (Tiptap) ──────────────────────────────────────────────

const text = (value: string): JSONContent => ({ type: "text", text: value });
const p = (value: string): JSONContent => ({ type: "paragraph", content: [text(value)] });
const h = (level: 1 | 2 | 3, value: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const list = (type: "bulletList" | "orderedList", values: string[]): JSONContent => ({
  type,
  content: values.map((value) => ({ type: "listItem", content: [p(value)] })),
});
const callout = (tone: "info" | "warning", value: string): JSONContent => ({
  type: "callout",
  attrs: { tone },
  content: [p(value)],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

// ─── Textos por idioma ──────────────────────────────────────────────────────

interface PageText {
  name: string;
  content: JSONContent;
}

interface DemoTexts {
  departments: { quality: string; production: string; maintenance: string; admin: string };
  spaces: {
    procedures: { name: string; description: string };
    people: { name: string; description: string };
  };
  folders: { quality: string; plant: string; safety: string; onboarding: string };
  pages: {
    documentControl: PageText;
    documentControlV2: JSONContent;
    cleaning: PageText;
    slicer: PageText;
    allergens: PageText;
    emergency: PageText;
    welcome: PageText;
    vacation: PageText;
    /** Páginas comunes de la carpeta Planta. */
    plant: PageText[];
  };
  changeNote: string;
  approvalComment: string;
}

const texts: Record<DemoLocale, DemoTexts> = {
  es: {
    departments: {
      quality: "Calidad",
      production: "Producción",
      maintenance: "Mantenimiento",
      admin: "Administración",
    },
    spaces: {
      procedures: {
        name: "Procedimientos",
        description: "Procedimientos, instrucciones y registros de la planta.",
      },
      people: { name: "Personas", description: "Acogida, vacaciones y políticas internas." },
    },
    folders: {
      quality: "Calidad e inocuidad",
      plant: "Planta",
      safety: "Seguridad y emergencias",
      onboarding: "Acogida",
    },
    pages: {
      documentControl: {
        name: "Control de documentos",
        content: doc(
          h(2, "Objeto"),
          p(
            "Definir cómo se redactan, revisan, aprueban y distribuyen los documentos de la empresa.",
          ),
          h(2, "Responsables"),
          list("bulletList", [
            "Calidad mantiene el listado de documentos vigentes.",
            "Cada jefe de área revisa los documentos de su departamento.",
          ]),
          h(2, "Proceso"),
          list("orderedList", [
            "Redactar el borrador.",
            "Enviarlo a revisión con al menos un aprobador.",
            "Publicar la versión aprobada: la anterior queda obsoleta.",
            "Pedir la lectura a los departamentos afectados.",
          ]),
        ),
      },
      documentControlV2: doc(
        h(2, "Objeto"),
        p(
          "Definir cómo se redactan, revisan, aprueban y distribuyen los documentos de la empresa.",
        ),
        h(2, "Responsables"),
        list("bulletList", [
          "Calidad mantiene el listado de documentos vigentes.",
          "Cada jefe de área revisa los documentos de su departamento.",
          "Dirección aprueba los manuales y las políticas.",
        ]),
        h(2, "Proceso"),
        list("orderedList", [
          "Redactar el borrador.",
          "Enviarlo a revisión con al menos un aprobador.",
          "Publicar la versión aprobada: la anterior queda obsoleta.",
          "Pedir la lectura a los departamentos afectados y revisar las confirmaciones.",
        ]),
        callout("info", "Revisión periódica: cada 12 meses, o antes si cambia el proceso."),
      ),
      cleaning: {
        name: "Limpieza y desinfección de la sala de elaboración",
        content: doc(
          h(2, "Frecuencia"),
          p("Al terminar cada turno y siempre que se cambie de producto."),
          h(2, "Pasos"),
          list("orderedList", [
            "Retirar restos de producto y embalajes.",
            "Aplicar detergente alcalino durante 10 minutos.",
            "Aclarar con agua caliente.",
            "Desinfectar y dejar secar.",
            "Registrar la limpieza en el formulario de la sala.",
          ]),
          callout("warning", "Usar guantes y gafas durante la aplicación de productos químicos."),
        ),
      },
      slicer: {
        name: "Uso de la cortadora de fiambres",
        content: doc(
          h(2, "Antes de empezar"),
          list("bulletList", [
            "Comprobar que la protección de la cuchilla está colocada.",
            "Usar guante de malla en la mano que sujeta la pieza.",
          ]),
          h(2, "Durante el uso"),
          list("orderedList", [
            "Ajustar el grosor con la máquina parada.",
            "Empujar la pieza siempre con el carro, nunca con la mano.",
            "Apagar y desenchufar antes de limpiar.",
          ]),
          callout(
            "warning",
            "Nunca retirar la protección de la cuchilla con la máquina en marcha.",
          ),
        ),
      },
      allergens: {
        name: "Gestión de alérgenos",
        content: doc(
          h(2, "Alérgenos presentes en la planta"),
          list("bulletList", ["Leche", "Frutos de cáscara", "Mostaza", "Sulfitos"]),
          h(2, "Medidas"),
          p("Producir los lotes con alérgenos al final del turno y limpiar antes del cambio."),
        ),
      },
      emergency: {
        name: "Plan de emergencia",
        content: doc(
          h(2, "En caso de incendio"),
          list("orderedList", [
            "Dar la alarma.",
            "Salir por la ruta de evacuación más cercana.",
            "Reunirse en el punto de encuentro del aparcamiento.",
          ]),
          h(2, "Teléfonos"),
          p("Emergencias: 112. Responsable de turno: extensión 204."),
        ),
      },
      welcome: {
        name: "Bienvenida al equipo",
        content: doc(
          p(
            "¡Te damos la bienvenida! En esta página tienes lo que necesitas para tus primeros días.",
          ),
          h(2, "Tu primera semana"),
          list("bulletList", [
            "Recorrido por la planta con tu jefe de área.",
            "Lectura de los procedimientos de tu puesto.",
            "Formación en seguridad e higiene.",
          ]),
        ),
      },
      vacation: {
        name: "Vacaciones y permisos",
        content: doc(
          h(2, "Cómo pedirlas"),
          p("Pide tus vacaciones a tu jefe de área con al menos 15 días de antelación."),
        ),
      },
      plant: [
        {
          name: "Registro de temperaturas de cámaras",
          content: doc(
            p("Anota la temperatura de cada cámara al empezar y al terminar el turno."),
            callout("warning", "Si una cámara supera los 4 °C, avisa al responsable de calidad."),
          ),
        },
        {
          name: "Recepción de materias primas",
          content: doc(
            h(2, "Al recibir un pedido"),
            list("orderedList", [
              "Comprobar el albarán y el lote.",
              "Medir la temperatura del producto.",
              "Revisar el envase y la fecha de caducidad.",
            ]),
          ),
        },
        {
          name: "Mantenimiento preventivo de la envasadora",
          content: doc(
            h(2, "Cada semana"),
            list("bulletList", [
              "Limpiar las mordazas de sellado.",
              "Revisar el film y la cuchilla.",
            ]),
          ),
        },
      ],
    },
    changeNote: "Se suma la aprobación de Dirección y la revisión periódica.",
    approvalComment: "Correcto, se puede publicar.",
  },
  en: {
    departments: {
      quality: "Quality",
      production: "Production",
      maintenance: "Maintenance",
      admin: "Administration",
    },
    spaces: {
      procedures: {
        name: "Procedures",
        description: "Plant procedures, work instructions and records.",
      },
      people: { name: "People", description: "Onboarding, time off and internal policies." },
    },
    folders: {
      quality: "Quality and food safety",
      plant: "Plant",
      safety: "Safety and emergencies",
      onboarding: "Onboarding",
    },
    pages: {
      documentControl: {
        name: "Document control",
        content: doc(
          h(2, "Purpose"),
          p("Define how company documents are written, reviewed, approved and distributed."),
          h(2, "Responsibilities"),
          list("bulletList", [
            "Quality keeps the list of current documents.",
            "Each area lead reviews their department's documents.",
          ]),
          h(2, "Process"),
          list("orderedList", [
            "Write the draft.",
            "Send it for review to at least one approver.",
            "Publish the approved version: the previous one becomes obsolete.",
            "Request reading from the affected departments.",
          ]),
        ),
      },
      documentControlV2: doc(
        h(2, "Purpose"),
        p("Define how company documents are written, reviewed, approved and distributed."),
        h(2, "Responsibilities"),
        list("bulletList", [
          "Quality keeps the list of current documents.",
          "Each area lead reviews their department's documents.",
          "Management approves manuals and policies.",
        ]),
        h(2, "Process"),
        list("orderedList", [
          "Write the draft.",
          "Send it for review to at least one approver.",
          "Publish the approved version: the previous one becomes obsolete.",
          "Request reading from the affected departments and check the confirmations.",
        ]),
        callout("info", "Periodic review: every 12 months, or earlier if the process changes."),
      ),
      cleaning: {
        name: "Cleaning and disinfection of the production room",
        content: doc(
          h(2, "Frequency"),
          p("At the end of every shift and whenever the product changes."),
          h(2, "Steps"),
          list("orderedList", [
            "Remove product leftovers and packaging.",
            "Apply alkaline detergent for 10 minutes.",
            "Rinse with hot water.",
            "Disinfect and let dry.",
            "Record the cleaning in the room log.",
          ]),
          callout("warning", "Wear gloves and goggles while applying chemicals."),
        ),
      },
      slicer: {
        name: "Using the meat slicer",
        content: doc(
          h(2, "Before you start"),
          list("bulletList", [
            "Check that the blade guard is in place.",
            "Wear a mesh glove on the hand that holds the piece.",
          ]),
          h(2, "While slicing"),
          list("orderedList", [
            "Adjust the thickness with the machine stopped.",
            "Always push the piece with the carriage, never by hand.",
            "Switch off and unplug before cleaning.",
          ]),
          callout("warning", "Never remove the blade guard while the machine is running."),
        ),
      },
      allergens: {
        name: "Allergen management",
        content: doc(
          h(2, "Allergens in the plant"),
          list("bulletList", ["Milk", "Tree nuts", "Mustard", "Sulphites"]),
          h(2, "Measures"),
          p("Run batches with allergens at the end of the shift and clean before switching."),
        ),
      },
      emergency: {
        name: "Emergency plan",
        content: doc(
          h(2, "In case of fire"),
          list("orderedList", [
            "Raise the alarm.",
            "Leave by the nearest evacuation route.",
            "Meet at the assembly point in the car park.",
          ]),
          h(2, "Phone numbers"),
          p("Emergencies: 112. Shift lead: extension 204."),
        ),
      },
      welcome: {
        name: "Welcome to the team",
        content: doc(
          p("Welcome aboard! This page has everything you need for your first days."),
          h(2, "Your first week"),
          list("bulletList", [
            "Plant tour with your area lead.",
            "Reading the procedures for your role.",
            "Health, safety and hygiene training.",
          ]),
        ),
      },
      vacation: {
        name: "Time off and leave",
        content: doc(
          h(2, "How to request it"),
          p("Ask your area lead for time off at least 15 days in advance."),
        ),
      },
      plant: [
        {
          name: "Cold room temperature log",
          content: doc(
            p("Record the temperature of every cold room at the start and end of each shift."),
            callout("warning", "If a cold room goes above 4 °C, tell the quality manager."),
          ),
        },
        {
          name: "Raw material intake",
          content: doc(
            h(2, "When a delivery arrives"),
            list("orderedList", [
              "Check the delivery note and the batch.",
              "Measure the product temperature.",
              "Check the packaging and the use-by date.",
            ]),
          ),
        },
        {
          name: "Packaging machine preventive maintenance",
          content: doc(
            h(2, "Every week"),
            list("bulletList", ["Clean the sealing jaws.", "Check the film and the blade."]),
          ),
        },
      ],
    },
    changeNote: "Adds Management approval and the periodic review.",
    approvalComment: "Looks good, ready to publish.",
  },
};

// ─── Contexto ───────────────────────────────────────────────────────────────

async function contextOf(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
): Promise<AdminContext> {
  const loaded = await loadTenantContext(prisma, { id: workspaceId }, userId);
  if (loaded === null) throw new Error("La persona no es miembro del workspace demo");
  const { tenant, db } = loaded;
  return {
    db,
    tenant,
    actor: { base: tenant.role.base, capabilities: tenant.capabilities },
    info: { actorId: userId, ip: null, userAgent: "seed" },
  };
}

export interface DemoPeople {
  owner: string;
  admin: string;
  /** Jefe de Producción. */
  productionLead: string;
  /** Miembros con plaza completa y lectores de planta (userIds). */
  staff: string[];
  readers: string[];
}

/** Página controlada: la crea, la convierte y la deja en el estado pedido. */
async function controlledPage(
  ctxs: { author: AdminContext; approver: AdminContext },
  input: {
    spaceId: string;
    parentId: string;
    page: PageText;
    docType: string;
    ownerDepartmentId: string;
    state: "draft" | "review" | "published";
  },
): Promise<string> {
  const { author, approver } = ctxs;
  const created = await createPage(author, input.spaceId, {
    parentId: input.parentId,
    name: input.page.name,
    content: input.page.content,
  });
  const nodeId = created.node.id;
  await makeControlled(author, nodeId, {
    docType: input.docType,
    ownerDepartmentId: input.ownerDepartmentId,
  });
  if (input.state === "draft") return nodeId;
  await submitForReview(author, { jobs: noJobs }, nodeId, {
    approverIds: [approver.tenant.membershipId],
  });
  if (input.state === "review") return nodeId;
  await decide(approver, { jobs: noJobs }, nodeId, { decision: "APPROVED" });
  await publish(author, { jobs: noJobs }, nodeId, { requestReading: true });
  return nodeId;
}

/** Crea el contenido de demo en un workspace recién creado. */
export async function seedDemoContent(
  prisma: PrismaClient,
  workspaceId: string,
  locale: DemoLocale,
  people: DemoPeople,
): Promise<void> {
  const t = texts[locale];
  const owner = await contextOf(prisma, workspaceId, people.owner);
  const admin = await contextOf(prisma, workspaceId, people.admin);
  const membershipOf = async (userId: string) =>
    (await contextOf(prisma, workspaceId, userId)).tenant.membershipId;

  // Departamentos con jefe y miembros.
  const quality = await createDepartment(owner, {
    name: t.departments.quality,
    headId: admin.tenant.membershipId,
    color: "violet",
    createSpace: false,
  });
  const production = await createDepartment(owner, {
    name: t.departments.production,
    headId: await membershipOf(people.productionLead),
    color: "amber",
    createSpace: false,
  });
  const maintenance = await createDepartment(owner, {
    name: t.departments.maintenance,
    color: "blue",
    createSpace: false,
  });
  await createDepartment(owner, { name: t.departments.admin, color: "green", createSpace: false });
  const staff = await Promise.all(people.staff.map(membershipOf));
  const readers = await Promise.all(people.readers.map(membershipOf));
  await addDepartmentMembers(owner, production.id, [...staff.slice(0, 2), ...readers]);
  await addDepartmentMembers(owner, quality.id, staff.slice(2, 3));
  await addDepartmentMembers(owner, maintenance.id, staff.slice(3));

  // Espacios y carpetas.
  const procedures = await createSpace(owner, {
    name: t.spaces.procedures.name,
    description: t.spaces.procedures.description,
    icon: "📋",
    color: "violet",
    isPrivate: false,
    isConfidential: false,
    includeSubareas: false,
  });
  const peopleSpace = await createSpace(owner, {
    name: t.spaces.people.name,
    description: t.spaces.people.description,
    icon: "🤝",
    color: "green",
    isPrivate: false,
    isConfidential: false,
    includeSubareas: false,
  });
  const qualityFolder = await createFolder(owner, procedures.id, { name: t.folders.quality });
  const plantFolder = await createFolder(owner, procedures.id, { name: t.folders.plant });
  const safetyFolder = await createFolder(owner, procedures.id, { name: t.folders.safety });
  const onboardingFolder = await createFolder(owner, peopleSpace.id, {
    name: t.folders.onboarding,
  });

  const ctxs = { author: owner, approver: admin };

  // Control de documentos: v1 vigente, después v2 aprobada → v1 obsoleta.
  const control = await controlledPage(ctxs, {
    spaceId: procedures.id,
    parentId: qualityFolder.id,
    page: t.pages.documentControl,
    docType: "PRC",
    ownerDepartmentId: quality.id,
    state: "published",
  });
  const draft = await prisma.pageContent.findFirst({
    where: { nodeId: control },
    select: { revision: true },
  });
  await savePage(owner, { prisma, jobs: noJobs }, control, {
    baseRevision: draft?.revision ?? 1,
    content: t.pages.documentControlV2,
  });
  await submitForReview(owner, { jobs: noJobs }, control, {
    approverIds: [admin.tenant.membershipId],
    changeNote: t.changeNote,
  });
  await decide(admin, { jobs: noJobs }, control, {
    decision: "APPROVED",
    comment: t.approvalComment,
  });
  await publish(owner, { jobs: noJobs }, control, { requestReading: true });

  // Limpieza: en revisión (aparece en Aprobaciones de Calidad).
  await controlledPage(ctxs, {
    spaceId: procedures.id,
    parentId: plantFolder.id,
    page: t.pages.cleaning,
    docType: "PRC",
    ownerDepartmentId: production.id,
    state: "review",
  });

  // Cortadora: vigente, con lectura obligatoria para Producción y un QR para el puesto.
  const slicer = await controlledPage(ctxs, {
    spaceId: procedures.id,
    parentId: plantFolder.id,
    page: t.pages.slicer,
    docType: "INS",
    ownerDepartmentId: production.id,
    state: "published",
  });
  await addRequirement(owner, { jobs: noJobs }, slicer, {
    departmentId: production.id,
    includeSubareas: false,
  });
  // Dos de los operarios ya confirmaron la lectura.
  for (const reader of people.readers.slice(0, 2)) {
    await acknowledge(await contextOf(prisma, workspaceId, reader), slicer);
  }
  for (const page of t.pages.plant) {
    await createPage(owner, procedures.id, {
      parentId: plantFolder.id,
      name: page.name,
      content: page.content,
    });
  }
  await createQr(
    owner,
    { env: { APP_URL: process.env.APP_URL ?? "http://localhost:5173" } },
    slicer,
    {
      public: false,
    },
  );

  // Alérgenos: borrador controlado.
  await controlledPage(ctxs, {
    spaceId: procedures.id,
    parentId: qualityFolder.id,
    page: t.pages.allergens,
    docType: "PRC",
    ownerDepartmentId: quality.id,
    state: "draft",
  });

  // Páginas comunes.
  await createPage(owner, procedures.id, {
    parentId: safetyFolder.id,
    name: t.pages.emergency.name,
    content: t.pages.emergency.content,
  });
  await createPage(owner, peopleSpace.id, {
    parentId: onboardingFolder.id,
    name: t.pages.welcome.name,
    content: t.pages.welcome.content,
  });
  await createPage(owner, peopleSpace.id, {
    parentId: onboardingFolder.id,
    name: t.pages.vacation.name,
    content: t.pages.vacation.content,
  });
}
