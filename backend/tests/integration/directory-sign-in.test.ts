// Signing in with a company's directory (docs/spec/plugins.md «Directorio de la empresa»): attempt limits
// and minimum response time, empty passwords, the OIDC flow (state, PKCE and nonce used once and bound to
// the company and the browser), linking only by the directory's id, owners always kept, «directory only»,
// the grace period after the license expires, the identity provider's MFA, and secrets that never show.
import { createHash, randomBytes } from "node:crypto";
import { directorySignInLimits } from "@spiderfolio/limits";
import {
  defineBackendPlugin,
  type DirectoryMember,
  type RedirectSignIn,
} from "@spiderfolio/plugin-sdk/backend";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { AppError } from "../../src/lib/errors.ts";
import { createMfaBox } from "../../src/lib/mfa-box.ts";
import { createSecretBox } from "../../src/lib/secret-box.ts";
import { generateTotpSecret, totpAt } from "../../src/lib/totp.ts";
import { notifyStoppedDirectories } from "../../src/modules/external-auth/directory-notice.ts";
import type { PluginRuntime } from "../../src/plugins/runtime.ts";
import type { AppDeps } from "../../src/routes.ts";
import { errorOf } from "../http.ts";
import {
  addMember,
  createTestContext,
  createUser,
  createWorkspace,
  loginAs,
  testPluginRuntime,
  uniqueEmail,
  type TestContext,
  type TestWorkspace,
} from "./helpers.ts";

