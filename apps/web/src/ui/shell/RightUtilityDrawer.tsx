import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import type { RightUtility } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { LayersMegaMenu } from "../LayersMegaMenu";
import { Icon } from "../primitives";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

const BasemapContent = lazy(() =>
  import("../BasemapSheet").then((module) => ({ default: module.BasemapContent }))
);
const SettingsContent = lazy(() =>
  import("../SettingsSheet").then((module) => ({ default: module.SettingsContent }))
);

const TITLES: Record<Exclude<RightUtility["type"], "closed">, string> = {
  layers: "Vrstvy",
  basemaps: "Mapové podklady",
  settings: "Nastavení"
};

export function RightUtilityDrawer() {
  const utility = useShellStoreSnapshot((state) => state.rightUtility);
  if (utility.type === "closed") return null;
  return <OpenRightUtilityDrawer key={utility.type} type={utility.type} />;
}

function OpenRightUtilityDrawer({ type }: { type: Exclude<RightUtility["type"], "closed"> }) {
  const shell = getShellStore();
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

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
        <button
          ref={closeRef}
          type="button"
          className="icon-btn small"
          data-testid="right-utility-close"
          onClick={() => shell.closeRightUtility()}
          aria-label={`Zavřít: ${TITLES[type]}`}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="shell-right-drawer-body" data-testid={compatibilityTestId}>
        <Suspense fallback={<span className="spinner" aria-label="Načítám" />}>
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
