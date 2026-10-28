// README link check: fails if an image or local link in README.md / README.es.md points to a file (or
// folder) that is not versioned, or carries a query string (e.g. ?v=), which GitHub does not resolve
// for repository files. External links (http, mailto) and in-page anchors are not checked.
//   node scripts/check-readme-links.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const READMES = ["README.md", "README.es.md"] as const;

/** Markdown links and images, plus src/href attributes of inline HTML. */
const TARGET = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\b(?:src|href)="([^"]+)"/g;

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file !== "");
const files = new Set(tracked);

function exists(path: string): boolean {
  const clean = path.replace(/^\.\//, "").replace(/\/$/, "");
  return files.has(clean) || tracked.some((file) => file.startsWith(`${clean}/`));
}

const problems: string[] = [];
for (const readme of READMES) {
  const lines = readFileSync(readme, "utf8").split("\n");
  lines.forEach((text, index) => {
    for (const match of text.matchAll(TARGET)) {
      const target = match[1] ?? match[2] ?? "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const where = `${readme}:${String(index + 1)}`;
      if (target.includes("?")) {
        problems.push(`${where}  ${target}  (no query strings in local paths)`);
        continue;
      }
      const path = decodeURIComponent(target.split("#")[0] ?? "");
      if (!exists(path)) problems.push(`${where}  ${target}  (not in the repository)`);
    }
  });
}

if (problems.length > 0) {
  console.error("Broken local links in the READMEs:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("README links OK.");
