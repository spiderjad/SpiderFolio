// La explicación de acceso («quién accede y por qué») nunca contradice lo que decide el motor:
// para toda combinación de persona, espacio, permisos y herencia, el nivel que explica es el mismo
// que devuelve ofSpace / ofNode, y toda explicación trae al menos un motivo si hay acceso.
import { describe, expect, it } from "vitest";
import type { AccessLevel } from "../src/generated/prisma/client.ts";
import {
  computeAccess,
  type AccessActor,
  type AccessGrant,
  type AccessNode,
  type AccessSpace,
} from "../src/modules/access/access.ts";

const NOW = new Date("2026-10-21T10:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

const tree = (cut: readonly string[]) =>
  new Map<string, AccessNode>(
    (
      [
        { id: "A", parentId: null, spaceId: "S", inheritAccess: true },
        { id: "B", parentId: "A", spaceId: "S", inheritAccess: true },
        { id: "C", parentId: "B", spaceId: "S", inheritAccess: true },
        { id: "A2", parentId: null, spaceId: "S", inheritAccess: true },
      ] satisfies AccessNode[]
    ).map((node) => [node.id, { ...node, inheritAccess: !cut.includes(node.id) }]),
  );

const actor = (changes: Partial<AccessActor> = {}): AccessActor => ({
  membershipId: "me",
  base: "MEMBER",
  seatType: "FULL",
  bypass: false,
  departmentIds: new Set(["calidad"]),
  ownDepartmentIds: new Set(["calidad"]),
  ledScope: new Map(),
  ...changes,
});

const grant = (changes: Partial<AccessGrant> & { level: AccessLevel }): AccessGrant => ({
  nodeId: null,
  spaceId: null,
  membershipId: null,
  departmentId: null,
  everyone: false,
  expiresAt: null,
  includeSubareas: true,
  ...changes,
});

const actors: [string, AccessActor][] = [
  ["propietario", actor({ base: "OWNER" })],
  ["administrador", actor({ base: "ADMIN" })],
  ["bypass", actor({ bypass: true })],
  ["miembro", actor()],
  ["miembro sin departamento", actor({ departmentIds: new Set(), ownDepartmentIds: new Set() })],
  ["lectora", actor({ seatType: "READER" })],
  ["invitado", actor({ base: "GUEST", seatType: "READER" })],
  [
    "jefa",
    actor({ ledScope: new Map([["calidad", { departmentId: "calidad", rank: "HEAD" as const }]]) }),
  ],
];

const spaces: [string, Partial<AccessSpace>][] = [
  ["de la empresa", {}],
  ["privado", { isPrivate: true }],
  ["confidencial", { isPrivate: true, isConfidential: true }],
  ["del departamento", { departmentId: "calidad", departmentLevel: "EDIT" }],
  ["del departamento solo ver", { departmentId: "calidad", departmentLevel: "VIEW" }],
];

const grantSets: [string, AccessGrant[]][] = [
  ["sin permisos", []],
  ["persona en el espacio", [grant({ spaceId: "S", membershipId: "me", level: "EDIT" })]],
  [
    "departamento en el espacio",
    [grant({ spaceId: "S", departmentId: "calidad", level: "COMMENT" })],
  ],
  ["persona en una carpeta", [grant({ nodeId: "A", membershipId: "me", level: "MANAGE" })]],
  [
    "varios",
    [
      grant({ spaceId: "S", membershipId: "me", level: "VIEW" }),
      grant({ nodeId: "B", departmentId: "calidad", level: "EDIT" }),
      grant({ nodeId: "C", membershipId: "me", level: "COMMENT", expiresAt: FUTURE }),
    ],
  ],
];

const cuts: [string, string[]][] = [
  ["con herencia", []],
  ["corta en B", ["B"]],
  ["corta en A y C", ["A", "C"]],
];

describe("la explicación coincide con el motor", () => {
  for (const [actorName, who] of actors) {
    for (const [spaceName, space] of spaces) {
      for (const [grantName, grants] of grantSets) {
        for (const [cutName, cut] of cuts) {
          it(`${actorName} · espacio ${spaceName} · ${grantName} · ${cutName}`, () => {
            const resolver = computeAccess(
              who,
              {
                nodes: tree(cut),
                spaces: new Map([
                  [
                    "S",
                    {
                      id: "S",
                      isPrivate: false,
                      isConfidential: false,
                      departmentId: null,
                      departmentLevel: "EDIT",
                      includeSubareas: false,
                      ...space,
                    },
                  ],
                ]),
                grants,
              },
              NOW,
            );
            const inSpace = resolver.explainSpace("S");
            expect(inSpace.level).toBe(resolver.ofSpace("S"));
            expect(inSpace.reasons.length > 0).toBe(inSpace.level !== null);
            for (const id of ["A", "B", "C", "A2"]) {
              const explained = resolver.explainNode(id);
              expect(explained.level, id).toBe(resolver.ofNode(id));
              expect(explained.reasons.length > 0, id).toBe(explained.level !== null);
              // El primer motivo es el que decide: ninguno otorga más que el nivel final.
              expect(explained.reasons[0]?.level ?? null, id).toBe(explained.level);
            }
          });
        }
      }
    }
  }
});
