/** Canonical document version; this evolves independently from the SDK compatibility range. */
export const MAPOS_V2_SCHEMA_VERSION = "2.0.0" as const;
/** Public package/host compatibility version; keep package.json and scaffold output aligned. */
export const MAPOS_LAYER_SDK_VERSION = "2.0.0" as const;
export const MAPOS_LAYER_SDK_RANGE = `^${MAPOS_LAYER_SDK_VERSION}` as const;
/** Runtime release that implements this SDK contract. */
export const MAPOS_HOST_RUNTIME_VERSION = "19.0.0" as const;
export const MAPOS_V2_SUPPORTED_MAJOR = 2 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface VersionEnvelope {
  schema: string;
  schemaVersion: string;
  id: string;
  revision?: number;
}

export type CompatibilityErrorCode =
  "INVALID_SCHEMA_VERSION" | "UNSUPPORTED_SCHEMA_MAJOR" | "SCHEMA_MISMATCH";

/** A serialisable error boundary for documents supplied by layers and partners. */
export class SchemaCompatibilityError extends Error {
  readonly name = "SchemaCompatibilityError";

  constructor(
    readonly code: CompatibilityErrorCode,
    message: string,
    readonly details: {
      schema?: string;
      schemaVersion?: string;
      expectedSchema?: string;
      supportedMajor?: number;
    } = {}
  ) {
    super(message);
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

export function parseSchemaVersion(value: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new SchemaCompatibilityError(
      "INVALID_SCHEMA_VERSION",
      `Schema version "${value}" must use major.minor.patch notation.`,
      { schemaVersion: value }
    );
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function assertCompatibleSchema(
  envelope: Pick<VersionEnvelope, "schema" | "schemaVersion">,
  expectedSchema: string,
  supportedMajor = MAPOS_V2_SUPPORTED_MAJOR
): void {
  if (envelope.schema !== expectedSchema) {
    throw new SchemaCompatibilityError(
      "SCHEMA_MISMATCH",
      `Expected schema "${expectedSchema}", received "${envelope.schema}".`,
      { schema: envelope.schema, schemaVersion: envelope.schemaVersion, expectedSchema }
    );
  }
  const { major } = parseSchemaVersion(envelope.schemaVersion);
  if (major !== supportedMajor) {
    throw new SchemaCompatibilityError(
      "UNSUPPORTED_SCHEMA_MAJOR",
      `Schema "${envelope.schema}" major ${major} is not supported; host supports ${supportedMajor}.`,
      {
        schema: envelope.schema,
        schemaVersion: envelope.schemaVersion,
        expectedSchema,
        supportedMajor
      }
    );
  }
}
