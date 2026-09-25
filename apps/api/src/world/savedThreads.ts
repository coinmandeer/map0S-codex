import type { GeoThread } from "@mapos/layer-sdk";
import type { SavedPlaceService } from "../services/savedPlaceService.js";
/** Reuses Moje places; retries never create a second bookmark for the same social thread. */
export function createThreadSaver(service: SavedPlaceService) {
  const pending = new Map<string, Promise<void>>();
  return (userId: string, thread: GeoThread): Promise<void> => {
    const key = `${userId}:${thread.id}`,
      previous = pending.get(key);
    if (previous) return previous;
    const run = (async () => {
      let cursor: string | undefined;
      const ref = `social-thread:${thread.id}`;
      do {
        const page = await service.list(userId, { limit: 100, cursor });
        if (
          page.savedPlaces.some(
            (p) => p.target.type === "external-feature" && p.target.externalFeatureRef === ref
          )
        )
          return;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      await service.create(userId, {
        target: { type: "external-feature", externalFeatureRef: ref },
        snapshot: {
          title: thread.title,
          position: [thread.lng, thread.lat],
          description: thread.body.slice(0, 500),
          sourceRefs: [{ source: "mapos-social", sourceRef: thread.id }],
          capturedAt: new Date().toISOString()
        },
        category: "message",
        tags: ["Moje zprávy"]
      });
    })().finally(() => pending.delete(key));
    pending.set(key, run);
    return run;
  };
}
