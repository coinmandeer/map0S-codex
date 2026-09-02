import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OperationalTelemetry } from "../observability/operationalTelemetry.js";
import type { CircuitSnapshot } from "../observability/providerCircuitBreaker.js";

export interface OperationalRouteDependencies {
  token?: string;
  telemetry: OperationalTelemetry;
  circuits(): readonly CircuitSnapshot[];
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const candidate = header.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(token);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

export function registerOperationalRoutes(
  app: FastifyInstance,
  dependencies: OperationalRouteDependencies
): void {
  app.get("/internal/metrics", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!dependencies.token) return reply.code(404).send({ message: "Not found" });
    if (!authorized(request.headers.authorization, dependencies.token)) {
      reply.header("WWW-Authenticate", 'Bearer realm="MapOS operations"');
      return reply.code(401).send({ message: "Unauthorized" });
    }
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(dependencies.telemetry.openMetrics(dependencies.circuits()));
  });

  app.get("/internal/status", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!dependencies.token) return reply.code(404).send({ message: "Not found" });
    if (!authorized(request.headers.authorization, dependencies.token)) {
      reply.header("WWW-Authenticate", 'Bearer realm="MapOS operations"');
      return reply.code(401).send({ message: "Unauthorized" });
    }
    return dependencies.telemetry.snapshot(dependencies.circuits());
  });
}
