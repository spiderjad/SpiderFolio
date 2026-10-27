// Recorte y reducción de imágenes en el navegador, con canvas (sin librerías). Volver a dibujar la
// imagen y codificarla de nuevo elimina todos sus metadatos (EXIF, incluida la ubicación).

export const AVATAR_SIZE = 512;
export const COVER_WIDTH = 1600;
const QUALITY = 0.9;

/** La imagen ya con su orientación corregida (las fotos del celular vienen rotadas por EXIF). */
export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(file, { imageOrientation: "from-image" });
}

function toWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("No se pudo preparar la imagen."));
        else resolve(blob);
      },
      "image/webp",
      QUALITY,
    );
  });
}

export interface CropView {
  /** Lado del cuadro visible en pantalla (px). */
  frame: number;
  /** Zoom sobre el ajuste mínimo (1 = la imagen justo cubre el cuadro). */
  zoom: number;
  /** Desplazamiento de la imagen dentro del cuadro (px de pantalla). */
  offsetX: number;
  offsetY: number;
}

/** Escala (px de pantalla por px de imagen) con la que la imagen justo cubre el cuadro. */
export function coverScale(bitmap: { width: number; height: number }, frame: number): number {
  return frame / Math.min(bitmap.width, bitmap.height);
}

/** Mantiene la imagen cubriendo todo el cuadro: no deja huecos al arrastrar. */
export function clampOffset(
  bitmap: { width: number; height: number },
  view: CropView,
): { offsetX: number; offsetY: number } {
  const scale = coverScale(bitmap, view.frame) * view.zoom;
  const slackX = Math.max(0, (bitmap.width * scale - view.frame) / 2);
  const slackY = Math.max(0, (bitmap.height * scale - view.frame) / 2);
  return {
    offsetX: Math.min(slackX, Math.max(-slackX, view.offsetX)),
    offsetY: Math.min(slackY, Math.max(-slackY, view.offsetY)),
  };
}

/** El recorte cuadrado que se ve en el cuadro, a 512 × 512 px en WebP. */
export async function renderAvatar(bitmap: ImageBitmap, view: CropView): Promise<Blob> {
  const scale = coverScale(bitmap, view.frame) * view.zoom;
  const { offsetX, offsetY } = clampOffset(bitmap, view);
  // Esquina superior izquierda del cuadro, en píxeles de la imagen.
  const sx = (bitmap.width * scale - view.frame) / 2 / scale - offsetX / scale;
  const sy = (bitmap.height * scale - view.frame) / 2 / scale - offsetY / scale;
  const side = view.frame / scale;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No se pudo preparar la imagen.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return await toWebp(canvas);
}

/** La imagen completa reducida a 1600 px de ancho (nunca se agranda), en WebP. */
export async function renderCover(bitmap: ImageBitmap): Promise<Blob> {
  const width = Math.min(COVER_WIDTH, bitmap.width);
  const height = Math.round((bitmap.height * width) / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No se pudo preparar la imagen.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  return await toWebp(canvas);
}

/** Dibuja la imagen en un canvas de vista previa según el recorte (para el diálogo). */
export function drawCropPreview(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  view: CropView,
): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const scale = coverScale(bitmap, view.frame) * view.zoom;
  const { offsetX, offsetY } = clampOffset(bitmap, view);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const ratio = canvas.width / view.frame;
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  context.drawImage(
    bitmap,
    ((view.frame - w) / 2 + offsetX) * ratio,
    ((view.frame - h) / 2 + offsetY) * ratio,
    w * ratio,
    h * ratio,
  );
}
