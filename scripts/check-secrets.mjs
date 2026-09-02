import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage"
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const highConfidencePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bghp_[0-9A-Za-z]{36}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{50,}\b/,
  /\bsk-(?:live-|proj-)?[0-9A-Za-z_-]{20,}\b/,
  /\bsk_live_[0-9A-Za-z]{20,}\b/
];
const sensitiveAssignment =
  /^\s*([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|PRIVATE_KEY))\s*=\s*(.+?)\s*$/;
const safeExampleValue =
  /^(?:""|''|\$\{|<|change[_-]?me|replace[_-]?me|example|test-only|local-development)/i;

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await filesUnder(path)));
    } else if (entry.isFile()) {
      output.push(path);
    }
  }
  return output;
}

const findings = [];
for (const path of await filesUnder(root)) {
  const rel = relative(root, path);
  if (rel === "scripts/check-secrets.mjs") continue;
  const extension = rel.slice(rel.lastIndexOf("."));
  const isEnvironmentExample = rel === ".env.example" || rel.endsWith("/.env.production.example");
  if (!textExtensions.has(extension) && !isEnvironmentExample) continue;
  if ((await stat(path)).size > 2_000_000) continue;
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (highConfidencePatterns.some((pattern) => pattern.test(line))) {
      findings.push(`${rel}:${index + 1}: high-confidence secret pattern`);
    }
    if (isEnvironmentExample) {
      const assignment = line.match(sensitiveAssignment);
      const value = assignment?.[2]?.trim();
      if (value && !safeExampleValue.test(value)) {
        findings.push(`${rel}:${index + 1}: non-placeholder value for ${assignment?.[1]}`);
      }
    }
  }
}

if (findings.length) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret/source and built-artifact scan passed.\n");
}
