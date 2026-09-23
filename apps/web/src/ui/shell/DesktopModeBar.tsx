import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { Icon } from "../kit";
import { LAYER_MODES } from "../modes";
import { useIsMobile } from "../useIsMobile";

/**
 * The mode switcher on a desktop: one floating pill, bottom centre.
 *
 * It used to live inside the top bar, which made the bar carry the brand, the search field, five
 * modes and the settings button in one row — at 1440 px with a panel open the mode names were
 * the first thing to be given up, and the bar still felt full. Moving the modes down adopts the
 * phone's arrangement (§3.2) on every screen: the top edge is for finding things, the bottom
 * edge is for switching what the map is *for*, and the middle stays map.
 *
 * The pill publishes the vertical space it occupies so that legends, the timeline, the toast and
 * the activity indicator can sit above it rather than under it. Nothing else knows it exists.
 */
export function DesktopModeBar() {
  const mobile = useIsMobile();
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const host = hostRef.current;
    if (mobile || !host) {
      // On a phone the navigation bar reserves its own height (`--bottom-nav-h`), so there is
      // nothing to publish and anything reading this must fall back to zero.
      root.style.removeProperty("--modebar-bottom-h");
      return;
    }
    const publish = () => {
      // Height plus the gap the next thing up needs: consumers add this to their own bottom
      // offset, so putting the gap here keeps every one of those calls to a single term.
      const height = Math.round(host.getBoundingClientRect().height) + 12;
      root.style.setProperty("--modebar-bottom-h", `${height}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(host);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--modebar-bottom-h");
    };
  }, [mobile]);

  if (mobile) return null;

  return (
    <nav
      className="desktop-modebar"
      aria-label={t("topbar.modes")}
      data-testid="desktop-modebar"
      ref={hostRef}
    >
      {LAYER_MODES.map((item) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className="desktop-mode"
            data-active={active || undefined}
            aria-current={active ? "page" : undefined}
            data-testid={item.testId}
            title={item.description}
            onClick={() => shell.setMode(item.id)}
          >
            <Icon name={item.icon} size={20} filled={active} />
            <span className="desktop-mode-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
