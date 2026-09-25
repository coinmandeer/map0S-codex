import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import type { LegacyModalSheet } from "../../store/shellState";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { captureFocusedElement, restoreFocus } from "./focusRestore";

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
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

  return (
    <div className="shell-modal-host" data-testid="modal-host" data-modal={sheet}>
      <Suspense fallback={null}>
        {sheet === "auth" && <AuthSheet />}
        {sheet === "edit" && <EditLayerSheet />}
        {sheet === "route" && <RouteSheet />}
        {sheet === "wizard" && <CreateWizard />}
      </Suspense>
    </div>
  );
}