let ctx: TestContext;
let deps: AppDeps;
const PLUGIN = "test-directory";
const DAY = 24 * 3600_000;
const box = createSecretBox({ EMAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

// The fake directory: username → password and what it says about the person.
const people = new Map<string, { password: string; member: DirectoryMember & { mfa?: boolean } }>();
let verifyCalls = 0;
let lastAuthorization: { redirectUri: string; state: string; nonce: string; codeChallenge: string };
let lastCallback: { state: string; nonce: string; codeVerifier: string; callbackUrl: URL } | null;
let nextIdentity: RedirectSignIn | null = null;

const plugin = defineBackendPlugin({
  id: PLUGIN,
  version: "1.0.0",
  authProviders: [
    {
      kind: "password",
      id: "ldap",
      describe: () => Promise.resolve({ label: "Directorio de prueba" }),
      async verify(pluginCtx, { username, password }) {
        verifyCalls += 1;
        // Uses its secret like a real service account would; never logs it.
        await pluginCtx.secrets.get("bindPassword");
        if (username === "rompe") throw new Error("El directorio no responde");
        const person = people.get(username);
        return person?.password === password ? person.member : null;
      },
    },
    {
      kind: "redirect",
      id: "oidc",
      describe: () => Promise.resolve({ label: "Cuenta de prueba" }),
      authorizationUrl(_ctx, authorization) {
        lastAuthorization = authorization;
        return Promise.resolve(`https://idp.test/authorize?state=${authorization.state}`);
      },
      callback(_ctx, response) {
        lastCallback = response;
        return Promise.resolve(nextIdentity);
      },
    },
  ],
});

beforeAll(async () => {
  ctx = await createTestContext();
  deps = {
    ...ctx.deps,
    env: {
      ...ctx.deps.env,
      MFA_ENCRYPTION_KEY: ctx.deps.env.MFA_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    },
  };
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  // Test database only: every case starts without spent attempts.
  await ctx.prisma.rateLimitBucket.deleteMany({});
  lastCallback = null;
});

interface Setup {
  ws: TestWorkspace;
  runtime: PluginRuntime;
  app: ReturnType<typeof createApp>;
}

async function setup(
  name: string,
  options: { expiresAt?: Date; logger?: AppDeps["logger"] } = {},
): Promise<Setup> {
  const ws = await createWorkspace(ctx, name);
  const runtime = await testPluginRuntime(ctx, [plugin], [ws.workspaceId], [], {
    box,
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  });
  const app = createApp({
    ...deps,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    plugins: runtime,
  });
  return { ws, runtime, app };
}

const directoryOf = (s: Setup, workspaceId = s.ws.workspaceId) =>
  s.runtime.contextFor(workspaceId, PLUGIN).directory;

/** Someone in the fake directory, with a unique username, id and email. */
function directoryPerson(extra: Partial<DirectoryMember> & { mfa?: boolean } = {}) {
  const username = `user-${randomBytes(6).toString("hex")}`;
  const password = "contraseña-del-directorio";
  const member = {
    externalId: randomBytes(16).toString("hex"),
    email: uniqueEmail("directorio"),
    name: "Persona del Directorio",
    ...extra,
  };
  people.set(username, { password, member });
  return { username, password, member };
}

/** Only username and password reach the route (the schema is strict). */
const passwordLogin = (
  s: Setup,
  { username, password }: { username: string; password: string },
  slug = s.ws.slug,
) =>
  request(s.app).post(`/api/v1/auth/sso/${slug}/${PLUGIN}/ldap/login`).send({ username, password });

const setCookies = (res: request.Response): string[] => {
  const header = res.headers["set-cookie"] as string[] | string | undefined;
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
};
const cookieValue = (res: request.Response, name: string) =>
  setCookies(res)
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);

async function startRedirect(s: Setup) {
  const res = await request(s.app).get(`/api/v1/auth/sso/${s.ws.slug}/${PLUGIN}/oidc/start`);
  expect(res.status).toBe(303);
  const browser = cookieValue(res, "spiderfolio_sso");
  expect(browser).toBeDefined();
  return { res, state: lastAuthorization.state, browser: browser ?? "" };
}

const callback = (s: Setup, state: string, browser: string | null, slug = s.ws.slug) => {
  const call = request(s.app).get(
    `/api/v1/auth/sso/${slug}/${PLUGIN}/oidc/callback?code=codigo&state=${encodeURIComponent(state)}`,
  );
  return browser === null ? call : call.set("Cookie", `spiderfolio_sso=${browser}`);
};

describe("contraseña del directorio", () => {
  it("la primera vez crea la cuenta sin contraseña local, la membresía y el vínculo", async () => {
    const s = await setup("Directorio alta");
    const person = directoryPerson();
    const res = await passwordLogin(s, { username: person.username, password: person.password });
    expect(res.status).toBe(200);
    expect(cookieValue(res, "spiderfolio_rt")).toBeDefined();
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: person.member.email } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    const identity = await ctx.prisma.externalIdentity.findFirstOrThrow({
      where: { workspaceId: s.ws.workspaceId, externalId: person.member.externalId },
      include: { membership: { include: { role: true } } },
    });
    expect(identity.membership.userId).toBe(user.id);
    expect(identity.membership.role.base).toBe("MEMBER");
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.authWorkspaceId).toBe(s.ws.workspaceId);
    expect(session.authProvider).toBe(`${PLUGIN}/ldap`);
  });

  it("la contraseña vacía se rechaza antes de llamar al directorio", async () => {
    const s = await setup("Directorio vacía");
    const person = directoryPerson();
    const before = verifyCalls;
    const res = await request(s.app)
      .post(`/api/v1/auth/sso/${s.ws.slug}/${PLUGIN}/ldap/login`)
      .send({ username: person.username, password: "" });
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("VALIDATION_ERROR");
    expect(verifyCalls).toBe(before);
  });

  it("aciertos y errores tardan al menos el mínimo, con el mismo error para todo fallo", async () => {
    const s = await setup("Directorio tiempos");
    const person = directoryPerson();
    for (const body of [
      { username: person.username, password: "otra-contraseña" },
      { username: "no-existe", password: "lo-que-sea" },
      { username: "rompe", password: "lo-que-sea" },
    ]) {
      const started = Date.now();
      const res = await passwordLogin(s, body);
      expect(Date.now() - started).toBeGreaterThanOrEqual(directorySignInLimits.minResponseMs - 5);
      expect(res.status).toBe(401);
      expect(errorOf(res).code).toBe("INVALID_CREDENTIALS");
    }
    const started = Date.now();
    const ok = await passwordLogin(s, { username: person.username, password: person.password });
    expect(ok.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(directorySignInLimits.minResponseMs - 5);
    const failures = await ctx.prisma.auditLog.findMany({
      where: { workspaceId: s.ws.workspaceId, action: "auth.login.failure" },
    });
    expect(failures).toHaveLength(3);
    expect(JSON.stringify(failures)).not.toContain("otra-contraseña");
  });

  it("después de 5 intentos desde la misma IP para ese usuario, 429", async () => {
    const s = await setup("Directorio límite");
    const person = directoryPerson();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await passwordLogin(s, { username: person.username, password: "mal" });
      expect(res.status).toBe(401);
    }
    const blocked = await passwordLogin(s, {
      username: person.username,
      password: person.password,
    });
    expect(blocked.status).toBe(429);
    // Another username is not affected.
    const other = directoryPerson();
    const res = await passwordLogin(s, { username: other.username, password: other.password });
    expect(res.status).toBe(200);
  });

  it("con su 2FA activa pide el código y la sesión recuerda el directorio", async () => {
    const s = await setup("Directorio 2FA");
    const person = directoryPerson({ mfa: true });
    expect((await passwordLogin(s, person)).status).toBe(200);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: person.member.email } });
    const secret = generateTotpSecret();
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: createMfaBox(deps.env).encrypt(user.id, secret),
        totpEnabledAt: new Date(),
      },
    });
    // A password provider never replaces SpiderFolio's code, even if it says MFA was done.
    const res = await passwordLogin(s, { username: person.username, password: person.password });
    expect(res.status).toBe(200);
    const body = res.body as { mfaRequired?: boolean; challenge: string };
    expect(body.mfaRequired).toBe(true);
    expect(cookieValue(res, "spiderfolio_rt")).toBeUndefined();
    const verified = await request(s.app)
      .post("/api/v1/auth/2fa/verify")
      .send({ challenge: body.challenge, code: totpAt(secret, new Date()), remember: false });
    expect(verified.status).toBe(200);
    const session = await ctx.prisma.session.findFirstOrThrow({
      where: { userId: user.id, mfaAt: { not: null } },
    });
    expect(session.authWorkspaceId).toBe(s.ws.workspaceId);
    expect(session.authProvider).toBe(`${PLUGIN}/ldap`);
  });
});

