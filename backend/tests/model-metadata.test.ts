// Los metadatos de forTenant tienen que coincidir con schema.prisma: un modelo nuevo con
// workspaceId que no esté cubierto, o una relación sin declarar, hacen fallar este test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelMetadata } from "../src/db/model-metadata.ts";
import { tenantModels } from "../src/db/tenant.ts";

interface ParsedModel {
  fields: Map<string, string>;
}

function parseSchema(text: string): Map<string, ParsedModel> {
  const models = new Map<string, ParsedModel>();
  for (const match of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    const fields = new Map<string, string>();
    for (const line of body.split("\n")) {
      const field = /^\s+(\w+)\s+(\w+)(\[\]|\?)?/.exec(line);
      if (field?.[1] !== undefined && field[2] !== undefined) fields.set(field[1], field[2]);
    }
    models.set(name, { fields });
  }
  return models;
}

const schema = parseSchema(
  readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
);

describe("metadatos de modelos", () => {
  it("cubren exactamente los modelos del schema", () => {
    expect(Object.keys(modelMetadata).sort()).toEqual([...schema.keys()].sort());
  });

  it("cada modelo con workspaceId es de tenant (y solo esos)", () => {
    for (const [name, model] of schema) {
      const meta = modelMetadata[name as keyof typeof modelMetadata];
      if (name === "Workspace") expect(meta.scope).toBe("workspace");
      else expect(meta.scope, name).toBe(model.fields.has("workspaceId") ? "tenant" : "global");
    }
  });

  it("forTenant cubre todos los modelos con tenant y el workspace", () => {
    const expected = Object.entries(modelMetadata)
      .filter(([, meta]) => meta.scope !== "global")
      .map(([name]) => name);
    expect([...tenantModels].sort()).toEqual(expected.sort());
  });

  it("las relaciones declaradas coinciden con el schema", () => {
    for (const [name, model] of schema) {
      const relations = Object.fromEntries(
        [...model.fields].filter(([, type]) => schema.has(type)),
      );
      expect(modelMetadata[name as keyof typeof modelMetadata].relations, name).toEqual(relations);
    }
  });
});
