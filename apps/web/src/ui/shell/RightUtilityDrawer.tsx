import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { t } from "../../i18n/cs";
import type { RightUtility } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { IconButton, ProgressCircular } from "../kit";
import { LayersMegaMenu } from "../LayersMegaMenu";
import { useIsMobile } from "../useIsMobile";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

const BasemapContent = lazy(() =>
  import("../BasemapSheet").then((module) => ({ default: module.BasemapContent }))
);
const SettingsContent = lazy(() =>
  import("../SettingsSheet").then((module) => ({ default: module.SettingsContent }))
);

const TITLES: Record<Exclude<RightUtility["type"], "closed">, string> = {
  layers: t("topbar.layers"),
  basemaps: t("topbar.basemaps.full"),
  settings: t("topbar.settings")
};

export function RightUtilityDrawer() {
  const utility = useShellStoreSnapshot((state) => state.rightUtility);
  if (utility.type === "closed") return null;
  return <OpenRightUtilityDrawer key={utility.type} type={utility.type} />;
}

function OpenRightUtilityDrawer({ type }: { type: Exclude<RightUtility["type"], "closed"> }) {
  const shell = getShellStore();
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      shell.closeRightUtility();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shell]);

  const compatibilityTestId =
    type === "settings" ? "settings-sheet" : type === "basemaps" ? "tiles-sheet" : undefined;

  return (
    <aside
      className="shell-right-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={TITLES[type]}
      data-testid="right-utility-drawer"
      data-utility={type}
    >
      <div className="shell-right-drawer-header">
        <h2>{TITLES[type]}</h2>
        <IconButton
          ref={closeRef}
          icon="close"
          size="sm"
          label={`${t("panel.close")}: ${TITLES[type]}`}
          testId="right-utility-close"
          onClick={() => shell.closeRightUtility()}
        />
      </div>
      <div className="shell-right-drawer-body" data-testid={compatibilityTestId}>
        <Suspense fallback={<ProgressCircular label={t("status.loading")} />}>
          {type === "layers" && (
            <LayersMegaMenu mobile={false} embedded onClose={() => shell.closeRightUtility()} />
          )}
          {type === "basemaps" && <BasemapContent />}
          {type === "settings" && <SettingsContent />}
        </Suspense>
      </div>
    </aside>
  );
}