describe("vínculo solo por el id del directorio", () => {
  it("un email que ya tiene cuenta no se vincula solo", async () => {
    const s = await setup("Vínculo email");
    const local = await addMember(ctx, s.ws, { name: "Cuenta Local" });
    const person = directoryPerson({ email: local.user.email });
    const res = await passwordLogin(s, { username: person.username, password: person.password });
    expect(res.status).toBe(409);
    expect(
      await ctx.prisma.externalIdentity.count({ where: { membershipId: local.membership.id } }),
    ).toBe(0);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: local.user.id } });
    expect(user.passwordHash).toBe(local.user.passwordHash);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          workspaceId: s.ws.workspaceId,
          action: "auth.login.failure",
          metadata: { path: ["reason"], equals: "email_taken" },
        },
      }),
    ).toBe(1);

    // An administrator links it: from then on, it signs in as that member.
    await directoryOf(s).link("ldap", local.membership.id, person.member.externalId);
    const linked = await passwordLogin(s, { username: person.username, password: person.password });
    expect(linked.status).toBe(200);
    expect((linked.body as { user: { id: string } }).user.id).toBe(local.user.id);
  });

  it("otra cuenta del directorio con el mismo email no entra como esa persona", async () => {
    const s = await setup("Vínculo otro id");
    const first = directoryPerson();
    expect((await passwordLogin(s, first)).status).toBe(200);
    const impostor = directoryPerson({ email: first.member.email });
    const res = await passwordLogin(s, {
      username: impostor.username,
      password: impostor.password,
    });
    expect(res.status).toBe(409);
  });

  it("el mismo id con otro email es la misma persona (y se le actualiza el email)", async () => {
    const s = await setup("Vínculo cambio email");
    const person = directoryPerson();
    const first = await passwordLogin(s, person);
    const userId = (first.body as { user: { id: string } }).user.id;
    const email = uniqueEmail("nuevo");
    people.set(person.username, { password: person.password, member: { ...person.member, email } });
    const again = await passwordLogin(s, person);
    expect((again.body as { user: { id: string } }).user.id).toBe(userId);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email);
  });

  it("no se vincula ni desvincula a alguien de otra empresa", async () => {
    const a = await setup("Vínculo A");
    const b = await setup("Vínculo B");
    const foreign = await addMember(ctx, b.ws);
    await expect(
      directoryOf(a).link("ldap", foreign.membership.id, "id-ajeno"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await directoryOf(b).link("ldap", foreign.membership.id, "id-propio");
    await directoryOf(a).unlink(foreign.membership.id);
    expect(
      await ctx.prisma.externalIdentity.count({ where: { membershipId: foreign.membership.id } }),
    ).toBe(1);
  });
});

