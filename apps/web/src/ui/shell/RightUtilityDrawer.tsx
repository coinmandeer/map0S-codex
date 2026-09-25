import { UnifiedLayers } from "../layers/UnifiedLayers";
import { on } from "../../lib/events";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import type { RightUtility } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { IconButton, ProgressCircular } from "../kit";

import { useIsMobile } from "../useIsMobile";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

const BasemapsDrawer = lazy(() =>
  import("../basemaps/BasemapsDrawer").then((module) => ({ default: module.BasemapsDrawer }))
);
const SettingsContent = lazy(() =>
  import("../SettingsSheet").then((module) => ({ default: module.SettingsContent }))
);

export function RightUtilityDrawer() {
  const utility = useShellStoreSnapshot((state) => state.rightUtility);
  if (utility.type === "closed") return null;
  return (
    <OpenRightUtilityDrawer
      key={utility.type === "settings" ? "settings" : "map"}
      type={utility.type}
    />
  );
}

function OpenRightUtilityDrawer({ type }: { type: Exclude<RightUtility["type"], "closed"> }) {
  const titles = {
    layers: t("topbar.layers"),
    basemaps: t("topbar.basemaps.full"),
    settings: t("topbar.settings")
  };
  const shell = getShellStore();
  const [tab, setTab] = useState(() => {
    try {
      return type === "basemaps" ? "basemaps" : sessionStorage.getItem("mapos:map-tab") || "layers";
    } catch {
      return "layers";
    }
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (type === "basemaps") setTab("basemaps");
  }, [type]);
  useEffect(() => on("layer-settings-request", () => setTab("layers")), []);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    try {
      body.scrollTop = Number(sessionStorage.getItem(`mapos:map-scroll-${tab}`) || 0);
    } catch {
      /* Optional browser state may be unavailable. */
    }
    return () => {
      try {
        sessionStorage.setItem(`mapos:map-scroll-${tab}`, String(body.scrollTop));
      } catch {
        /* Optional browser state may be unavailable. */
      }
    };
  }, [tab]);
  const selectTab = (value: string) => {
    setTab(value);
    try {
      sessionStorage.setItem("mapos:map-tab", value);
    } catch {
      /* Optional browser state may be unavailable. */
    }
  };
  const mobile = useIsMobile();
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

  // The top bar and the Podklady/Vrstvy buttons slide left by the drawer width while it is
  // open, so both stay reachable and act as a switch between the three drawers.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--drawer-w-open",
      mobile ? "0px" : getComputedStyle(root).getPropertyValue("--drawer-w").trim() || "380px"
    );
    return () => root.style.setProperty("--drawer-w-open", "0px");
  }, [mobile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(".kit-dialog, .kit-popover, .kit-menu")
      )
        return;
      event.preventDefault();
      shell.closeRightUtility();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shell]);

  const compatibilityTestId =
    type === "settings" ? "settings-sheet" : tab === "basemaps" ? "tiles-sheet" : undefined;

  return (
    <aside
      className="shell-right-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={titles[type]}
      data-testid="right-utility-drawer"
      data-utility={type}
    >
      <div className="shell-right-drawer-header">
        {type === "settings" ? (
          <h2>{titles[type]}</h2>
        ) : (
          <div className="map-panel-tabs" role="tablist" aria-label={t("topbar.layers")}>
            <button
              role="tab"
              aria-selected={tab === "layers"}
              data-testid="map-panel-tab-layers"
              onClick={() => selectTab("layers")}
            >
              {t("topbar.layers")}
            </button>
            <button
              role="tab"
              aria-selected={tab === "basemaps"}
              data-testid="map-panel-tab-basemaps"
              onClick={() => selectTab("basemaps")}
            >
              {t("topbar.basemaps.full")}
            </button>
          </div>
        )}
        <IconButton
          ref={closeRef}
          icon="close"
          size="sm"
          label={`${t("panel.close")}: ${titles[type]}`}
          testId="right-utility-close"
          onClick={() => shell.closeRightUtility()}
        />
      </div>
      <div ref={bodyRef} className="shell-right-drawer-body" data-testid={compatibilityTestId}>
        <Suspense fallback={<ProgressCircular label={t("status.loading")} />}>
          {type !== "settings" && (tab === "layers" ? <UnifiedLayers /> : <BasemapsDrawer />)}
          {type === "settings" && <SettingsContent />}
        </Suspense>
      </div>
    </aside>
  );
}
