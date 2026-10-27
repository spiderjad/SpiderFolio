// npm run db:seed. Idempotente. Carga dos empresas demo con datos inventados (una en español y otra en
// inglés), con personas de cada rol y contenido (departamentos, espacios, páginas y documentos
// controlados en cada estado). Solo contra una base local y con SEED_DEMO_PASSWORD (seed-guard.ts).
// Las mismas empresas se usan para las capturas de la web (scripts/capturas.ts).
import type { SeatType, SystemRole } from "../src/generated/prisma/client.ts";
import { forTenant } from "../src/db/tenant.ts";
import { withLocale } from "../src/i18n/locales.ts";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.ts";
import { createPasswords } from "../src/modules/auth/passwords.ts";
import { createWorkspace } from "../src/modules/workspaces/workspaces.service.ts";
import { seedDemoContent, type DemoLocale } from "./demo-content.ts";
import { assertSafeSeedTarget } from "./seed-guard.ts";

interface DemoPerson {
  email: string;
  name: string;
  role: SystemRole;
  seat: SeatType;
  jobTitle?: string;
  /** Papel en el contenido de demo. */
  tag?: "admin" | "productionLead" | "staff" | "reader";
}

interface DemoCompany {
  name: string;
  locale: DemoLocale;
  timezone: string;
  people: DemoPerson[];
}

/** Nombres y empresas inventados. Los emails son @demo.local: nunca llegan a nadie. */
const companies: DemoCompany[] = [
  {
    name: "Embutidos Demo S.L.",
    locale: "es",
    timezone: "Europe/Madrid",
    people: [
      {
        email: "duena@demo.local",
        name: "Lucía Ferrer",
        role: "OWNER",
        seat: "FULL",
        jobTitle: "Gerente",
      },
      {
        email: "admin@demo.local",
        name: "Martín Rojas",
        role: "ADMIN",
        seat: "FULL",
        jobTitle: "Responsable de calidad",
        tag: "admin",
      },
      {
        email: "miembro@demo.local",
        name: "Carmen Vidal",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Jefa de producción",
        tag: "productionLead",
      },
      {
        email: "jorge@demo.local",
        name: "Jorge Pastor",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Encargado de turno",
        tag: "staff",
      },
      {
        email: "irene@demo.local",
        name: "Irene Molina",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Técnica de laboratorio",
        tag: "staff",
      },
      {
        email: "pablo@demo.local",
        name: "Pablo Herrero",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Analista de calidad",
        tag: "staff",
      },
      {
        email: "sergio@demo.local",
        name: "Sergio Navarro",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Técnico de mantenimiento",
        tag: "staff",
      },
      {
        email: "lector@demo.local",
        name: "Ana Sanz",
        role: "MEMBER",
        seat: "READER",
        jobTitle: "Operaria",
        tag: "reader",
      },
      {
        email: "david@demo.local",
        name: "David Gil",
        role: "MEMBER",
        seat: "READER",
        jobTitle: "Operario",
        tag: "reader",
      },
      {
        email: "rosa@demo.local",
        name: "Rosa Ibáñez",
        role: "MEMBER",
        seat: "READER",
        jobTitle: "Operaria",
        tag: "reader",
      },
      { email: "invitado@demo.local", name: "Auditoría Externa", role: "GUEST", seat: "READER" },
    ],
  },
  {
    name: "Demo Fine Foods Ltd.",
    locale: "en",
    timezone: "Europe/London",
    people: [
      {
        email: "owner@demo-en.local",
        name: "Emma Clarke",
        role: "OWNER",
        seat: "FULL",
        jobTitle: "Managing director",
      },
      {
        email: "admin@demo-en.local",
        name: "Liam Carter",
        role: "ADMIN",
        seat: "FULL",
        jobTitle: "Quality manager",
        tag: "admin",
      },
      {
        email: "member@demo-en.local",
        name: "Olivia Bennett",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Production lead",
        tag: "productionLead",
      },
      {
        email: "noah@demo-en.local",
        name: "Noah Hughes",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Shift supervisor",
        tag: "staff",
      },
      {
        email: "grace@demo-en.local",
        name: "Grace Turner",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Lab technician",
        tag: "staff",
      },
      {
        email: "jack@demo-en.local",
        name: "Jack Morgan",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Quality analyst",
        tag: "staff",
      },
      {
        email: "henry@demo-en.local",
        name: "Henry Walsh",
        role: "MEMBER",
        seat: "FULL",
        jobTitle: "Maintenance technician",
        tag: "staff",
      },
      {
        email: "reader@demo-en.local",
        name: "Chloe Price",
        role: "MEMBER",
        seat: "READER",
        jobTitle: "Operator",
        tag: "reader",
      },
      {
        email: "ryan@demo-en.local",
        name: "Ryan Foster",
        role: "MEMBER",
        seat: "READER",
        jobTitle: "Operator",
        tag: "reader",
      },
      { email: "guest@demo-en.local", name: "External Auditor", role: "GUEST", seat: "READER" },
    ],
  },
];