describe("propietarios", () => {
  it("el directorio no da, cambia ni quita el rol de propietario, ni suspende a un propietario", async () => {
    const s = await setup("Propietarios");
    const directory = directoryOf(s);
    const roles = await directory.roles();
    const ownerRole = roles.find((role) => role.base === "OWNER");
    const adminRole = roles.find((role) => role.base === "ADMIN");
    if (ownerRole === undefined || adminRole === undefined)
      throw new Error("Faltan roles de sistema");

    const newcomer = directoryPerson();
    await expect(
      directory.syncMember("ldap", { ...newcomer.member, roleId: ownerRole.id }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await ctx.prisma.user.count({ where: { email: newcomer.member.email } })).toBe(0);

    await directory.link("ldap", s.ws.membershipId, "id-del-propietario");
    const synced = await directory.syncMember("ldap", {
      externalId: "id-del-propietario",
      email: s.ws.owner.email,
      name: s.ws.owner.name,
      roleId: adminRole.id,
    });
    expect(synced).toMatchObject({ status: "unchanged", skipped: ["ownerRole"] });
    expect(await directory.suspendMember("ldap", "id-del-propietario")).toBe("owner");
    const owner = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: s.ws.membershipId },
      include: { role: true },
    });
    expect(owner.role.base).toBe("OWNER");
    expect(owner.status).toBe("ACTIVE");
  });

  it("reactiva a quien suspendió el directorio, no a quien suspendió un administrador", async () => {
    const s = await setup("Suspensiones");
    const directory = directoryOf(s);
    const byDirectory = directoryPerson();
    const created = await directory.syncMember("ldap", byDirectory.member);
    if (created.status === "conflict") throw new Error("conflicto inesperado");
    expect(await directory.suspendMember("ldap", byDirectory.member.externalId)).toBe("suspended");
    expect(await directory.syncMember("ldap", byDirectory.member)).toMatchObject({
      status: "reactivated",
    });

    const byAdmin = directoryPerson();
    const other = await directory.syncMember("ldap", byAdmin.member);
    if (other.status === "conflict") throw new Error("conflicto inesperado");
    await ctx.prisma.membership.update({
      where: { id: other.membershipId },
      data: { status: "SUSPENDED" },
    });
    await directory.syncMember("ldap", byAdmin.member);
    const membership = await ctx.prisma.membership.findUniqueOrThrow({
      where: { id: other.membershipId },
    });
    expect(membership.status).toBe("SUSPENDED");
    // And a suspended member can't sign in.
    const res = await passwordLogin(s, byAdmin);
    expect(res.status).toBe(401);
  });

  it("cada cambio del directorio queda en la auditoría", async () => {
    const s = await setup("Auditoría directorio");
    const directory = directoryOf(s);
    const person = directoryPerson();
    await directory.syncMember("ldap", person.member);
    await directory.syncMember("ldap", { ...person.member, name: "Otro Nombre" });
    await directory.suspendMember("ldap", person.member.externalId);
    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { workspaceId: s.ws.workspaceId, action: { startsWith: "directory.member." } },
        orderBy: { createdAt: "asc" },
      })
    ).map((entry) => entry.action);
    expect(actions).toEqual([
      "directory.member.create",
      "directory.member.update",
      "directory.member.suspend",
    ]);
  });
});

