import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", ".next", "certs", "playwright-report", "test-results", "playwright"]);
const patterns = [
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "github-token", re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "github-pat", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "account-key", re: new RegExp(["Account", "Key="].join("")) },
  { name: "shared-access-key", re: new RegExp(["Shared", "Access", "Key="].join("")) },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
];

const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (stat.size > 1_000_000) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      if (pattern.re.test(text)) findings.push(`${relative(root, path)}:${pattern.name}`);
    }
  }
}

walk(root);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("secret scan found nothing");