async function seedCompany(
  prisma: PrismaClient,
  company: DemoCompany,
  passwordHash: string,
): Promise<void> {
  const [owner, ...others] = company.people;
  if (owner === undefined) return;
  if ((await prisma.user.findUnique({ where: { email: owner.email } })) !== null) {
    console.log(`Empresa demo "${company.name}" ya cargada`);
    return;
  }
  const verifiedAt = new Date();
  const userData = (person: DemoPerson) => ({
    email: person.email,
    name: person.name,
    passwordHash,
    emailVerifiedAt: verifiedAt,
    locale: company.locale,
  });
  const ownerUser = await prisma.user.create({ data: userData(owner) });
  const created = await createWorkspace(prisma, {
    name: company.name,
    ownerUserId: ownerUser.id,
    settings: { timezone: company.timezone, locale: company.locale },
  });

  const db = forTenant(prisma, created.workspaceId);
  if (owner.jobTitle !== undefined) {
    await db.membership.updateMany({
      where: { userId: ownerUser.id },
      data: { jobTitle: owner.jobTitle },
    });
  }
  const roles = await db.role.findMany({ where: { isSystem: true } });
  const ids: Record<string, string[]> = { admin: [], productionLead: [], staff: [], reader: [] };
  for (const person of others) {
    const role = roles.find((r) => r.base === person.role);
    if (role === undefined) throw new Error(`Falta el rol ${person.role}`);
    const user = await prisma.user.create({ data: userData(person) });
    await db.membership.create({
      data: {
        userId: user.id,
        roleId: role.id,
        seatType: person.seat,
        jobTitle: person.jobTitle ?? null,
      },
    });
    if (person.tag !== undefined) ids[person.tag]?.push(user.id);
  }
  const [admin] = ids.admin ?? [];
  const [productionLead] = ids.productionLead ?? [];
  if (admin === undefined || productionLead === undefined) {
    throw new Error("La empresa demo necesita un admin y un jefe de producción");
  }
  await seedDemoContent(prisma, created.workspaceId, company.locale, {
    owner: ownerUser.id,
    admin,
    productionLead,
    staff: ids.staff ?? [],
    readers: ids.reader ?? [],
  });
  console.log(
    `Empresa demo "${company.name}" (/${created.slug}) con ${String(company.people.length)} personas y contenido`,
  );
}

const { databaseUrl, demoPassword } = assertSafeSeedTarget(process.env);
const prisma = createPrismaClient(databaseUrl);
try {
  const passwordHash = await (await createPasswords()).hash(demoPassword);
  // Default data (system roles, document types) is created in the company's own language.
  for (const company of companies) {
    await withLocale(company.locale, () => seedCompany(prisma, company, passwordHash));
  }
} finally {
  await prisma.$disconnect();
}