describe("solo directorio", () => {
  it("exige un propietario con contraseña y 2FA, y deja afuera a las sesiones locales", async () => {
    const s = await setup("Solo directorio");
    const directory = directoryOf(s);
    await expect(directory.setDirectoryOnly(true)).rejects.toMatchObject({ code: "CONFLICT" });
    await ctx.prisma.user.update({
      where: { id: s.ws.owner.id },
      data: { totpEnabledAt: new Date() },
    });
    await directory.setDirectoryOnly(true);
    expect(await directory.directoryOnly()).toBe(true);

    const person = directoryPerson();
    const signedIn = await passwordLogin(s, person);
    const viaDirectory = (signedIn.body as { accessToken: string }).accessToken;
    const userId = (signedIn.body as { user: { id: string } }).user.id;
    const local = await loginAs(ctx, userId);
    const home = (token: string) =>
      request(s.app).get(`/api/v1/w/${s.ws.slug}/`).set("Authorization", `Bearer ${token}`);

    expect((await home(viaDirectory)).status).toBe(200);
    const refused = await home(local);
    expect(refused.status).toBe(403);
    expect(errorOf(refused).code).toBe("DIRECTORY_SIGN_IN_REQUIRED");
    expect((await home(s.ws.token)).status).toBe(200);

    const options = await request(s.app).get(`/api/v1/auth/sso/options?workspace=${s.ws.slug}`);
    expect((options.body as { directoryOnly: boolean }).directoryOnly).toBe(true);
  });

  it("una sesión del directorio de otra empresa no cuenta", async () => {
    const a = await setup("Solo directorio A");
    const b = await setup("Solo directorio B");
    await ctx.prisma.user.update({
      where: { id: b.ws.owner.id },
      data: { totpEnabledAt: new Date() },
    });
    await directoryOf(b).setDirectoryOnly(true);
    const person = directoryPerson();
    const signedIn = await passwordLogin(a, person);
    const membership = await directoryOf(b).syncMember("ldap", directoryPerson().member);
    if (membership.status === "conflict") throw new Error("conflicto inesperado");
    // Same person also member of B, but signed in through A's directory.
    const userId = (signedIn.body as { user: { id: string } }).user.id;
    const role = await ctx.prisma.role.findFirstOrThrow({
      where: { workspaceId: b.ws.workspaceId, base: "MEMBER", isSystem: true },
    });
    await ctx.prisma.membership.create({
      data: { userId, workspaceId: b.ws.workspaceId, roleId: role.id },
    });
    const res = await request(b.app)
      .get(`/api/v1/w/${b.ws.slug}/`)
      .set("Authorization", `Bearer ${(signedIn.body as { accessToken: string }).accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe("al vencer la licencia", () => {
  it("dentro de los 7 días se sigue entrando, pero el plugin ya no está activo", async () => {
    expect(directorySignInLimits.graceDays).toBe(7);
    const s = await setup("Gracia", { expiresAt: new Date(Date.now() - 3 * DAY) });
    expect(await s.runtime.isActive(s.ws.workspaceId, PLUGIN)).toBe(false);
    const options = await request(s.app).get(`/api/v1/auth/sso/options?workspace=${s.ws.slug}`);
    expect((options.body as { providers: unknown[] }).providers).toHaveLength(2);
    const person = directoryPerson();
    expect((await passwordLogin(s, person)).status).toBe(200);
  });

  it("pasados los 7 días los proveedores desaparecen y solo directorio deja de aplicar", async () => {
    const s = await setup("Sin gracia", { expiresAt: new Date(Date.now() - 8 * DAY) });
    await ctx.prisma.user.update({
      where: { id: s.ws.owner.id },
      data: { totpEnabledAt: new Date() },
    });
    await directoryOf(s).setDirectoryOnly(true);
    const options = await request(s.app).get(`/api/v1/auth/sso/options?workspace=${s.ws.slug}`);
    expect(options.body).toMatchObject({ providers: [], directoryOnly: false });
    const person = directoryPerson();
    const res = await passwordLogin(s, person);
    expect(res.status).toBe(404);
    const member = await addMember(ctx, s.ws);
    const home = await request(s.app)
      .get(`/api/v1/w/${s.ws.slug}/`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(home.status).toBe(200);
  });

  it("avisa una sola vez a los propietarios de que la sincronización se detuvo", async () => {
    const s = await setup("Aviso", { expiresAt: new Date(Date.now() - DAY) });
    await directoryOf(s).syncMember("ldap", directoryPerson().member);
    expect(await notifyStoppedDirectories(ctx.prisma, s.runtime)).toBeGreaterThanOrEqual(1);
    await notifyStoppedDirectories(ctx.prisma, s.runtime);
    expect(
      await ctx.prisma.notification.count({
        where: { workspaceId: s.ws.workspaceId, kind: "directory_sync_stopped" },
      }),
    ).toBe(1);
  });
});

describe("redirección (OIDC)", () => {
  it("state, PKCE y nonce: el núcleo los genera y el callback abre la sesión", async () => {
    const s = await setup("OIDC");
    const person = directoryPerson();
    nextIdentity = person.member;
    const { res, state, browser } = await startRedirect(s);
    expect(res.headers.location).toBe(`https://idp.test/authorize?state=${state}`);
    expect(setCookies(res).find((c) => c.startsWith("spiderfolio_sso="))).toMatch(
      /HttpOnly.*SameSite=Lax|SameSite=Lax.*HttpOnly/,
    );
    expect(lastAuthorization.redirectUri).toBe(
      `${deps.env.APP_URL.replace(/\/+$/u, "")}/api/v1/auth/sso/${s.ws.slug}/${PLUGIN}/oidc/callback`,
    );

    const back = await callback(s, state, browser);
    expect(back.status).toBe(303);
    expect(back.headers.location).toBe(`${deps.env.APP_URL.replace(/\/+$/u, "")}/app/${s.ws.slug}`);
    expect(cookieValue(back, "spiderfolio_rt")).toBeDefined();
    const received = lastCallback;
    if (received === null) throw new Error("El callback del plugin no se llamó");
    expect(createHash("sha256").update(received.codeVerifier).digest("base64url")).toBe(
      lastAuthorization.codeChallenge,
    );
    expect(received.nonce).toBe(lastAuthorization.nonce);
    expect(received.state).toBe(state);
  });

  it("el estado sirve una sola vez", async () => {
    const s = await setup("OIDC reuso");
    nextIdentity = directoryPerson().member;
    const { state, browser } = await startRedirect(s);
    expect((await callback(s, state, browser)).headers.location).toContain(`/app/${s.ws.slug}`);
    lastCallback = null;
    const again = await callback(s, state, browser);
    expect(again.headers.location).toContain("?signin=expired");
    expect(lastCallback).toBeNull();
  });

  it("desde otro navegador o sin su cookie no sirve (y no lo gasta)", async () => {
    const s = await setup("OIDC navegador");
    nextIdentity = directoryPerson().member;
    const { state, browser } = await startRedirect(s);
    expect((await callback(s, state, "otro-navegador")).headers.location).toContain(
      "?signin=expired",
    );
    expect((await callback(s, state, null)).headers.location).toContain("?signin=expired");
    expect(lastCallback).toBeNull();
    expect((await callback(s, state, browser)).headers.location).toContain(`/app/${s.ws.slug}`);
  });

  it("el estado de una empresa no sirve en otra", async () => {
    const a = await setup("OIDC A");
    const b = await setup("OIDC B");
    nextIdentity = directoryPerson().member;
    const { state, browser } = await startRedirect(a);
    const res = await callback(b, state, browser, b.ws.slug);
    expect(res.headers.location).toContain(`/login/${b.ws.slug}?signin=expired`);
    expect(lastCallback).toBeNull();
    expect(await ctx.prisma.session.count({ where: { authWorkspaceId: b.ws.workspaceId } })).toBe(
      0,
    );
  });

  it("un flujo vencido no sirve", async () => {
    const s = await setup("OIDC vencido");
    nextIdentity = directoryPerson().member;
    const { state, browser } = await startRedirect(s);
    await ctx.prisma.ssoFlow.updateMany({
      where: { workspaceId: s.ws.workspaceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await callback(s, state, browser)).headers.location).toContain("?signin=expired");
  });
});

describe("MFA del proveedor de identidad", () => {
  async function linkedWithTotp(s: Setup) {
    const person = directoryPerson();
    nextIdentity = person.member;
    const first = await startRedirect(s);
    await callback(s, first.state, first.browser);
    await ctx.prisma.user.update({
      where: { email: person.member.email },
      data: { totpEnabledAt: new Date() },
    });
    return person;
  }

  it("con mfa en el token no pide la 2FA propia; sin ella, sí", async () => {
    const s = await setup("MFA proveedor");
    const person = await linkedWithTotp(s);
    nextIdentity = { ...person.member, mfa: true };
    const withMfa = await startRedirect(s);
    const trusted = await callback(s, withMfa.state, withMfa.browser);
    expect(trusted.headers.location).toContain(`/app/${s.ws.slug}`);

    nextIdentity = { ...person.member, mfa: false };
    const without = await startRedirect(s);
    const asked = await callback(s, without.state, without.browser);
    expect(asked.headers.location).toContain(`/login/${s.ws.slug}#challenge=`);
    expect(cookieValue(asked, "spiderfolio_rt")).toBeUndefined();
  });

  it("si la empresa no lo acepta, la pide igual", async () => {
    const s = await setup("MFA no aceptada");
    const person = await linkedWithTotp(s);
    const directory = directoryOf(s);
    expect(await directory.trustProviderMfa()).toBe(true);
    await directory.setTrustProviderMfa(false);
    nextIdentity = { ...person.member, mfa: true };
    const flow = await startRedirect(s);
    const res = await callback(s, flow.state, flow.browser);
    expect(res.headers.location).toContain("#challenge=");
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: s.ws.workspaceId, action: "directory.mfa_trust.disable" },
      }),
    ).toBe(1);
  });
});

