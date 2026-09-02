import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const docsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(docsDir, "..");
const jsonPath = resolve(docsDir, "requirements-traceability-v19.json");
const markdownPath = resolve(docsDir, "requirements-traceability-v19.md");
const document = JSON.parse(readFileSync(jsonPath, "utf8"));
const markdown = readFileSync(markdownPath, "utf8");

const allowedStates = new Set([
  "verified-runtime",
  "verified-offline",
  "accepted-external-gate",
  "superseded-with-adr",
  "open"
]);
const allowedDeltaClasses = new Set(["verified", "partial", "blocked", "gap", "superseded"]);
const prefixCounts = document.validation.expectedPrefixCounts;
const expectedIds = Object.entries(prefixCounts).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`)
);
const requirements = document.requirements;
const actualIds = requirements.map(({ id }) => id);
const uniqueIds = new Set(actualIds);
const missingIds = expectedIds.filter((id) => !uniqueIds.has(id));
const unexpectedIds = actualIds.filter((id) => !expectedIds.includes(id));

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(document.source.expectedRequirementCount === 322, "Source count must be 322.");
invariant(requirements.length === 322, `Expected 322 rows, received ${requirements.length}.`);
invariant(uniqueIds.size === 322, `Expected 322 unique IDs, received ${uniqueIds.size}.`);
invariant(missingIds.length === 0, `Missing IDs: ${missingIds.join(", ")}`);
invariant(unexpectedIds.length === 0, `Unexpected IDs: ${unexpectedIds.join(", ")}`);
invariant(document.phases.length === 19, "Phase ledger must contain phases 0 through 18.");
invariant(
  document.phases.every(({ number }, index) => number === index),
  "Phase ledger must be contiguous from 0 through 18."
);

for (const requirement of requirements) {
  invariant(allowedStates.has(requirement.state), `Invalid state for ${requirement.id}.`);
  invariant(
    allowedDeltaClasses.has(requirement.deltaClass),
    `Invalid delta class for ${requirement.id}.`
  );
  invariant(requirement.originalAcceptance.trim().length > 0, `${requirement.id} lost acceptance.`);
  invariant(requirement.evidence.length > 0, `${requirement.id} has no concrete evidence link.`);
  for (const evidence of requirement.evidence) {
    invariant(
      existsSync(resolve(root, evidence.path)),
      `${requirement.id}: ${evidence.path} missing.`
    );
  }
  const markdownRows = markdown.match(new RegExp("^\\| `" + requirement.id + "` \\|", "gm")) ?? [];
  invariant(
    markdownRows.length === 1,
    `${requirement.id} has ${markdownRows.length} Markdown rows.`
  );
}

const countBy = (field, values) =>
  Object.fromEntries(
    values.map((value) => [
      value,
      requirements.filter((requirement) => requirement[field] === value).length
    ])
  );
const stateCounts = countBy("state", [...allowedStates]);
const deltaCounts = countBy("deltaClass", [...allowedDeltaClasses]);
invariant(
  JSON.stringify(stateCounts) === JSON.stringify(document.stateCounts),
  "Stored state counts do not match rows."
);
invariant(
  JSON.stringify(deltaCounts) === JSON.stringify(document.deltaCounts),
  "Stored delta counts do not match rows."
);

const sourceOverride = env.MAPOS_TRACEABILITY_SOURCE;
if (sourceOverride) {
  const source = readFileSync(resolve(sourceOverride), "utf8");
  const sha256 = createHash("sha256").update(source).digest("hex");
  invariant(sha256 === document.source.sha256, `Source SHA-256 mismatch: ${sha256}`);
  const sourceRows = source
    .split(/\r?\n/)
    .filter((line) => /^\| `[A-Z]+-\d{3}`/.test(line))
    .map((line) => {
      const columns = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((value) => value.trim());
      invariant(columns.length === 7, `Could not parse source row: ${line}`);
      return {
        id: columns[0].replaceAll("`", ""),
        requirement: columns[1],
        originalSourceStatus: columns[2].replaceAll("`", ""),
        targetPhase: columns[5],
        originalAcceptance: columns[6]
      };
    });
  invariant(sourceRows.length === 322, `Source contains ${sourceRows.length} requirement rows.`);
  for (const sourceRow of sourceRows) {
    const generated = requirements.find(({ id }) => id === sourceRow.id);
    invariant(generated, `Generated JSON is missing source row ${sourceRow.id}.`);
    for (const field of [
      "requirement",
      "originalSourceStatus",
      "targetPhase",
      "originalAcceptance"
    ]) {
      invariant(
        generated[field] === sourceRow[field],
        `${sourceRow.id} changed source field ${field}.`
      );
    }
  }
}

stdout.write(
  `${JSON.stringify(
    {
      rows: requirements.length,
      uniqueIds: uniqueIds.size,
      missingIds,
      unexpectedIds,
      phases: document.phases.length,
      stateCounts,
      deltaCounts,
      sourceSha256: document.source.sha256
    },
    null,
    2
  )}\n`
);
