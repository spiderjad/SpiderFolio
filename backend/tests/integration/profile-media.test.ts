// Foto de perfil y portada: solo JPG, PNG o WebP reales de hasta 5 MB, solo claves propias, y la
// imagen se sirve desde una dirección que cambia con cada versión.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(64),
]);

async function world() {
  const ws = await createWorkspace(ctx, "Fotos");
  const me = await addMember(ctx, ws, { name: "Persona Foto" });
  const other = await addMember(ctx, ws, { name: "Otra Foto" });
  const call = (method: "post" | "put" | "delete", path: string, body?: object, token = me.token) =>
    request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body);
  /** Pide la subida, sube los bytes a S3 y devuelve la clave. */
  const upload = async (kind: "avatar" | "cover", bytes: Buffer, token = me.token) => {
    const start = await call(
      "post",
      `/auth/profile-media/${kind}/upload`,
      { contentType: "image/webp", size: bytes.length },
      token,
    );
    expect(start.status).toBe(200);
    const { url, key } = start.body as { url: string; key: string };
    const put = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/webp" },
      body: new Uint8Array(bytes),
    });
    expect(put.ok).toBe(true);
    return key;
  };
  const user = () => ctx.prisma.user.findUniqueOrThrow({ where: { id: me.user.id } });
  return { me, other, call, upload, user };
}

describe("foto de perfil y portada", () => {
  it("una imagen WebP válida se guarda y se sirve", async () => {
    const w = await world();
    const key = await w.upload("avatar", WEBP);
    expect((await w.call("post", "/auth/profile-media/avatar/confirm", { key })).status).toBe(204);
    expect((await w.user()).avatarKey).toBe(key);
    const served = await request(app).get(`/api/v1/user-media/avatar/${w.me.user.id}`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/webp");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("lo que no es una imagen real se rechaza y se borra, aunque diga ser WebP", async () => {
    const w = await world();
    const key = await w.upload("avatar", Buffer.from("<html><script>alert(1)</script></html>"));
    const res = await w.call("post", "/auth/profile-media/avatar/confirm", { key });
    expect(res.status).toBe(400);
    expect((await w.user()).avatarKey).toBeNull();
    expect(await ctx.deps.storage.head(key)).toBeNull();
  });

  it("no se confirma la imagen de otra persona ni de otro tipo", async () => {
    const w = await world();
    const foreign = await w.upload("avatar", WEBP, w.other.token);
    expect(
      (await w.call("post", "/auth/profile-media/avatar/confirm", { key: foreign })).status,
    ).toBe(400);
    // Una clave de portada no vale como foto.
    const cover = await w.upload("cover", WEBP);
    expect(
      (await w.call("post", "/auth/profile-media/avatar/confirm", { key: cover })).status,
    ).toBe(400);
    expect((await w.user()).avatarKey).toBeNull();
  });

  it("más de 5 MB no se puede ni pedir", async () => {
    const w = await world();
    const res = await w.call("post", "/auth/profile-media/avatar/upload", {
      contentType: "image/webp",
      size: 5 * 1024 * 1024 + 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("la portada guarda su encuadre; quitar vuelve al estado inicial y borra el archivo", async () => {
    const w = await world();
    const key = await w.upload("cover", WEBP);
    expect(
      (await w.call("post", "/auth/profile-media/cover/confirm", { key, positionY: 30 })).status,
    ).toBe(204);
    expect((await w.user()).coverPositionY).toBe(30);
    expect(
      (await w.call("put", "/auth/profile-media/cover/position", { positionY: 80 })).status,
    ).toBe(204);
    expect((await w.user()).coverPositionY).toBe(80);
    expect((await w.call("delete", "/auth/profile-media/cover")).status).toBe(204);
    const after = await w.user();
    expect(after.coverKey).toBeNull();
    expect(after.coverPositionY).toBe(50);
    expect(await ctx.deps.storage.head(key)).toBeNull();
    expect((await request(app).get(`/api/v1/user-media/cover/${w.me.user.id}`)).status).toBe(404);
  });

  it("pedir una subida exige sesión", async () => {
    const res = await request(app)
      .post("/api/v1/auth/profile-media/avatar/upload")
      .send({ contentType: "image/webp", size: 10 });
    expect(res.status).toBe(401);
  });
});
