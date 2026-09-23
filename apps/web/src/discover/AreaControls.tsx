import { useState, useEffect, useRef } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import "./areaControls.css";

export function AreaControls() {
  const store = getMapStore();
  const mode = useMapStoreSnapshot((s) => s.mode);
  const experience = useMapStoreSnapshot((s) => s.experienceId);
  const enabled = useMapStoreSnapshot((s) => s.boundariesEnabled);
  const area = useMapStoreSnapshot((s) => s.areaSelection);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (experience === "global" || mode === "game" || (mode !== "discover" && !area)) return null;
  return (
    <section ref={root} className="area-controls borders-control" aria-label="Borders">
      <button
        aria-label="Borders"
        aria-expanded={open}
        aria-pressed={enabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">▱</span>
      </button>
      {open && (
        <div
          className="borders-options"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <button aria-label="Zavřít hranice" onClick={() => setOpen(false)}>
            Zavřít ×
          </button>
          <button
            className="borders-toggle"
            aria-pressed={enabled}
            onClick={() => {
              store.setBoundariesEnabled(!enabled);
              store.setBoundaryLevel("auto");
            }}
          >
            {enabled ? "Vypnout hranice" : "Zapnout hranice"}
          </button>
          {area && (
            <button
              onClick={() => {
                store.setAreaSelection(null);
                store.setBoundaryLevel("auto");
              }}
            >
              Zrušit výběr oblasti
            </button>
          )}
          <small>
            Kliknutím přiblížíte oblast. V detailu ulic zůstanou pouze místa. Městské části se
            zobrazí jen tam, kde máme ověřené hranice.
          </small>
        </div>
      )}
    </section>
  );
}
