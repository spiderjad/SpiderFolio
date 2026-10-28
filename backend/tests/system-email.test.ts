// Server SMTP: which failures are permanent (not retried) and what the admin test shows, with the
// SMTP user and password masked.
import { describe, expect, it } from "vitest";
import { classifySmtpError } from "../src/modules/email-settings/smtp.ts";
import {
  isPermanentSmtpError,
  smtpErrorDetail,
} from "../src/modules/email-settings/system-email.ts";

const smtpError = (fields: Record<string, string | number>) =>
  Object.assign(
    new Error(typeof fields.response === "string" ? fields.response : "SMTP error"),
    fields,
  );

describe("errores permanentes del SMTP", () => {
  it("credenciales rechazadas (EAUTH, 535) y remitente rechazado no se reintentan", () => {
    const auth = smtpError({ code: "EAUTH", responseCode: 535 });
    const sender = smtpError({ code: "EENVELOPE", responseCode: 553 });
    const rejected = smtpError({ code: "EMESSAGE", responseCode: 550 });
    expect(isPermanentSmtpError(classifySmtpError(auth).code)).toBe(true);
    expect(isPermanentSmtpError(classifySmtpError(sender).code)).toBe(true);
    expect(isPermanentSmtpError(classifySmtpError(rejected).code)).toBe(true);
  });

  it("los fallos de conexión, TLS y desconocidos sí se reintentan", () => {
    for (const error of [
      smtpError({ code: "ECONNECTION" }),
      smtpError({ code: "ETIMEDOUT" }),
      smtpError({ code: "ETLS", message: "TLS handshake failed" }),
      new Error("algo raro"),
      "no es un error",
    ]) {
      expect(isPermanentSmtpError(classifySmtpError(error).code)).toBe(false);
    }
  });
});

describe("detalle del error para la prueba", () => {
  it("devuelve el código, la respuesta SMTP y tapa el usuario y la contraseña", () => {
    const error = smtpError({
      code: "EAUTH",
      responseCode: 535,
      response: "535 5.7.8 Error: authentication failed for no-reply@acme.com (pass S3cr3t!)",
    });
    const detail = smtpErrorDetail(error, ["no-reply@acme.com", "S3cr3t!"]);
    expect(detail).toMatchObject({
      code: "AUTH",
      smtpCode: "EAUTH",
      responseCode: 535,
      response: "535 5.7.8 Error: authentication failed for *** (pass ***)",
    });
    expect(detail.message).not.toBe("");
    expect(detail.response).not.toContain("acme.com");
    expect(detail.response).not.toContain("S3cr3t");
  });

  it("sin respuesta del servidor usa el mensaje del error y nunca supera 300 caracteres", () => {
    const detail = smtpErrorDetail(
      smtpError({ code: "ECONNECTION", message: "x".repeat(500) }),
      [],
    );
    expect(detail.code).toBe("CONNECTION");
    expect(detail.responseCode).toBeNull();
    expect(detail.response).toHaveLength(300);
  });

  it("los valores muy cortos no se tapan (taparían palabras comunes)", () => {
    const detail = smtpErrorDetail(smtpError({ response: "550 no such user" }), ["no", ""]);
    expect(detail.response).toBe("550 no such user");
  });
});
