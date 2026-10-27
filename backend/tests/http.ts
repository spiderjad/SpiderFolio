// Tipos para las respuestas de supertest (res.body llega como any).
import type { ErrorBody } from "../src/lib/errors.ts";

interface Response {
  body: unknown;
}

export interface ApiBody {
  workspace: { id: string; name: string; slug: string };
  membership: {
    id: string;
    role: { base: string };
    capabilities: string[];
    departmentIds: string[];
  };
}

export const errorOf = (res: Response) => (res.body as ErrorBody).error;
export const bodyOf = (res: Response) => res.body as ApiBody;
