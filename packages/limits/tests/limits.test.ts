import { describe, expect, it } from "vitest";
import { checkLimit, LIMIT_REACHED, usageLevel } from "../src/check.ts";
import { resolveLimits, type Limits } from "../src/schema.ts";
import {
  BYTES_PER_GB,
  BYTES_PER_MB,
  bytesFromJson,
  bytesToJson,
  isByteLimit,
  limitInBaseUnits,
} from "../src/units.ts";

const limits = (values: Partial<Limits>): Limits => ({ ...resolveLimits({}), ...values });

describe("resolveLimits", () => {
  it("sin nada guardado, todo ilimitado", () => {
    expect(Object.values(resolveLimits({})).every((value) => value === null)).toBe(true);
    expect(resolveLimits(null).storageGb).toBeNull();
  });

  it("toma lo guardado e ignora lo inválido", () => {
    expect(resolveLimits({ storageGb: 50, maxFileMb: null }).storageGb).toBe(50);
    expect(resolveLimits({ storageGb: -1 }).storageGb).toBeNull();
    expect(resolveLimits({ nada: 3 }).storageGb).toBeNull();
  });
});

describe("checkLimit", () => {
  it("permite llegar exactamente al máximo", () => {
    expect(
      checkLimit(limits({ aiQueriesPerMonth: 2 }), "aiQueriesPerMonth", { used: 1, requested: 1 }),
    ).toEqual({ ok: true });
  });

  it("rechaza al pasarse por uno, con el formato LIMIT_REACHED", () => {
    expect(
      checkLimit(limits({ aiQueriesPerMonth: 2 }), "aiQueriesPerMonth", { used: 2, requested: 1 }),
    ).toEqual({
      ok: false,
      error: { code: LIMIT_REACHED, limit: "aiQueriesPerMonth", used: 2, max: 2 },
    });
  });

  it("cuenta lo reservado: dos subidas en paralelo no superan la cuota", () => {
    const half = BYTES_PER_GB / 2n;
    const oneGb = limits({ storageGb: 1 });
    expect(checkLimit(oneGb, "storageGb", { used: 0n, requested: half }).ok).toBe(true);
    const second = checkLimit(oneGb, "storageGb", {
      used: 0n,
      reserved: half,
      requested: half + 1n,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.used).toBe(Number(half));
      expect(second.error.max).toBe(Number(BYTES_PER_GB));
    }
  });

  it("los límites de almacenamiento y archivo se comparan en bytes (1024³ y 1024²)", () => {
    const maxFile = 3n * BYTES_PER_MB;
    const three = limits({ maxFileMb: 3 });
    expect(checkLimit(three, "maxFileMb", { used: 0, requested: maxFile }).ok).toBe(true);
    expect(checkLimit(three, "maxFileMb", { used: 0, requested: maxFile + 1n }).ok).toBe(false);
  });

  it("ilimitado nunca rechaza", () => {
    expect(
      checkLimit(limits({}), "storageGb", { used: 10n ** 15n, requested: 10n ** 15n }).ok,
    ).toBe(true);
  });

  it("un límite en 0 rechaza cualquier pedido", () => {
    expect(
      checkLimit(limits({ aiQueriesPerMonth: 0 }), "aiQueriesPerMonth", { used: 0, requested: 1 })
        .ok,
    ).toBe(false);
  });
});

describe("usageLevel", () => {
  const thresholds = [50, 75, 90];

  it.each([
    [0, 100, { percent: 0, threshold: null, atLimit: false }],
    [49, 100, { percent: 49, threshold: null, atLimit: false }],
    [50, 100, { percent: 50, threshold: 50, atLimit: false }],
    [80, 100, { percent: 80, threshold: 75, atLimit: false }],
    [95, 100, { percent: 95, threshold: 90, atLimit: false }],
    [100, 100, { percent: 100, threshold: 90, atLimit: true }],
    [120, 100, { percent: 120, threshold: 90, atLimit: true }],
    [1, 3, { percent: 33.33, threshold: null, atLimit: false }],
    [0, 0, { percent: 100, threshold: 90, atLimit: true }],
  ])("%d de %d", (used, max, expected) => {
    expect(usageLevel(thresholds, used, max)).toEqual(expected);
  });

  it("ilimitado no avisa", () => {
    expect(usageLevel(thresholds, 10, null)).toEqual({
      percent: null,
      threshold: null,
      atLimit: false,
    });
  });

  it("acepta bytes como BigInt", () => {
    const max = 250n * BYTES_PER_GB;
    expect(usageLevel(thresholds, (max * 9n) / 10n, max).threshold).toBe(90);
  });
});

describe("unidades (1 GB = 1024³ bytes)", () => {
  it("convierte límites a su unidad base", () => {
    expect(BYTES_PER_GB).toBe(1073741824n);
    expect(BYTES_PER_MB).toBe(1048576n);
    expect(limitInBaseUnits("storageGb", 250)).toBe(250n * 1073741824n);
    expect(limitInBaseUnits("maxFileMb", 100)).toBe(104857600n);
    expect(limitInBaseUnits("fileVersionsKept", 10)).toBe(10n);
    expect(limitInBaseUnits("storageGb", null)).toBeNull();
    expect(isByteLimit("storageGb")).toBe(true);
    expect(isByteLimit("aiQueriesPerMonth")).toBe(false);
  });

  it("serializa bytes a number para la API", () => {
    expect(bytesToJson(0n)).toBe(0);
    expect(bytesToJson(1024n * BYTES_PER_GB)).toBe(1099511627776);
    expect(bytesToJson(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => bytesToJson(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(() => bytesToJson(-1n)).toThrow(RangeError);
  });

  it("lee bytes de un number", () => {
    expect(bytesFromJson(1048576)).toBe(1048576n);
    expect(() => bytesFromJson(1.5)).toThrow(RangeError);
    expect(() => bytesFromJson(-1)).toThrow(RangeError);
    expect(() => bytesFromJson(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => bytesFromJson(Number.NaN)).toThrow(RangeError);
  });

  it("ida y vuelta sin pérdida", () => {
    const bytes = 987654321012345n;
    expect(bytesFromJson(bytesToJson(bytes))).toBe(bytes);
  });
});
