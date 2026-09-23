import { useSyncExternalStore, type ReactNode } from "react";
import { layerActivity, activityLabel } from "../../tasks/layerActivity";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
export function useLayerActivity(id: string) {
  return useSyncExternalStore(
    layerActivity.subscribe,
    () => layerActivity.get(id),
    () => undefined
  );
}
export function LayerActivityBadge({
  id,
  children,
  enabled = true
}: {
  id: string;
  children?: ReactNode;
  enabled?: boolean;
}) {
  const state = useLayerActivity(id);
  const active = useMapStoreSnapshot((s) => !!s.activeLayers[id]?.visible);
  const phase = active && enabled ? (state?.phase ?? "queued") : "off";
  const busy = ["queued", "loading", "rendering"].includes(phase);
  return (
    <span
      className="layer-activity-icon"
      data-phase={phase}
      title={activityLabel(state)}
      aria-label={active && enabled ? activityLabel(state) : undefined}
      aria-busy={busy}
    >
      {children}
      <span className="layer-activity-mark" aria-hidden="true">
        {phase === "error"
          ? "!"
          : phase === "partial" || phase === "pending"
            ? "·"
            : phase === "ready"
              ? "✓"
              : ""}
      </span>
    </span>
  );
}
