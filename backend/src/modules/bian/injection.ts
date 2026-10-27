// Instrucciones dentro de los documentos. El modelo ya las trata como datos (prompt fijo, sin
// herramientas); acá además se detectan para avisar a quienes administran: queda en la auditoría como
// «posible instrucción sospechosa en <documento>», sin guardar el texto que la disparó. La respuesta de
// Bian nunca las menciona. La detección es una ayuda para revisar, no una barrera: no se confía en ella
// para la seguridad.
import { bianTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { normalizeText } from "./query-terms.ts";

const PATTERNS: readonly RegExp[] = [
  /ignor\w*\s+(todas?\s+)?(las\s+|tus\s+)?(instrucciones|indicaciones|reglas|ordenes)/u,
  /olvid\w*\s+(todo\s+)?(lo\s+anterior|las\s+instrucciones|tus\s+instrucciones)/u,
  /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompt)/u,
  /(revela|muestra|imprime|repite|dime|reveal|show|print|repeat)\w*\s+(tu|el|your|the)\s+(prompt|system\s+prompt|instrucciones)/u,
  /(prompt|mensaje|instrucciones)\s+(de|del)\s+sistema/u,
  /system\s+prompt/u,
  /\bahora\s+eres\b|\bactua\s+como\b|\bcomportate\s+como\b|\byou\s+are\s+now\b|\bact\s+as\b/u,
  /responde\s+(unicamente|solo|solamente)\s+/u,
  /no\s+(menciones|digas|reveles)\s+(esto|nada|que)/u,
  /\basistente\b.{0,40}\b(debe|debes|tienes\s+que)\b/u,
];

/** ¿El texto parece tener instrucciones dirigidas a un asistente de IA? */
export function looksLikeInstructionForAssistant(text: string): boolean {
  const normalized = normalizeText(text);
  return PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface InspectedDocument {
  nodeId: string;
  title: string;
  code: string | null;
  text: string;
}

const REPEAT_WINDOW_MS = 24 * 3600_000;

/**
 * Deja en la auditoría un aviso por cada documento sospechoso (uno por día como máximo, para no llenar
 * el registro cada vez que alguien pregunta). Solo guarda el documento, nunca el texto sospechoso.
 */
export async function flagSuspiciousDocuments(
  ctx: AdminContext,
  documents: readonly InspectedDocument[],
): Promise<string[]> {
  const flagged: string[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.nodeId)) continue;
    if (!looksLikeInstructionForAssistant(document.text)) continue;
    seen.add(document.nodeId);
    const recent = await ctx.db.auditLog.findFirst({
      where: {
        action: "ai.suspicious_content",
        entityId: document.nodeId,
        createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent !== null) continue;
    const label = [document.code, document.title].filter((part) => part !== null).join(" · ");
    await auditAdmin(ctx, {
      action: "ai.suspicious_content",
      entityType: "Node",
      entityId: document.nodeId,
      metadata: { message: bianTexts.suspiciousInstruction(label), document: label },
    });
    flagged.push(document.nodeId);
  }
  return flagged;
}
