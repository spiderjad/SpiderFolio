// Foto de perfil y portada: la imagen se recorta y re-codifica en el navegador (sin EXIF) y se sube
// a S3 con una URL prefirmada; el servidor la confirma mirando sus bytes reales (JPG, PNG o WebP,
// hasta 5 MB) antes de guardarla en la cuenta. Se sirven por /api/v1/user-media (misma
// procedencia, cacheables: la dirección cambia con cada imagen nueva).
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { AppError, notFound } from "../../lib/errors.ts";
import { IMAGE_EXTENSIONS, sniffImage, type ImageType } from "../../lib/image-sniff.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";
import { auditGlobal } from "../audit/audit.service.ts";
import { fileMessages } from "../../i18n/index.ts";

export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export type MediaKind = "avatar" | "cover";

const ALLOWED: readonly ImageType[] = ["image/jpeg", "image/png", "image/webp"];

const column = (kind: MediaKind) => (kind === "avatar" ? "avatarKey" : "coverKey");

/** La imagen de un usuario cambia de dirección cada vez (la clave lleva un sufijo aleatorio). */
export function userMediaUrl(kind: MediaKind, userId: string, key: string | null): string | null {
  if (key === null) return null;
  const version = key.slice(key.lastIndexOf("-") + 1).replace(/\.[a-z]+$/u, "");
  return `/api/v1/user-media/${kind}/${userId}?v=${version}`;
}

const prefixOf = (userId: string, kind: MediaKind) => `users/${userId}/${kind}-`;

type Info = { ip: string | null; userAgent: string | null };

export function createProfileMedia(deps: { prisma: PrismaClient; storage: Storage }) {
  const { prisma, storage } = deps;

  return {
    /** URL prefirmada de subida. El tipo y el tamaño van firmados: no se puede subir otra cosa. */
    async startUpload(
      userId: string,
      kind: MediaKind,
      input: { contentType: ImageType; size: number },
    ): Promise<{ url: string; key: string }> {
      if (input.size > MAX_PROFILE_IMAGE_BYTES) {
        throw new AppError("PAYLOAD_TOO_LARGE", { message: fileMessages.profileImageTooLarge });
      }
      const key = `${prefixOf(userId, kind)}${randomBytes(12).toString("hex")}.${IMAGE_EXTENSIONS[input.contentType]}`;
      const url = await storage.presignPut(key, {
        size: input.size,
        contentType: input.contentType,
      });
      return { url, key };
    },

    /** Mira lo subido (tamaño y bytes reales) y, si es una imagen válida, reemplaza a la anterior. */
    async confirm(
      userId: string,
      kind: MediaKind,
      input: { key: string; positionY?: number | undefined },
      info: Info,
    ): Promise<void> {
      // Solo claves que este mismo usuario pidió para este tipo.
      if (!input.key.startsWith(prefixOf(userId, kind)) || input.key.includes("..")) {
        throw new AppError("BAD_REQUEST", { message: fileMessages.imageInvalid });
      }
      const head = await storage.head(input.key);
      if (head === null) throw new AppError("BAD_REQUEST", { message: fileMessages.imageNotReceived });
      const reject = async (message: string): Promise<never> => {
        await storage.delete(input.key);
        throw new AppError("BAD_REQUEST", { message });
      };
      if (head.size > MAX_PROFILE_IMAGE_BYTES) return await reject(fileMessages.profileImageTooLarge);
      const bytes = await readHead(
        await storage.rangeStream(input.key, 0, Math.min(head.size, 16)),
      );
      const type = sniffImage(bytes);
      const declared = ALLOWED.find((candidate) =>
        input.key.endsWith(`.${IMAGE_EXTENSIONS[candidate]}`),
      );
      if (type === null || type !== declared) {
        return await reject(fileMessages.imageTypes);
      }
      const field = column(kind);
      const before = await prisma.user.findUnique({
        where: { id: userId },
        select: { avatarKey: true, coverKey: true },
      });
      if (before === null) throw notFound();
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            [field]: input.key,
            ...(kind === "cover" && input.positionY !== undefined
              ? { coverPositionY: input.positionY }
              : {}),
          },
        });
        await auditGlobal(tx, { actorId: userId, action: `auth.profile.${kind}`, ...info });
      });
      const old = before[field];
      if (old !== null && old !== input.key) await storage.delete(old).catch(() => undefined);
    },

    async remove(userId: string, kind: MediaKind, info: Info): Promise<void> {
      const field = column(kind);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { avatarKey: true, coverKey: true },
      });
      if (user === null) throw notFound();
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { [field]: null, ...(kind === "cover" ? { coverPositionY: 50 } : {}) },
        });
        await auditGlobal(tx, { actorId: userId, action: `auth.profile.${kind}_remove`, ...info });
      });
      const old = user[field];
      if (old !== null) await storage.delete(old).catch(() => undefined);
    },

    async setCoverPosition(userId: string, positionY: number): Promise<void> {
      await prisma.user.update({ where: { id: userId }, data: { coverPositionY: positionY } });
    },

    /** Para servir la imagen: su flujo y su tipo, o 404. */
    async open(
      kind: MediaKind,
      userId: string,
    ): Promise<{ stream: Readable; contentType: ImageType }> {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { avatarKey: true, coverKey: true },
      });
      const key = user === null ? null : user[column(kind)];
      if (key === null) throw notFound();
      const contentType = ALLOWED.find((type) => key.endsWith(`.${IMAGE_EXTENSIONS[type]}`));
      if (contentType === undefined) throw notFound();
      return { stream: await storage.stream(key), contentType };
    },
  };
}

async function readHead(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
