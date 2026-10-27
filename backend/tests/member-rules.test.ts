import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.ts";
import {
  assertCanAssignRole,
  assertCanManageTarget,
  resolveSeat,
} from "../src/modules/members/member-rules.ts";
import { capabilities } from "../src/modules/roles/capabilities.ts";
import type { Actor } from "../src/modules/roles/role-rules.ts";

const owner: Actor = { base: "OWNER", capabilities };
const admin: Actor = {
  base: "ADMIN",
  capabilities: capabilities.filter((c) => c !== "security.manage"),
};

/** Código del AppError que lanza fn(...args), o undefined si no lanza. */
function codeOf<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): string | undefined {
  try {
    fn(...args);
  } catch (error) {
    return error instanceof AppError ? error.code : "otro";
  }
  return undefined;
}

describe("assertCanManageTarget", () => {
  it("un administrador no gestiona a propietarios ni a otros administradores", () => {
    expect(codeOf(assertCanManageTarget, admin, "OWNER")).toBe("FORBIDDEN");
    expect(codeOf(assertCanManageTarget, admin, "ADMIN")).toBe("FORBIDDEN");
    expect(codeOf(assertCanManageTarget, admin, "MEMBER")).toBeUndefined();
    expect(codeOf(assertCanManageTarget, owner, "OWNER")).toBeUndefined();
  });
});

describe("assertCanAssignRole", () => {
  it("el rol de propietario no se asigna desde el panel", () => {
    expect(codeOf(assertCanAssignRole, owner, { base: "OWNER", capabilities })).toBe("FORBIDDEN");
  });

  it("no se asigna un rol con capacidades que no se tienen", () => {
    expect(
      codeOf(assertCanAssignRole, admin, { base: "MEMBER", capabilities: ["security.manage"] }),
    ).toBe("FORBIDDEN");
    expect(
      codeOf(assertCanAssignRole, admin, { base: "MEMBER", capabilities: ["audit.view"] }),
    ).toBeUndefined();
  });

  it("no se asigna un rol por encima del propio nivel", () => {
    const member: Actor = { base: "MEMBER", capabilities: ["members.manage"] };
    expect(codeOf(assertCanAssignRole, member, { base: "ADMIN", capabilities: [] })).toBe(
      "FORBIDDEN",
    );
  });
});

describe("resolveSeat", () => {
  const member = { base: "MEMBER" as const, capabilities: [] };
  const administrator = { base: "ADMIN" as const, capabilities: ["members.view" as const] };
  const guest = { base: "GUEST" as const, capabilities: [] };

  it("un invitado externo es siempre lector", () => {
    expect(resolveSeat({ current: "FULL", role: guest })).toBe("READER");
    expect(codeOf(resolveSeat, { current: "READER", requested: "FULL", role: guest })).toBe(
      "BAD_REQUEST",
    );
  });

  it("un rol administrativo exige plaza completa", () => {
    expect(resolveSeat({ current: "READER", role: administrator })).toBe("FULL");
    expect(codeOf(resolveSeat, { current: "FULL", requested: "READER", role: administrator })).toBe(
      "BAD_REQUEST",
    );
  });

  it("sin restricción respeta lo pedido o la plaza actual", () => {
    expect(resolveSeat({ current: "FULL", role: member })).toBe("FULL");
    expect(resolveSeat({ current: "FULL", requested: "READER", role: member })).toBe("READER");
    expect(resolveSeat({ current: "READER", requested: "FULL", role: member })).toBe("FULL");
  });
});
