// Verificación de secretos: falla si algún archivo versionado contiene algo con forma de clave
// (Anthropic, Stripe, AWS, GitHub, Slack, Google, claves privadas…), si hay un .env versionado o si
// .env.example trae un valor en una variable secreta. Nunca imprime el valor: solo archivo, línea y
// regla. Se usa en el hook de git (con --staged revisa lo que se va a commitear) y en el CI.
//   node scripts/check-secrets.ts            # todos los archivos versionados
//   node scripts/check-secrets.ts --staged   # lo que está en el área de preparación
// Un valor falso a propósito (ej. en un test) se marca con «secret-scan:allow» en la misma línea.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  // «an[t]»: el prefijo no queda escrito literalmente (scripts/export-public.ts lo rechaza).
  { name: "clave de Anthropic", pattern: /sk-an[t]-[A-Za-z0-9_-]{20,}/ },
  { name: "clave secreta de Stripe en vivo (sk_live_)", pattern: /\b[sr]k_live_[0-9A-Za-z]{16,}/ },
  { name: "secreto de webhook de Stripe (whsec_)", pattern: /\bwhsec_[0-9A-Za-z]{24,}/ },
  { name: "clave de acceso de AWS (AKIA/ASIA)", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: "clave secreta de AWS",
    pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i,
  },
  { name: "token de GitHub", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "token de GitHub (fine-grained)", pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: "token de Slack", pattern: /\bxox[abprs]-[0-9A-Za-z-]{20,}/ },
  { name: "clave de API de Google", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "clave de OpenAI (sk-)", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/ },
  {
    name: "clave privada",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    name: "URL con usuario y contraseña de un servicio externo",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:(?!\$\{)[^\s@/]{8,}@(?!localhost|127\.0\.0\.1|\[::1\]|postgres\b|db\b)[\w.-]+/i,
  },
];

const ALLOW_MARK = "secret-scan:allow";
/** Archivos que no se revisan: dependencias fijadas y binarios. */
const SKIP =
  /(^|\/)(package-lock\.json|node_modules\/)|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|zip|gz|svg)$/i;

/** Variables del ejemplo cuyo valor puede venir cargado (solo desarrollo, documentado). */
const EXAMPLE_ALLOWED = new Set(["EMAIL_ENCRYPTION_KEY"]);
const SECRET_NAME =
  /(SECRET|PASSWORD|PASS|TOKEN|DSN|PRIVATE_KEY|CREDENTIAL|API_KEY|ACCESS_KEY|ENCRYPTION_KEY|_KEY$)/;

/** Las líneas de un archivo con forma de clave (sin imprimir nunca lo encontrado). */
export function scanText(file: string, text: string): Finding[] {
  if (SKIP.test(file)) return [];
  const findings: Finding[] = [];
  const isExample = /(^|\/)\.env\.example$/.test(file);
  for (const [index, line] of text.split("\n").entries()) {
    if (line.includes(ALLOW_MARK)) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) findings.push({ file, line: index + 1, rule: rule.name });
    }
    if (isExample) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trimEnd());
      const name = match?.[1];
      const value = (match?.[2] ?? "").replace(/\s+#.*$/, "").trim();
      if (
        name !== undefined &&
        SECRET_NAME.test(name) &&
        !EXAMPLE_ALLOWED.has(name) &&
        value !== ""
      ) {
        findings.push({ file, line: index + 1, rule: `${name} debe ir vacía en .env.example` });
      }
    }
  }
  return findings;
}

/** Un .env (con datos reales) nunca se versiona; solo .env.example. */
export function forbiddenFile(file: string): Finding | null {
  const base = file.split("/").pop() ?? file;
  return /^\.env(\..+)?$/.test(base) && base !== ".env.example"
    ? { file, line: 0, rule: "archivo .env versionado (solo .env.example)" }
    : null;
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function run(staged: boolean): Finding[] {
  const files = (
    staged
      ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
      : git(["ls-files", "-z"])
  )
    .split("\0")
    .filter((file) => file !== "");
  const findings: Finding[] = [];
  for (const file of files) {
    const forbidden = forbiddenFile(file);
    if (forbidden !== null) findings.push(forbidden);
    let text: string;
    try {
      // Con --staged se lee lo que se va a commitear (no el archivo del disco).
      text = staged ? git(["show", `:${file}`]) : readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    findings.push(...scanText(file, text));
  }
  return findings;
}

if (process.argv[1] !== undefined && /check-secrets\.ts$/.test(process.argv[1])) {
  const findings = run(process.argv.includes("--staged"));
  if (findings.length > 0) {
    console.error("Se encontró algo con forma de secreto en archivos versionados:\n");
    for (const finding of findings) {
      console.error(
        `  ${finding.file}${finding.line > 0 ? `:${String(finding.line)}` : ""}  ${finding.rule}`,
      );
    }
    console.error(
      "\nQuítalo (los secretos van en .env, que no se versiona). Si ya se subió a un remoto, genera una clave nueva.",
    );
    process.exit(1);
  }
  console.log("Verificación de secretos correcta.");
}
