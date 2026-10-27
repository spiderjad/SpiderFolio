import { z } from "zod";
import { LABEL_SIZES } from "./labels.ts";

const Id = z.string().min(1).max(64);

export const QrNodeParamsSchema = z.object({ id: Id });
export const QrParamsSchema = z.object({ qrId: Id });
export const CreateQrSchema = z.strictObject({ public: z.boolean().optional() });
export const QrImageQuerySchema = z.object({ format: z.enum(["png", "svg"]).default("png") });
export const QrLabelsQuerySchema = z.object({ size: z.enum(LABEL_SIZES).default("medium") });
export const ScanParamsSchema = z.object({ token: z.string().min(16).max(64) });
