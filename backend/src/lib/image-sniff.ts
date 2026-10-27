// Tipo real de una imagen por sus primeros bytes (no por lo que diga el nombre o el navegador).
// Solo JPG, PNG y WebP: lo que se acepta como foto de perfil o portada.
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Con los primeros 12 bytes alcanza. null si no es una de las tres. */
export function sniffImage(head: Uint8Array): ImageType | null {
  const is = (offset: number, bytes: readonly number[]) =>
    bytes.every((byte, index) => head[offset + index] === byte);
  if (is(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (is(0, [0x52, 0x49, 0x46, 0x46]) && is(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
