import { BasemapsDrawer } from "./basemaps/BasemapsDrawer";
import { getMapStore } from "../store/mapStore";
import { t } from "../i18n";
import { Sheet } from "./primitives";

/** Compatibility shell for `VITE_APP_SHELL_V2=0`, which still opens surfaces as modal sheets.
 *  The drawer itself is the real component; this file goes away with the legacy shell (§6). */
export function BasemapSheet() {
  const store = getMapStore();
  return (
    <Sheet title={t("basemaps.title")} onClose={() => store.closeSheet()} testId="tiles-sheet">
      <BasemapsDrawer />
    </Sheet>
  );
}

export { BasemapsDrawer as BasemapContent };
