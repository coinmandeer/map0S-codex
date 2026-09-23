import type { FastifyReply, FastifyRequest } from "fastify";
/** Stop a detail's upstream work when its response consumer disconnects. */
export async function withRequestSignal<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", abort);
  try {
    return await work(controller.signal);
  } finally {
    request.raw.off("aborted", abort);
    reply.raw.off("close", abort);
  }
}
