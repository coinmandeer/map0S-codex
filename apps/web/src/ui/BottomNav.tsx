import { getShellStore } from "../store/shellStore";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { Icon } from "./kit";
import { LAYER_MODES } from "./modes";
import { useIsMobile } from "./useIsMobile";

/** M3 navigation bar: the mode switcher on phones (§3.2).
 *
 *  The active item is marked by a pill behind the icon rather than a bordered card, and the
 *  item count comes from the mode registry, so adding Feed as a fifth mode needs no change
 *  here. Tapping the active mode again is handled by the sheet, not by this component. */
export function BottomNav() {
  const mobile = useIsMobile();
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);

  if (!mobile) return null;

  return (
    <nav className="bottom-nav" aria-label="Režim mapy" data-testid="bottom-nav">
      {LAYER_MODES.map((item) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className="bottom-nav-item"
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            data-testid={item.testId}
            onClick={() => shell.setMode(item.id)}
          >
            <span className="bottom-nav-indicator">
              <Icon name={item.icon} size={24} filled={active} />
            </span>
            <span className="bottom-nav-label">{item.shortLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}
