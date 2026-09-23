import { createHash, randomUUID } from "node:crypto";
import type { FeatureCollection, FeatureQueryResultV2 } from "@mapos/layer-sdk";
import type { FeatureRequest } from "./featureProviders.js";
import { ClientError } from "../utils/clientError.js";

interface Snapshot {
  scope: string;
  data: FeatureCollection | FeatureQueryResultV2;
  expires: number;
  bytes: number;
}
const snapshots = new Map<string, Snapshot>();
const MAX_BYTES = 8 * 1024 * 1024;
const TTL = 60_000;
let bytes = 0;

function remove(id: string) {
  bytes -= snapshots.get(id)?.bytes ?? 0;
  snapshots.delete(id);
}
function scope(provider: string, request: FeatureRequest) {
  const query = Object.entries(request.query)
    .filter(([key]) => key !== "cursor")
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([provider, request.userId ?? null, request.bbox, query]))
    .digest("hex");
}

/** Page a bounded snapshot rather than re-running the provider for each hundred rows.
 * Cursors are opaque, short-lived, and tied to owner, provider, viewport and filters. */
export async function featurePage(
  provider: string,
  request: FeatureRequest,
  limit: number,
  load: () => Promise<FeatureCollection>
): Promise<FeatureCollection> {
  for (const [id, value] of snapshots) if (value.expires <= Date.now()) remove(id);
  const identity = scope(provider, request);
  let id: string | undefined;
  let offset = 0;
  let result: FeatureCollection;
  if (request.query.cursor) {
    const match = /^([a-f0-9-]{36}):(\d{1,6})$/.exec(request.query.cursor);
    const snapshot = match && snapshots.get(match[1]!);
    if (!snapshot || snapshot.scope !== identity)
      throw new ClientError("Výsledky vypršely. Obnov oblast.", 410);
    id = match![1]!;
    offset = Number(match![2]);
    if (!("features" in snapshot.data)) throw new ClientError("Neplatná stránka výsledků.");
    result = snapshot.data;
    if (offset >= result.features.length) throw new ClientError("Neplatná stránka výsledků.");
  } else {
    result = await load();
    if (result.features.length > limit) {
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size <= MAX_BYTES) {
        while (bytes + size > MAX_BYTES || snapshots.size >= 100)
          remove(snapshots.keys().next().value!);
        id = randomUUID();
        snapshots.set(id, {
          scope: identity,
          data: result,
          expires: Date.now() + TTL,
          bytes: size
        });
        bytes += size;
      }
    }
  }
  const features = result.features.slice(offset, offset + limit);
  const more = offset + features.length < result.features.length;
  return {
    ...result,
    features,
    query: {
      ...result.query,
      status: more ? "partial" : (result.query?.status ?? "complete"),
      truncated: more || result.query?.truncated === true,
      nextCursor: more && id ? `${id}:${offset + features.length}` : null
    }
  };
}

export function resetFeaturePages() {
  snapshots.clear();
  bytes = 0;
}

/** Keep over-budget V2 records intact, including their sources, access and revisions.
 * Provider cursors resume only after every row from the current upstream page was delivered. */
export async function featurePageV2(
  provider: string,
  request: FeatureRequest,
  limit: number,
  load: () => Promise<FeatureQueryResultV2>
): Promise<FeatureQueryResultV2> {
  for (const [id, value] of snapshots) if (value.expires <= Date.now()) remove(id);
  const identity = scope(`v2:${provider}`, request);
  const cursor = request.query.cursor;
  let result: FeatureQueryResultV2;
  let id: string | undefined;
  let offset = 0;
  if (cursor?.startsWith("mapos-page:")) {
    const match = /^mapos-page:([a-f0-9-]{36}):(\d{1,6})$/.exec(cursor);
    const snapshot = match && snapshots.get(match[1]!);
    if (!snapshot || snapshot.scope !== identity || !("data" in snapshot.data)) {
      throw new ClientError("Výsledky vypršely. Obnov oblast.", 410);
    }
    result = snapshot.data;
    id = match![1]!;
    offset = Number(match![2]);
    if (offset >= result.data.features.length) throw new ClientError("Neplatná stránka výsledků.");
  } else {
    result = await load();
    if (result.data.features.length > limit) {
      const size = Buffer.byteLength(JSON.stringify(result));
      if (size <= MAX_BYTES) {
        while (bytes + size > MAX_BYTES || snapshots.size >= 100)
          remove(snapshots.keys().next().value!);
        id = randomUUID();
        snapshots.set(id, {
          scope: identity,
          data: result,
          expires: Date.now() + TTL,
          bytes: size
        });
        bytes += size;
      }
    }
  }
  const features = result.data.features.slice(offset, offset + limit);
  const more = offset + features.length < result.data.features.length;
  return {
    ...result,
    data: { ...result.data, features },
    meta: {
      ...result.meta,
      limit,
      returned: features.length,
      truncated: more || result.meta.truncated,
      nextCursor: more
        ? id
          ? `mapos-page:${id}:${offset + features.length}`
          : null
        : result.meta.truncated
          ? result.meta.nextCursor
          : null
    }
  };
}
