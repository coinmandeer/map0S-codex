import type { FastifyInstance } from "fastify";

/**
 * An error whose message is deliberately safe to show outside the API process.
 *
 * Database and upstream clients often put SQL, bind parameters, URLs or credentials in their
 * Error.message. Only errors explicitly constructed as ClientError may cross the HTTP boundary;
 * everything else is logged server-side and replaced with a route-specific fallback.
 */
export class ClientError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export function messageForClient(error: unknown, fallback: string): string {
  return error instanceof ClientError ? error.message : fallback;
}

export function statusForClient(error: unknown, fallback = 500): number {
  return error instanceof ClientError ? error.statusCode : fallback;
}

/**
 * The only error detail permitted in default operational logs.
 *
 * `Error.message`, `cause`, stacks and enumerable client fields can contain SQL, complete
 * provider URLs (including keys), coordinates or user input. Even `Error.name` is mutable, so it
 * is reduced to a small identifier before it reaches a logger.
 */
export function safeErrorLogFields(error: unknown): { errorName: string } {
  const candidate = error instanceof Error ? error.name : "UnknownError";
  return {
    errorName: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate) ? candidate : "Error"
  };
}

/** Last line of defence for errors a route does not handle itself. */
export function registerClientSafeErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ClientError) {
      return reply.code(error.statusCode).send({ message: error.message });
    }

    // Raw Error objects can contain SQL, provider URLs, prompts, coordinates or secrets. Keep
    // only the class and correlation metadata; detailed debugging belongs in an explicitly
    // redacted local trace, never the default production request log.
    request.log.error(
      {
        ...safeErrorLogFields(error),
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? "/unmatched"
      },
      "unhandled API error"
    );
    const rawStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    const statusCode =
      typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
    const message = statusCode < 500 ? "Neplatný požadavek" : "Interní chyba serveru";
    return reply.code(statusCode).send({ message });
  });
}
