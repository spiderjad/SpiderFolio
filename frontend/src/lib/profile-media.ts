// Subida de la foto de perfil y la portada: se pide una URL prefirmada, se sube la imagen ya
// recortada (WebP) directo a S3 y se confirma para que el servidor revise sus bytes reales.
import { api } from "@/lib/api";

export type MediaKind = "avatar" | "cover";

export async function uploadProfileImage(
  kind: MediaKind,
  blob: Blob,
  options: { positionY?: number } = {},
): Promise<void> {
  const { url, key } = await api<{ url: string; key: string }>(
    `/auth/profile-media/${kind}/upload`,
    { method: "POST", body: { contentType: "image/webp", size: blob.size } },
  );
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/webp" },
    body: blob,
  });
  if (!put.ok) throw new Error("No se pudo subir la imagen.");
  await api(`/auth/profile-media/${kind}/confirm`, {
    method: "POST",
    body: { key, ...(options.positionY === undefined ? {} : { positionY: options.positionY }) },
  });
}

export const removeProfileImage = (kind: MediaKind) =>
  api(`/auth/profile-media/${kind}`, { method: "DELETE" });

export const saveCoverPosition = (positionY: number) =>
  api("/auth/profile-media/cover/position", { method: "PUT", body: { positionY } });
