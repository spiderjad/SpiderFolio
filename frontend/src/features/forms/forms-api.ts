// Client of the forms (docs/spec/formularios.md): a form in the tree and its versioned template. The
// server checks every field again; these types mirror backend/src/modules/forms/forms.schemas.ts.
import type { CursorPage } from "@/components/ui/infinite";
import type { NodeDetail } from "@/features/files/api";
import { api, apiBlob } from "@/lib/api";

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

export type Frequency = "none" | "daily" | "weekly" | "monthly";

export interface FormSettingsView {
  responsible:
    | { type: "default"; people: { id: string; name: string }[] }
    | { type: "person"; id: string; name: string }
    | { type: "department"; id: string; name: string };
  frequency: Frequency;
  /** ISO weekdays (1 = Monday … 7 = Sunday), only for daily forms. */
  weekdays: number[];
  assignees: {
    people: { id: string; name: string }[];
    departments: { id: string; name: string }[];
  };
}

export interface FormSettingsInput {
  responsible: { type: "default" } | { type: "person" | "department"; id: string };
  frequency: Frequency;
  weekdays: number[];
  assignees: { people: string[]; departments: string[] };
}

export interface FormDetail extends NodeDetail {
  template: FormVersionView;
  canEdit: boolean;
  /** Editors and whoever is in charge see every record; the rest only theirs. */
  seesAllRecords: boolean;
  settings: FormSettingsView;
}

export interface PendingForm {
  formId: string;
  name: string;
  spaceId: string;
  periodKey: string;
  frequency: Exclude<Frequency, "none">;
}

export interface FormVersionSummary {
  version: number;
  fieldCount: number;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

const w = (slug: string, path: string) => `/w/${slug}${path}`;

export const formsKeys = {
  pending: (slug: string) => ["w", slug, "forms", "pending"] as const,
  form: (slug: string, id: string) => ["w", slug, "forms", id] as const,
  versions: (slug: string, id: string) => ["w", slug, "forms", id, "versions"] as const,
  version: (slug: string, id: string, version: number) =>
    ["w", slug, "forms", id, "versions", version] as const,
};

export const formsApi = {
  create: (slug: string, spaceId: string, body: { parentId: string | null; name: string }) =>
    api<{ form: FormDetail }>(w(slug, `/spaces/${spaceId}/forms`), { method: "POST", body }),
  get: (slug: string, id: string) => api<{ form: FormDetail }>(w(slug, `/forms/${id}`)),
  saveSettings: (slug: string, id: string, body: FormSettingsInput) =>
    api<{ settings: FormSettingsView }>(w(slug, `/forms/${id}/settings`), { method: "PUT", body }),
  pending: (slug: string) => api<{ items: PendingForm[] }>(w(slug, "/forms/pending")),
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

// ─── Records (phase 2) ──────────────────────────────────────────────────────────

export type Answer = string | number | string[];

export interface RecordView {
  id: string;
  formId: string;
  version: number;
  answers: Record<string, Answer>;
  nonConforming: string[];
  source: "app" | "qr";
  submittedAt: string;
  submittedBy: { id: string; name: string } | null;
  voided: { at: string; reason: string; by: { id: string; name: string } | null } | null;
}

export interface RecordDetail {
  record: RecordView;
  /** The fields of the version it was filled with. */
  fields: FormField[];
  files: { id: string; fieldId: string; mimeType: string }[];
  /** Whoever asks can void it (MANAGE on the form, and it isn't voided yet). */
  canVoid: boolean;
}

/** The records list's filters (days are the company's). */
export interface RecordFilters {
  from?: string | undefined;
  to?: string | undefined;
  person?: string | undefined;
  version?: number | undefined;
  nonConforming?: boolean | undefined;
  status?: "all" | "valid" | "voided" | undefined;
}

function filterQuery(filters: RecordFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.from !== undefined) params.set("from", filters.from);
  if (filters.to !== undefined) params.set("to", filters.to);
  if (filters.person !== undefined) params.set("person", filters.person);
  if (filters.version !== undefined) params.set("version", String(filters.version));
  if (filters.nonConforming === true) params.set("nonConforming", "true");
  if (filters.status !== undefined && filters.status !== "all")
    params.set("status", filters.status);
  if (cursor !== undefined) params.set("cursor", cursor);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** What the server says about each answer it didn't take. */
export interface AnswerProblem {
  fieldId: string;
  reason: "required" | "invalid";
}

export const recordsKeys = {
  list: (slug: string, formId: string, filters?: RecordFilters) =>
    filters === undefined
      ? (["w", slug, "forms", formId, "records"] as const)
      : (["w", slug, "forms", formId, "records", "list", filters] as const),
  record: (slug: string, formId: string, recordId: string) =>
    ["w", slug, "forms", formId, "records", recordId] as const,
  file: (slug: string, formId: string, recordId: string, fileId: string) =>
    ["w", slug, "forms", formId, "records", recordId, "files", fileId] as const,
};

export const recordsApi = {
  submit: (
    slug: string,
    formId: string,
    body: { version: number; answers: Record<string, Answer>; source: "app" | "qr" },
  ) => api<{ record: RecordView }>(w(slug, `/forms/${formId}/records`), { method: "POST", body }),
  list: (
    slug: string,
    formId: string,
    filters: RecordFilters,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    api<CursorPage<RecordView>>(
      w(slug, `/forms/${formId}/records${filterQuery(filters, cursor)}`),
      {
        signal,
      },
    ),
  void: (slug: string, formId: string, recordId: string, reason: string) =>
    api<{ record: RecordView }>(w(slug, `/forms/${formId}/records/${recordId}/void`), {
      method: "POST",
      body: { reason },
    }),
  export: (slug: string, formId: string, format: "csv" | "pdf", filters: RecordFilters) =>
    apiBlob(w(slug, `/forms/${formId}/export/${format}${filterQuery(filters)}`)),
  get: (slug: string, formId: string, recordId: string) =>
    api<RecordDetail>(w(slug, `/forms/${formId}/records/${recordId}`)),
  fileUrl: (slug: string, formId: string, recordId: string, fileId: string) =>
    api<{ url: string }>(w(slug, `/forms/${formId}/records/${recordId}/files/${fileId}`)),
};

/**
 * Uploads a photo or a signature for a field: asks for a presigned upload, sends the bytes straight to
 * storage and confirms it (the server checks its real bytes). Returns the file id for the answer.
 */
export async function uploadFormFile(
  slug: string,
  formId: string,
  fieldId: string,
  blob: Blob,
  contentType: "image/webp" | "image/png" | "image/jpeg",
): Promise<string> {
  const { fileId, url } = await api<{ fileId: string; url: string }>(
    w(slug, `/forms/${formId}/files`),
    {
      method: "POST",
      body: { fieldId, contentType, size: blob.size },
    },
  );
  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error("upload");
  await api<{ fileId: string }>(w(slug, `/forms/${formId}/files/${fileId}/confirm`), {
    method: "POST",
  });
  return fileId;
}
