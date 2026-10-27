import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.ts";
import { capabilities, type Capability } from "../src/modules/roles/capabilities.ts";
import { capabilityGroups } from "../src/modules/roles/capability-groups.ts";
import {
  assertCanManageRole,
  assertRoleAllowed,
  isAdministrative,
  missingCapabilities,
  type Actor,
} from "../src/modules/roles/role-rules.ts";

const owner: Actor = { base: "OWNER", capabilities };
const admin: Actor = {
  base: "ADMIN",
  capabilities: capabilities.filter((c) => c !== "security.manage"),
};
const quality: Actor = { base: "MEMBER", capabilities: ["roles.manage", "documents.approve"] };

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : "otro";
  }
  return undefined;
}

describe("grupos de capacidades", () => {
  it("cubren cada capacidad exactamente una vez", () => {
    const grouped = capabilityGroups.flatMap((g) => [...g.capabilities]);
    expect([...grouped].sort()).toEqual([...capabilities].sort());
  });
});

describe("assertRoleAllowed", () => {
  it("un actor no puede dar seguridad, que no tiene", () => {
    expect(missingCapabilities(admin, ["security.manage", "members.view"])).toEqual([
      "security.manage",
    ]);
    expect(
      codeOf(() => {
        assertRoleAllowed(admin, { base: "MEMBER", capabilities: ["security.manage"] });
      }),
    ).toBe("FORBIDDEN");
  });

  it("el propietario puede dar cualquier capacidad", () => {
    expect(() => {
      assertRoleAllowed(owner, { base: "ADMIN", capabilities });
    }).not.toThrow();
  });

  it("nadie crea un rol con base OWNER", () => {
    expect(
      codeOf(() => {
        assertRoleAllowed(owner, { base: "OWNER", capabilities: [] });
      }),
    ).toBe("FORBIDDEN");
  });

  it("no se crea un rol con una base por encima de la propia", () => {
    expect(
      codeOf(() => {
        assertRoleAllowed(quality, { base: "ADMIN", capabilities: ["documents.approve"] });
      }),
    ).toBe("FORBIDDEN");
    expect(() => {
      assertRoleAllowed(quality, { base: "MEMBER", capabilities: ["documents.approve"] });
    }).not.toThrow();
  });

  it("un rol de invitado no lleva capacidades", () => {
    expect(
      codeOf(() => {
        assertRoleAllowed(owner, { base: "GUEST", capabilities: ["members.view"] });
      }),
    ).toBe("BAD_REQUEST");
    expect(() => {
      assertRoleAllowed(owner, { base: "GUEST", capabilities: [] });
    }).not.toThrow();
  });
});

describe("assertCanManageRole", () => {
  const custom = (caps: Capability[]) => ({
    base: "MEMBER" as const,
    capabilities: caps,
    isSystem: false,
  });

  it("los roles de sistema no se tocan", () => {
    expect(
      codeOf(() => {
        assertCanManageRole(owner, { base: "MEMBER", capabilities: [], isSystem: true });
      }),
    ).toBe("FORBIDDEN");
  });

  it("no se modifica un rol que da más poder del que se tiene", () => {
    expect(
      codeOf(() => {
        assertCanManageRole(quality, custom(["roles.manage", "security.manage"]));
      }),
    ).toBe("FORBIDDEN");
    expect(() => {
      assertCanManageRole(quality, custom(["documents.approve"]));
    }).not.toThrow();
  });
});

describe("isAdministrative", () => {
  it("un rol sin capacidades no es administrativo", () => {
    expect(isAdministrative({ capabilities: [] })).toBe(false);
    expect(isAdministrative({ capabilities: ["audit.view"] })).toBe(true);
  });
});
