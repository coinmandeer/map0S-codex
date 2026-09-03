import { LayersDrawer } from "./layers/LayersDrawer";
import { t } from "../i18n/cs";

/** Compatibility shell for `VITE_APP_SHELL_V2=0`, where the layers drawer still opens as a
 *  floating menu from the old top bar. The content is the real drawer; this wrapper only
 *  supplies the frame the legacy shell expects and goes away with it (§6). */
export function LayersMegaMenu({ onClose, mobile }: { onClose: () => void; mobile: boolean }) {
  return (
    <>
      {mobile && <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick={onClose} />}
      <div
        className={`layers-megamenu ${mobile ? "is-sheet" : ""}`}
        role="dialog"
        aria-label={t("layers.title")}
      >
        {mobile && <div className="panel-handle" />}
        <div className="overflow-title-row">
          <div className="overflow-title">{t("layers.title")}</div>
          {mobile && (
            <button
              type="button"
              className="sheet-close"
              onClick={onClose}
              aria-label={t("panel.close")}
            >
              ✕
            </button>
          )}
        </div>
        <LayersDrawer />
      </div>
    </>
  );
}
