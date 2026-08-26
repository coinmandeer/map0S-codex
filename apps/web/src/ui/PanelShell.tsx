import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getMapStore } from "../store/mapStore";
import { useIsMobile } from "./useIsMobile";
import { Icon } from "./primitives";

/** Fractions of the viewport the mobile sheet snaps to: peek, half, near-full. */
const SNAP_POINTS = [0.3, 0.62, 0.9] as const;
const DEFAULT_SNAP = 1;

/** Shared chrome for the left-docked panels (Places, Discover). Desktop renders a fixed
 *  sidebar; mobile renders a draggable bottom sheet that snaps between three heights so the
 *  map stays partly visible while browsing a list. */
export function PanelShell({
  title,
  testId,
  headerExtra,
  className,
  children
}: {
  title: string;
  testId: string;
  headerExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const store = getMapStore();
  const mobile = useIsMobile();
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const dragRef = useRef<{ startY: number; startFraction: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Reset to the default height whenever the sheet is re-mounted (mode switch, reopen) so a
  // panel never reappears collapsed to a sliver the user last dragged it to.
  useEffect(() => {
    if (!mobile) setSnap(DEFAULT_SNAP);
  }, [mobile]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!mobile) return;
      dragRef.current = { startY: e.clientY, startFraction: SNAP_POINTS[snap]! };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [mobile, snap]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = asideRef.current;
    if (!drag || !el) return;
    const delta = (drag.startY - e.clientY) / window.innerHeight;
    const fraction = Math.min(0.92, Math.max(0.18, drag.startFraction + delta));
    el.style.setProperty("--panel-snap", `${fraction * 100}dvh`);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = asideRef.current;
    dragRef.current = null;
    if (!drag || !el) return;
    const delta = (drag.startY - e.clientY) / window.innerHeight;
    const fraction = drag.startFraction + delta;
    let nearest = 0;
    for (let i = 1; i < SNAP_POINTS.length; i += 1) {
      if (Math.abs(SNAP_POINTS[i]! - fraction) < Math.abs(SNAP_POINTS[nearest]! - fraction))
        nearest = i;
    }
    el.style.removeProperty("--panel-snap");
    setSnap(nearest);
  }, []);

  return (
    <>
      <div className="panel-left-overlay" onClick={() => store.setSidebarOpen(false)} />
      <aside
        ref={asideRef}
        className={`panel-left${className ? ` ${className}` : ""}`}
        data-testid={testId}
        data-snap={mobile ? snap : undefined}
      >
        {mobile && (
          <div
            className="panel-grabber"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="slider"
            tabIndex={0}
            aria-label="Výška panelu"
            aria-valuemin={0}
            aria-valuemax={SNAP_POINTS.length - 1}
            aria-valuenow={snap}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") setSnap((s) => Math.min(SNAP_POINTS.length - 1, s + 1));
              if (e.key === "ArrowDown") setSnap((s) => Math.max(0, s - 1));
            }}
          >
            <span className="panel-handle" />
          </div>
        )}
        <div className="panel-left-header">
          <h2>{title}</h2>
          {headerExtra}
          <button
            className="icon-btn small"
            onClick={() => store.setSidebarOpen(false)}
            aria-label="Zavřít"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="panel-left-body" data-testid="layer-switcher">
          {children}
        </div>
      </aside>
    </>
  );
}
