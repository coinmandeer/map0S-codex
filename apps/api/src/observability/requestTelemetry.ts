import type { FastifyInstance } from "fastify";
import { enterRequestCorrelation } from "./correlation.js";
import type { OperationalTelemetry } from "./operationalTelemetry.js";

/** Installs server-generated correlation IDs and privacy-safe request completion metrics/logs. */
export function registerRequestTelemetry(
  app: FastifyInstance,
  telemetry: OperationalTelemetry
): void {
  const started = new WeakMap<object, number>();
  app.addHook("onRequest", (request, reply, done) => {
    started.set(request, performance.now());
    reply.header("X-Request-ID", request.id);
    enterRequestCorrelation(request.id);
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = Math.max(0, performance.now() - (started.get(request) ?? performance.now()));
    const route = request.routeOptions.url ?? "/unmatched";
    telemetry.recordRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs
    });
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: route.includes("?") ? "/unmatched" : route,
        statusCode: reply.statusCode,
        durationMs: Math.round(durationMs)
      },
      "request completed"
    );
    done();
  });
}
