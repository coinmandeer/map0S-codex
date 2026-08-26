import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { LAYER_MODES } from "./modes";
import { useIsMobile } from "./useIsMobile";
import { Icon } from "./primitives";

export function BottomNav() {
  const mobile = useIsMobile();
  const store = getMapStore();
  const mode = useMapStoreSnapshot((s) => s.mode);

  if (!mobile) return null;

  return (
    <nav className="bottom-nav" aria-label="Režim mapy" data-testid="bottom-nav">
      {LAYER_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`bottom-nav-item ${mode === item.id ? "active" : ""}`}
          data-testid={item.testId}
          onClick={() => store.setMode(item.id)}
        >
          <span className="bottom-nav-icon">
            <Icon name={item.icon} size={20} />
          </span>
          <span className="bottom-nav-label">{item.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}
