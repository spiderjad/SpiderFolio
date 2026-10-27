// Imágenes de una página: se reducen a 1600 px de ancho y se codifican de nuevo en WebP en el
// navegador (sin metadatos, ni ubicación), se suben directo a S3 con una URL prefirmada y se
// confirman para que el servidor revise sus bytes reales.
import { pagesApi } from "@/features/files/api";
import { loadBitmap, renderCover } from "@/lib/image-crop";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;

export const isPageImage = (file: File) => (IMAGE_TYPES as readonly string[]).includes(file.type);

export class ImageRejected extends Error {}

export async function uploadPageImage(slug: string, pageId: string, file: File): Promise<string> {
  if (!isPageImage(file)) throw new ImageRejected("Solo se aceptan imágenes JPG, PNG o WebP.");
  if (file.size > MAX_ORIGINAL_BYTES) throw new ImageRejected("La imagen es demasiado grande.");
  const blob = await renderCover(await loadBitmap(file));
  const { imageId, url } = await pagesApi.startImage(slug, pageId, {
    contentType: "image/webp",
    size: blob.size,
  });
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/webp" },
    body: blob,
  });
  if (!put.ok) throw new Error("No se pudo subir la imagen.");
  await pagesApi.confirmImage(slug, pageId, imageId);
  return imageId;
}
