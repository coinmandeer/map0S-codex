import { createHash } from "node:crypto";

export interface MigrationStep {
  sql: string;
  /** Re-run a bounded UPDATE until it reports zero affected rows. */
  repeatUntilNoRows?: boolean;
  /** Safety valve for a malformed repeatable statement. */
  maxBatches?: number;
  /** A concurrent index is verified and an interrupted invalid build is repaired on retry. */
  concurrentIndex?: {
    name: string;
    expectedDefinitionFragments: readonly string[];
  };
}

export interface Migration {
  version: string;
  name: string;
  checksum: string;
  steps: readonly MigrationStep[];
}

export function defineMigration(input: {
  version: string;
  name: string;
  steps: readonly MigrationStep[];
}): Migration {
  if (!/^\d{4}$/.test(input.version)) {
    throw new Error(`Migration version must be four digits: ${input.version}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(input.name)) {
    throw new Error(`Invalid migration name: ${input.name}`);
  }
  if (!input.steps.length || input.steps.some((step) => !step.sql.trim())) {
    throw new Error(`Migration ${input.version}_${input.name} has no executable SQL`);
  }

  const canonical = JSON.stringify({
    version: input.version,
    name: input.name,
    steps: input.steps.map((step) => ({
      sql: step.sql.trim().replace(/\r\n/g, "\n"),
      repeatUntilNoRows: Boolean(step.repeatUntilNoRows),
      maxBatches: step.maxBatches ?? null,
      concurrentIndex: step.concurrentIndex ?? null
    }))
  });

  return Object.freeze({
    ...input,
    steps: Object.freeze(input.steps.map((step) => Object.freeze({ ...step }))),
    checksum: createHash("sha256").update(canonical).digest("hex")
  });
}
