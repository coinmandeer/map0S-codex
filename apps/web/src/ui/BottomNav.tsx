import { getShellStore } from "../store/shellStore";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { LAYER_MODES } from "./modes";
import { useIsMobile } from "./useIsMobile";
import { Icon } from "./primitives";

export function BottomNav() {
  const mobile = useIsMobile();
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);

  if (!mobile) return null;

  return (
    <nav className="bottom-nav" aria-label="Režim mapy" data-testid="bottom-nav">
      {LAYER_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`bottom-nav-item ${mode === item.id ? "active" : ""}`}
          data-testid={item.testId}
          onClick={() => shell.setMode(item.id)}
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
