import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { emit } from "../lib/events";
import { useSyncExternalStore, useState, useEffect } from "react";
import { layerActivity } from "../tasks/layerActivity";

/** The engine owns per-layer pending state and deduplicates clicks during active requests. */
export function SearchHereButton() {
  const [batch, setBatch] = useState<string[]>([]);
  const loading = useMapStoreSnapshot((s) => s.loadingLayers);
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  useSyncExternalStore(layerActivity.subscribe, layerActivity.revision, layerActivity.revision);
  const waiting = Object.keys(active).filter(
    (id) =>
      active[id]?.visible &&
      layerActivity.get(id)?.phase &&
      ["pending", "error", "partial"].includes(layerActivity.get(id)!.phase)
  );
  const busy = batch.some(
    (id) =>
      active[id]?.visible &&
      (loading[id] ||
        ["queued", "loading", "rendering"].includes(layerActivity.get(id)?.phase ?? ""))
  );
  useEffect(() => {
    if (batch.length && !busy) setBatch([]);
  }, [batch, busy]);
  if (!busy && !waiting.length) return null;

  return (
    <button
      className="search-here-btn"
      data-testid="search-here"
      aria-busy={busy}
      disabled={busy}
      onClick={() => {
        setBatch(waiting);
        for (const id of waiting) emit("refresh-layer", { id });
      }}
    >
      {busy ? <span className="spinner" /> : null}
      {busy ? "Obnovuji" : "Hledat zde"} · {busy ? batch.length : waiting.length} vrstev
    </button>
  );
}
