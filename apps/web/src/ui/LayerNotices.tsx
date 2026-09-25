import { getLayerPlugin } from "../layers";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";

/**
 * Explains a layer that came back empty on purpose.
 *
 * Without this an upstream refusing the request ("zoom in", "missing key", "service down") and
 * an area that genuinely has nothing in it are the same blank map, and the user is left to
 * guess which one they're looking at.
 */
export function LayerNotices({ inline = false }: { inline?: boolean } = {}) {
  const notices = useMapStoreSnapshot((s) => s.layerNotices);
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const inAreaControls = useMapStoreSnapshot(
    (s) => s.mode !== "game" && (s.mode === "discover" || !!s.areaSelection)
  );

  const visible = Object.entries(notices).filter(([layerId]) => active[layerId]?.visible);
  if (!visible.length || (!inline && inAreaControls)) return null;

  return (
    <div className={inline ? "area-layer-notices" : "layer-notices"} data-testid="layer-notice">
      {visible.map(([layerId, message]) => {
        const manifest = getLayerPlugin(layerId)?.manifest;
        return (
          <div key={layerId} className="layer-notice">
            <span className="layer-notice-icon">{manifest?.icon ?? "ℹ️"}</span>
            <span className="layer-notice-text">
              <strong>{manifest?.name ?? layerId}</strong> {message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
