// An auditor's one-time code (docs/spec/salas-de-auditoria.md): kept only as a hash bound to its room.
import { sha256 } from "../../lib/crypto.ts";

/** How long a code works. */
export const AUDIT_CODE_MINUTES = 10;
/** Wrong tries before the code stops working (another one has to be asked for). */
export const AUDIT_CODE_TRIES = 5;
/** The longest an auditor's session lasts (never past the room). */
export const AUDITOR_SESSION_HOURS = 8;

export const auditCodeHash = (roomId: string, code: string): string => sha256(`${roomId}:${code}`);