describe("secretos", () => {
  const SECRET = "contraseña-de-la-cuenta-de-servicio-9f8e7d";

  it("se guardan cifrados y atados a la empresa, el plugin y la clave", async () => {
    const a = await setup("Secretos A");
    const b = await setup("Secretos B");
    const secrets = a.runtime.contextFor(a.ws.workspaceId, PLUGIN).secrets;
    await secrets.set("bindPassword", SECRET);
    expect(await secrets.get("bindPassword")).toBe(SECRET);
    expect(await secrets.has("bindPassword")).toBe(true);
    const row = await ctx.prisma.pluginSecret.findFirstOrThrow({
      where: { workspaceId: a.ws.workspaceId },
    });
    expect(row.valueEnc).not.toContain(SECRET);

    // Copied to another company or under another key, it doesn't decrypt.
    await ctx.prisma.pluginSecret.create({
      data: {
        workspaceId: b.ws.workspaceId,
        pluginId: PLUGIN,
        key: "bindPassword",
        valueEnc: row.valueEnc,
      },
    });
    await expect(
      b.runtime.contextFor(b.ws.workspaceId, PLUGIN).secrets.get("bindPassword"),
    ).rejects.toThrow();
    await ctx.prisma.pluginSecret.create({
      data: {
        workspaceId: a.ws.workspaceId,
        pluginId: PLUGIN,
        key: "clientSecret",
        valueEnc: row.valueEnc,
      },
    });
    await expect(secrets.get("clientSecret")).rejects.toThrow();
  });

  it("sin clave de cifrado no se puede guardar", async () => {
    const ws = await createWorkspace(ctx, "Secretos sin clave");
    const runtime = await testPluginRuntime(ctx, [plugin], [ws.workspaceId]);
    await expect(
      runtime.contextFor(ws.workspaceId, PLUGIN).secrets.set("bindPassword", SECRET),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("ni el secreto ni las contraseñas aparecen en respuestas, auditoría ni logs", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "trace" }, { write: (line: string) => lines.push(line) });
    const s = await setup("Secretos logs", { logger });
    await s.runtime.contextFor(s.ws.workspaceId, PLUGIN).secrets.set("bindPassword", SECRET);
    const person = directoryPerson();
    const responses = [
      await request(s.app).get(`/api/v1/auth/sso/options?workspace=${s.ws.slug}`),
      await passwordLogin(s, { username: person.username, password: "contraseña-equivocada-1" }),
      await passwordLogin(s, { username: "rompe", password: "contraseña-equivocada-2" }),
      await passwordLogin(s, { username: person.username, password: person.password }),
    ];
    const audit = await ctx.prisma.auditLog.findMany({ where: { workspaceId: s.ws.workspaceId } });
    const everything = [
      ...lines,
      ...responses.map((res) =>
        JSON.stringify({ body: res.body as unknown, headers: res.headers }),
      ),
      JSON.stringify(audit),
    ].join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const value of [
      SECRET,
      person.password,
      "contraseña-equivocada-1",
      "contraseña-equivocada-2",
    ]) {
      expect(everything).not.toContain(value);
    }
  });
});

describe("cuentas sin contraseña local", () => {
  it("una cuenta del directorio no entra por /login hasta pedir una contraseña", async () => {
    const s = await setup("Sin contraseña");
    const person = directoryPerson();
    await passwordLogin(s, person);
    const res = await request(s.app)
      .post("/api/v1/auth/login")
      .send({ email: person.member.email, password: person.password });
    expect(res.status).toBe(401);
    // A PIN account still can't have a password or email (the CHECK didn't loosen that).
    const user = await createUser(ctx.prisma);
    await expect(
      ctx.prisma.user.update({ where: { id: user.id }, data: { kind: "PIN" } }),
    ).rejects.toThrow();
  });
});
