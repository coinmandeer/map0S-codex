import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import type { LegacyModalSheet } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

const PinDetail = lazy(() =>
  import("../PinDetail").then((module) => ({ default: module.PinDetail }))
);
const AuthSheet = lazy(() =>
  import("../AuthSheet").then((module) => ({ default: module.AuthSheet }))
);
const EditLayerSheet = lazy(() =>
  import("../EditLayerSheet").then((module) => ({ default: module.EditLayerSheet }))
);
const RouteSheet = lazy(() =>
  import("../RouteSheet").then((module) => ({ default: module.RouteSheet }))
);
const CreateWizard = lazy(() =>
  import("../CreateWizard").then((module) => ({ default: module.CreateWizard }))
);

export function ModalHost() {
  const modal = useShellStoreSnapshot((state) => state.modal);
  if (modal.type === "closed") return null;
  return <OpenModalHost key={modal.sheet} sheet={modal.sheet} />;
}

function OpenModalHost({ sheet }: { sheet: LegacyModalSheet }) {
  const shell = getShellStore();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

  // PinDetail predates the shared Sheet primitive; give its compatibility surface the same
  // Escape behavior while it is being migrated into the left feature context.
  useEffect(() => {
    if (sheet !== "pin") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      shell.closeModal();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheet, shell]);

  return (
    <div className="shell-modal-host" data-testid="modal-host" data-modal={sheet}>
      <Suspense fallback={null}>
        {sheet === "pin" && <PinDetail />}
        {sheet === "auth" && <AuthSheet />}
        {sheet === "edit" && <EditLayerSheet />}
        {sheet === "route" && <RouteSheet />}
        {sheet === "wizard" && <CreateWizard />}
      </Suspense>
    </div>
  );
}
