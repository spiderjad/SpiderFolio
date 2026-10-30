// Client of the forms (docs/spec/formularios.md): a form in the tree and its versioned template. The
// server checks every field again; these types mirror backend/src/modules/forms/forms.schemas.ts.
import type { CursorPage } from "@/components/ui/infinite";
import type { NodeDetail } from "@/features/files/api";
import { api } from "@/lib/api";

interface FieldBase {
  id: string;
  label: string;
  help?: string;
  required: boolean;
}
export interface Option {
  id: string;
  label: string;
}

export type FormField =
  | (FieldBase & { type: "text"; multiline: boolean })
  | (FieldBase & { type: "number"; unit?: string; min?: number; max?: number })
  | (FieldBase & { type: "yesno"; nonConforming: "yes" | "no" | null })
  | (FieldBase & { type: "choice"; options: Option[]; nonConforming: string[] })
  | (FieldBase & { type: "date" })
  | (FieldBase & { type: "checklist"; items: Option[] })
  | (FieldBase & { type: "photo"; max: number })
  | (FieldBase & { type: "signature" });

export type FieldType = FormField["type"];
export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "yesno",
  "choice",
  "date",
  "checklist",
  "photo",
  "signature",
];

export interface FormVersionView {
  version: number;
  fields: FormField[];
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface FormDetail extends NodeDetail {
  template: FormVersionView;
  canEdit: boolean;
}

export interface FormVersionSummary {
  version: number;
  fieldCount: number;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const formsKeys = {
  form: (slug: string, id: string) => ["w", slug, "forms", id] as const,
  versions: (slug: string, id: string) => ["w", slug, "forms", id, "versions"] as const,
  version: (slug: string, id: string, version: number) =>
    ["w", slug, "forms", id, "versions", version] as const,
};

export const formsApi = {
  create: (slug: string, spaceId: string, body: { parentId: string | null; name: string }) =>
    api<{ form: FormDetail }>(w(slug, `/spaces/${spaceId}/forms`), { method: "POST", body }),
  get: (slug: string, id: string) => api<{ form: FormDetail }>(w(slug, `/forms/${id}`)),
  saveTemplate: (slug: string, id: string, body: { baseVersion: number; fields: FormField[] }) =>
    api<{ form: FormDetail }>(w(slug, `/forms/${id}/template`), { method: "PUT", body }),
  versions: (slug: string, id: string, cursor: string | undefined, signal: AbortSignal) =>
    api<CursorPage<FormVersionSummary>>(
      w(
        slug,
        `/forms/${id}/versions${cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
      { signal },
    ),
  version: (slug: string, id: string, version: number) =>
    api<{ version: FormVersionView }>(w(slug, `/forms/${id}/versions/${String(version)}`)),
};

/** A short, unique id for a new field or option (kept across versions). */
export function newId(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
