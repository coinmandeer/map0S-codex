import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getShellStore } from "../store/shellStore";
import { useIsMobile } from "./useIsMobile";
import { Icon } from "./primitives";
import { captureFocusedElement, restoreFocus } from "./shell/focusRestore";
import {
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_KEYBOARD_STEP,
  clampLeftPanelWidth,
  leftPanelWidthBounds,
  readLeftPanelWidth,
  writeLeftPanelWidth
} from "./panelWidth";

/** Fractions of the viewport the mobile sheet snaps to: peek, half, near-full. */
const SNAP_POINTS = [0.3, 0.62, 0.9] as const;
const DEFAULT_SNAP = 1;
const DISMISS_DRAG_PX = 140;
const DISMISS_FRACTION = 0.22;

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
  const shell = getShellStore();
  const mobile = useIsMobile();
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    readLeftPanelWidth(
      typeof window === "undefined" ? null : window.localStorage,
      typeof window === "undefined" ? 1440 : window.innerWidth
    )
  );
  const preferredPanelWidthRef = useRef(panelWidth);
  const mobileDragRef = useRef<{ startY: number; startFraction: number } | null>(null);
  const desktopResizeRef = useRef<{
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${panelWidth}px`);
  }, [panelWidth]);

  useEffect(() => {
    const onResize = () => {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);
      setPanelWidth(clampLeftPanelWidth(preferredPanelWidthRef.current, nextViewportWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    restoreFocusRef.current = captureFocusedElement();
    return () => {
      restoreFocus(restoreFocusRef.current);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      shell.closeLeftContext();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shell]);

  // Reset to the default height whenever the sheet is re-mounted (mode switch, reopen) so a
  // panel never reappears collapsed to a sliver the user last dragged it to.
  useEffect(() => {
    if (!mobile) setSnap(DEFAULT_SNAP);
  }, [mobile]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!mobile) return;
      mobileDragRef.current = { startY: e.clientY, startFraction: SNAP_POINTS[snap]! };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [mobile, snap]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = mobileDragRef.current;
      const el = asideRef.current;
      if (!drag || !el) return;
      if (e.clientY - drag.startY >= DISMISS_DRAG_PX) {
        mobileDragRef.current = null;
        el.style.removeProperty("--panel-snap");
        shell.closeLeftContext();
        return;
      }
      const delta = (drag.startY - e.clientY) / window.innerHeight;
      const fraction = Math.min(0.92, Math.max(0.18, drag.startFraction + delta));
      el.style.setProperty("--panel-snap", `${fraction * 100}dvh`);
    },
    [shell]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = mobileDragRef.current;
      const el = asideRef.current;
      mobileDragRef.current = null;
      if (!drag || !el) return;
      const delta = (drag.startY - e.clientY) / window.innerHeight;
      const fraction = drag.startFraction + delta;
      const draggedDownPx = e.clientY - drag.startY;
      el.style.removeProperty("--panel-snap");
      if (fraction <= DISMISS_FRACTION || draggedDownPx >= DISMISS_DRAG_PX) {
        shell.closeLeftContext();
        return;
      }
      let nearest = 0;
      for (let i = 1; i < SNAP_POINTS.length; i += 1) {
        if (Math.abs(SNAP_POINTS[i]! - fraction) < Math.abs(SNAP_POINTS[nearest]! - fraction))
          nearest = i;
      }
      setSnap(nearest);
    },
    [shell]
  );

  const onDesktopResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (mobile) return;
      desktopResizeRef.current = {
        startX: event.clientX,
        startWidth: panelWidth,
        currentWidth: panelWidth
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [mobile, panelWidth]
  );

  const onDesktopResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = desktopResizeRef.current;
      if (!resize || mobile) return;
      const next = clampLeftPanelWidth(
        resize.startWidth + event.clientX - resize.startX,
        window.innerWidth
      );
      resize.currentWidth = next;
      preferredPanelWidthRef.current = next;
      setPanelWidth(next);
    },
    [mobile]
  );

  const onDesktopResizePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const resize = desktopResizeRef.current;
      desktopResizeRef.current = null;
      if (!resize || mobile) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      writeLeftPanelWidth(window.localStorage, resize.currentWidth);
    },
    [mobile]
  );

  const setPreferredPanelWidth = useCallback((next: number) => {
    const clamped = clampLeftPanelWidth(next, window.innerWidth);
    preferredPanelWidthRef.current = clamped;
    setPanelWidth(clamped);
    writeLeftPanelWidth(window.localStorage, clamped);
  }, []);

  const widthBounds = leftPanelWidthBounds(viewportWidth);

  return (
    <>
      <div className="panel-left-overlay" onClick={() => shell.closeLeftContext()} />
      <aside
        ref={asideRef}
        className={`panel-left${className ? ` ${className}` : ""}`}
        data-testid={testId}
        data-snap={mobile ? snap : undefined}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile ? "true" : undefined}
        aria-label={title}
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
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSnap((s) => Math.min(SNAP_POINTS.length - 1, s + 1));
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (snap === 0) shell.closeLeftContext();
                else setSnap((s) => Math.max(0, s - 1));
              }
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
            onClick={() => shell.closeLeftContext()}
            aria-label="Zavřít"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div id={`${testId}-body`} className="panel-left-body" data-testid="layer-switcher">
          {children}
        </div>
        {!mobile && (
          <div
            className="panel-left-resizer"
            data-testid="left-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label="Šířka levého panelu"
            aria-orientation="vertical"
            aria-controls={`${testId}-body`}
            aria-valuemin={widthBounds.min}
            aria-valuemax={widthBounds.max}
            aria-valuenow={panelWidth}
            onPointerDown={onDesktopResizePointerDown}
            onPointerMove={onDesktopResizePointerMove}
            onPointerUp={onDesktopResizePointerUp}
            onPointerCancel={onDesktopResizePointerUp}
            onDoubleClick={() => setPreferredPanelWidth(LEFT_PANEL_DEFAULT_WIDTH)}
            onKeyDown={(event) => {
              let next: number | null = null;
              if (event.key === "ArrowLeft") next = panelWidth - LEFT_PANEL_KEYBOARD_STEP;
              if (event.key === "ArrowRight") next = panelWidth + LEFT_PANEL_KEYBOARD_STEP;
              if (event.key === "Home") next = widthBounds.min;
              if (event.key === "End") next = widthBounds.max;
              if (next === null) return;
              event.preventDefault();
              setPreferredPanelWidth(next);
            }}
          />
        )}
      </aside>
    </>
  );
}
