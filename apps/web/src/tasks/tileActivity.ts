import type maplibregl from "maplibre-gl";
import { layerActivity } from "./layerActivity";
/** Tracks only this layer's tile sources, including later pan requests. */
export function watchLayerTiles(
  map: maplibregl.Map,
  id: string,
  generation: number,
  settled: (partial: boolean) => void
) {
  if (typeof map.getStyle !== "function" || typeof map.isSourceLoaded !== "function")
    return () => {};
  const sources = () =>
    Object.entries(map.getStyle()?.sources ?? {})
      .filter(
        ([key, source]) =>
          (key === `source-tile-${id}` ||
            key.startsWith(`source-tile-${id}-`) ||
            key === id ||
            key === `source-${id}` ||
            key.startsWith(`source-${id}-`) ||
            key.startsWith(`${id}-`)) &&
          (source.type === "raster" || source.type === "vector")
      )
      .map(([key]) => key);
  let disposed = false;
  let timedOut = false;
  let previousFailure = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const failed = new Set<string>(),
    received = new Set<string>();
  const check = () => {
    if (disposed || timedOut) return;
    const ids = sources();
    if (!ids.length) {
      layerActivity.patch(id, generation, { phase: "off", message: "Není vybrán žádný obsah" });
      settled(false);
      return;
    }
    const ready = ids.every((source) => !!map.getSource(source) && map.isSourceLoaded(source));
    if (ready && received.size && !failed.size) previousFailure = false;
    const unhealthy = failed.size > 0 || previousFailure;
    layerActivity.patch(id, generation, {
      phase: ready ? (unhealthy ? (received.size ? "partial" : "error") : "ready") : "loading",
      unit: "tiles",
      count: received.size || undefined,
      message: unhealthy
        ? failed.size
          ? `${failed.size} dlaždic se nepodařilo načíst`
          : "Čekám na úspěšné načtení zdroje"
        : undefined
    });
    if (ready) {
      clearTimeout(deadline);
      deadline = undefined;
      settled(unhealthy);
    } else if (!deadline)
      deadline = setTimeout(() => {
        if (disposed) return;
        timedOut = true;
        previousFailure = true;
        deadline = undefined;
        layerActivity.patch(id, generation, {
          phase: received.size ? "partial" : "error",
          message: "Dlaždice se nepodařilo načíst včas"
        });
        settled(true);
      }, 30000);
  };
  const tileKey = (e: { sourceId?: string; coord?: unknown }) =>
    `${e.sourceId}:${JSON.stringify(e.coord ?? "source")}`;
  const data = (e: maplibregl.MapSourceDataEvent) => {
    if (!sources().includes(e.sourceId)) return;
    const detail = e as maplibregl.MapSourceDataEvent & { coord?: unknown };
    if (e.sourceDataType === "content" && detail.coord) {
      received.add(tileKey(detail));
      failed.delete(tileKey(detail));
    }
    check();
  };
  const error = (e: maplibregl.ErrorEvent) => {
    const event = e as maplibregl.ErrorEvent & { sourceId?: string; coord?: unknown };
    if (!event.sourceId || !sources().includes(event.sourceId)) return;
    failed.add(tileKey(event));
    previousFailure = true;
    check();
  };
  const moving = () => {
    previousFailure = previousFailure || failed.size > 0 || timedOut;
    timedOut = false;
    clearTimeout(deadline);
    deadline = undefined;
    failed.clear();
    received.clear();
  };
  map.on("sourcedata", data);
  map.on("sourcedataloading", data);
  map.on("error", error);
  map.on("movestart", moving);
  map.on("idle", check);
  check();
  return () => {
    disposed = true;
    clearTimeout(deadline);
    map.off("sourcedata", data);
    map.off("sourcedataloading", data);
    map.off("error", error);
    map.off("movestart", moving);
    map.off("idle", check);
  };
}
