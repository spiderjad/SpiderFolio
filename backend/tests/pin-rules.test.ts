import { describe, expect, it } from "vitest";
import { sessionExpiry } from "../src/modules/auth/sessions.service.ts";
import {
  generatePin,
  isPinFormat,
  isValidLoginName,
  isWeakPin,
  KIOSK_MAX_AGE_MS,
  normalizeLoginName,
  PIN_LOCK_BASE_MS,
  PIN_LOCK_MAX_MS,
  pinLockMs,
} from "../src/modules/pin/pin-rules.ts";
import {
  PinLoginSettingsSchema,
  readPinLoginSettings,
} from "../src/modules/workspaces/settings.ts";

describe("PIN débil", () => {
  it.each(["000000", "111111", "123456", "654321", "012345", "121212", "123123", "909090"])(
    "rechaza %s",
    (pin) => {
      expect(isWeakPin(pin)).toBe(true);
    },
  );

  it.each(["482915", "135792", "700123", "246810"])("acepta %s", (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });

  it("los PIN generados tienen 6 dígitos y nunca son débiles", () => {
    for (let i = 0; i < 500; i++) {
      const pin = generatePin();
      expect(isPinFormat(pin)).toBe(true);
      expect(isWeakPin(pin)).toBe(false);
    }
  });
});

describe("formato", () => {
  it("el PIN son exactamente 6 dígitos", () => {
    expect(isPinFormat("123456")).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", "", " 12345", "١٢٣٤٥٦"]) {
      expect(isPinFormat(bad)).toBe(false);
    }
  });

  it("el usuario se normaliza y se valida", () => {
    expect(normalizeLoginName("  JPerez ")).toBe("jperez");
    expect(isValidLoginName("j.perez-01_x")).toBe(true);
    for (const bad of ["ab", "con espacio", "ñandú", "a".repeat(33), "Mayus"]) {
      expect(isValidLoginName(bad)).toBe(false);
    }
  });
});

describe("bloqueo", () => {
  it("empieza en 15 minutos, se duplica y tiene tope de 1 hora", () => {
    expect(pinLockMs(1)).toBe(PIN_LOCK_BASE_MS);
    expect(pinLockMs(2)).toBe(2 * PIN_LOCK_BASE_MS);
    expect(pinLockMs(3)).toBe(PIN_LOCK_MAX_MS);
    expect(pinLockMs(4)).toBe(PIN_LOCK_MAX_MS);
    expect(pinLockMs(1000)).toBe(PIN_LOCK_MAX_MS);
  });
});

describe("vencimiento de la sesión de tablet", () => {
  const policy = { refreshTtlDays: 30, maxAgeDays: 90 };
  const start = new Date("2026-10-20T08:00:00Z");

  it("vence por inactividad en el lapso configurado", () => {
    const now = new Date(start.getTime() + 60_000);
    expect(sessionExpiry(start, now, policy, 300).getTime()).toBe(now.getTime() + 300_000);
  });

  it("nunca pasa del tope absoluto de 8 horas, por más que se use", () => {
    const now = new Date(start.getTime() + KIOSK_MAX_AGE_MS - 60_000);
    expect(sessionExpiry(start, now, policy, 300).getTime()).toBe(
      start.getTime() + KIOSK_MAX_AGE_MS,
    );
  });

  it("sin lapso (sesión normal) usa los días de la política", () => {
    expect(sessionExpiry(start, start, policy).getTime()).toBe(start.getTime() + 30 * 86_400_000);
  });
});

describe("ajustes de PIN del workspace", () => {
  it("por defecto está apagado, con 5 minutos y cierre tras confirmar", () => {
    expect(readPinLoginSettings({})).toEqual({
      enabled: false,
      idleMinutes: 5,
      closeAfterConfirm: true,
    });
    expect(readPinLoginSettings(null)).toMatchObject({ enabled: false });
  });

  it("lee los valores guardados y ante datos inválidos vuelve a los de por defecto", () => {
    expect(readPinLoginSettings({ pinLogin: { enabled: true, idleMinutes: 10 } })).toMatchObject({
      enabled: true,
      idleMinutes: 10,
    });
    expect(readPinLoginSettings({ pinLogin: { enabled: true, idleMinutes: 999 } })).toMatchObject({
      enabled: false,
      idleMinutes: 5,
    });
  });

  it("el lapso de inactividad va de 1 a 30 minutos", () => {
    expect(PinLoginSettingsSchema.safeParse({ idleMinutes: 0 }).success).toBe(false);
    expect(PinLoginSettingsSchema.safeParse({ idleMinutes: 31 }).success).toBe(false);
    expect(PinLoginSettingsSchema.safeParse({ idleMinutes: 30 }).success).toBe(true);
  });
});
