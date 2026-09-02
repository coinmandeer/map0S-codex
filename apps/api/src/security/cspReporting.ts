import type { FastifyInstance } from "fastify";

export const CSP_REPORT_CONTENT_TYPE = "application/csp-report";
export const CSP_REPORT_API_PATH = "/security/csp-report";
export const CSP_REPORT_PUBLIC_PATH = `/api${CSP_REPORT_API_PATH}`;
export const CSP_REPORT_BODY_LIMIT = 16 * 1024;

export interface CspViolationSignal {
  documentOrigin: string | null;
  blockedResource: string;
  effectiveDirective: string;
  disposition: "enforce" | "report";
  statusCode: number | null;
}

export interface CspReportingOptions {
  /** Test/operations observer receives only bounded, query-free metadata. */
  onViolation?: (signal: CspViolationSignal) => void;
}

const REPORT_VALUE_SCHEMA = {
  anyOf: [
    { type: "string", maxLength: 8_192 },
    { type: "number" },
    { type: "boolean" },
    { type: "null" }
  ]
} as const;

const CSP_REPORT_SCHEMA = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["csp-report"],
    properties: {
      "csp-report": {
        type: "object",
        maxProperties: 32,
        propertyNames: { maxLength: 80 },
        additionalProperties: REPORT_VALUE_SCHEMA
      }
    }
  }
} as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function safeResource(value: unknown): string {
  const raw = boundedString(value, 2_048);
  if (!raw) return "unknown";
  if (["inline", "eval", "self"].includes(raw)) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : "opaque";
  } catch {
    return "opaque";
  }
}

function safeOrigin(value: unknown): string | null {
  const raw = boundedString(value, 2_048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function safeDirective(value: unknown): string | null {
  const raw = boundedString(value, 80)?.toLowerCase();
  return raw && /^[a-z][a-z0-9-]*$/.test(raw) ? raw : null;
}

export function normalizeCspReport(body: unknown): CspViolationSignal | null {
  const envelope = record(body);
  const report = record(envelope?.["csp-report"]);
  if (!report) return null;
  const effectiveDirective =
    safeDirective(report["effective-directive"]) ?? safeDirective(report["violated-directive"]);
  if (!effectiveDirective) return null;
  const disposition = report.disposition === "report" ? "report" : "enforce";
  const rawStatusCode =
    typeof report["status-code"] === "number"
      ? report["status-code"]
      : typeof report["status-code"] === "string" && /^\d{1,3}$/.test(report["status-code"])
        ? Number(report["status-code"])
        : null;
  const statusCode =
    rawStatusCode !== null &&
    Number.isInteger(rawStatusCode) &&
    rawStatusCode >= 0 &&
    rawStatusCode <= 599
      ? rawStatusCode
      : null;
  return {
    documentOrigin: safeOrigin(report["document-uri"]),
    blockedResource: safeResource(report["blocked-uri"]),
    effectiveDirective,
    disposition,
    statusCode
  };
}

/** Receives browser CSP reports without reflecting or retaining attacker-controlled document data. */
export function registerCspReporting(
  app: FastifyInstance,
  options: CspReportingOptions = {}
): void {
  if (!app.hasContentTypeParser(CSP_REPORT_CONTENT_TYPE)) {
    app.addContentTypeParser(
      CSP_REPORT_CONTENT_TYPE,
      { parseAs: "string", bodyLimit: CSP_REPORT_BODY_LIMIT },
      app.getDefaultJsonParser("error", "error")
    );
  }

  app.post<{ Body: unknown }>(
    CSP_REPORT_API_PATH,
    { schema: CSP_REPORT_SCHEMA, bodyLimit: CSP_REPORT_BODY_LIMIT },
    async (request, reply) => {
      const violation = normalizeCspReport(request.body);
      if (!violation) return reply.code(400).send({ message: "Invalid CSP report" });
      options.onViolation?.(violation);
      request.log.warn({ event: "csp-violation", csp: violation }, "CSP violation received");
      return reply.code(204).send();
    }
  );
}
