// /api/v1/storage/:token: las «URLs prefirmadas» del almacenamiento en disco local (lib/local-storage.ts).
// El token es la única credencial (como la firma de S3): fija operación, clave, vencimiento y, al
// subir, tamaño y tipo. Va antes de express.json: el cuerpo es el archivo tal cual.
//
// Lo subido se sirve desde el mismo origen que la app: por eso nunca se muestra en línea nada que pueda
// ejecutar código (HTML, SVG, XML van como descarga) y todo lo demás sale con una CSP de sandbox.
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Transform, type TransformCallback } from "node:stream";
import { Router, type Request, type Response } from "express";
import { AppError } from "../../lib/errors.ts";
import {
  partEtag,
  partPath,
  pathOf,
  writeAtomically,
  type TokenSigner,
} from "../../lib/local-storage.ts";

/** Tope de una parte (como S3): 5 GiB. */
const MAX_PART_BYTES = 5 * 1024 ** 3;
/** Tipos que el navegador podría ejecutar si se abren en línea desde nuestro origen. */
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/xml|text\/xml)/iu;

/** Corta el flujo si supera `max` bytes. */
function limitBytes(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      seen += chunk.length;
      if (seen > max) {
        done(new AppError("PAYLOAD_TOO_LARGE"));
        return;
      }
      done(null, chunk);
    },
  });
}

function tokenOf(req: Request, signer: TokenSigner) {
  const raw = req.params.token;
  const token = typeof raw === "string" ? signer.verify(raw) : null;
  if (token === null) throw new AppError("INVALID_TOKEN");
  return token;
}

/** Rango simple «bytes=a-b» (uno solo); null si no hay o no se puede servir. */
function rangeOf(header: string | undefined, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header ?? "");
  if (match === null) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return start <= end && start < size ? { start, end } : null;
}

export function localStorageRouter(input: { root: string; signer: TokenSigner }): Router {
  const { root, signer } = input;
  const router = Router();

  router.put("/:token", async (req: Request, res: Response) => {
    const token = tokenOf(req, signer);
    if (token.op === "get") throw new AppError("INVALID_TOKEN");
    if (token.op === "put") {
      // Lo mismo que firma S3: el tipo y el tamaño reservados.
      if ((req.get("content-type") ?? "") !== token.type) throw new AppError("BAD_REQUEST");
      if (Number(req.get("content-length")) !== token.size) throw new AppError("BAD_REQUEST");
      const target = pathOf(root, token.bucket, token.key);
      const size = await writeAtomically(target, req.pipe(limitBytes(token.size)));
      if (size !== token.size) {
        await rm(target, { force: true });
        throw new AppError("BAD_REQUEST");
      }
      res.status(200).end();
      return;
    }
    const path = partPath(root, token.bucket, token.uploadId, token.part);
    await writeAtomically(path, req.pipe(limitBytes(MAX_PART_BYTES)));
    res.setHeader("ETag", await partEtag(path));
    res.status(200).end();
  });

  router.get("/:token", async (req: Request, res: Response) => {
    const token = tokenOf(req, signer);
    if (token.op !== "get") throw new AppError("INVALID_TOKEN");
    const path = pathOf(root, token.bucket, token.key);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new AppError("NOT_FOUND");
    }
    const active = ACTIVE_TYPES.test(token.type);
    const disposition = active ? token.disposition.replace(/^inline/u, "attachment") : token.disposition;
    res.setHeader("Content-Type", token.type);
    res.setHeader("Content-Disposition", disposition);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Accept-Ranges", "bytes");
    // El visor de PDF del navegador no funciona en sandbox; el resto, sí (y no ejecuta nada).
    res.setHeader(
      "Content-Security-Policy",
      token.type === "application/pdf"
        ? "default-src 'none'; frame-ancestors 'self'"
        : "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
    );
    const range = rangeOf(req.get("range"), size);
    if (range === null) {
      res.setHeader("Content-Length", String(size));
      createReadStream(path).pipe(res);
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    createReadStream(path, { start: range.start, end: range.end }).pipe(res);
  });

  return router;
}
