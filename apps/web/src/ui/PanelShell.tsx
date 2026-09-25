import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import { getShellStore } from "../store/shellStore";
import { IconButton, ProgressLinear } from "./kit";
import {
  PANEL_SNAPS,
  defaultSnapFor,
  nearestSnap,
  readSnap,
  snapAt,
  snapHeightPx,
  snapIndex,
  writeSnap,
  type PanelSnap
} from "./panelSnap";
import {
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_KEYBOARD_STEP,
  clampLeftPanelWidth,
  leftPanelWidthBounds,
  readLeftPanelWidth,
  writeLeftPanelWidth
} from "./panelWidth";
import { captureFocusedElement, restoreFocus } from "./shell/focusRestore";
import { useIsMobile } from "./useIsMobile";

/** Dragging the handle this far down from `peek` dismisses a dismissible panel. */
const DISMISS_DRAG_PX = 120;

function chromeLayout(): {
  viewportHeight: number;
  topBarBottom: number;
  bottomNavHeight: number;
} {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    viewportHeight: window.innerHeight,
    topBarBottom: read("--chrome-top", 60),
    bottomNavHeight: read("--bottom-nav-h", 64)
  };
}

/** Shared chrome for the left-docked panels.
 *
 *  Desktop renders a full-height sidebar starting at the top edge of the viewport — the top bar
 *  floats over the map beside it rather than above it, so there is no band of wasted space at
 *  the top of the panel. Mobile renders a bottom sheet on the three snaps from §21.2, and keeps
 *  the map's bottom padding in step with the sheet height so a selected pin is never hidden
 *  underneath it.
 */
export function PanelShell({
  title,
  testId,
  headerExtra,
  className,
  busy = false,
  busyLabel,
  footer,
  dismissible = false,
  hasContent = true,
  onBack,
  backLabel,
  onSnapChange,
  children
}: {
  title: string;
  testId: string;
  headerExtra?: ReactNode;
  className?: string;
  /** Work in flight that refreshes the whole panel. Shown as a 2 px bar under the header
   *  instead of a sentence in the body — the panel keeps its previous content readable. */
  busy?: boolean;
  busyLabel?: string;
  /** Sticky bottom bar for the panel's primary action, if it has one (§4.2). */
  footer?: ReactNode;
  /** Mode panels stay at `peek` when swiped down; only a place detail closes (§21.2), so this
   *  is opt-in rather than the default. */
  dismissible?: boolean;
  /** Drives the opening snap: a panel showing a list opens full, an empty form opens half. */
  hasContent?: boolean;
  /** Renders `arrow_back` before the title. Set by a panel that covered another one — a place
   *  detail opened from Objevuj returns there instead of dropping the user on the map (§4.10). */
  onBack?: () => void;
  backLabel?: string;
  onSnapChange?: (snap: PanelSnap) => void;
  children: ReactNode;
}) {
  const shell = getShellStore();
  const mobile = useIsMobile();
  const [snap, setSnap] = useState<PanelSnap>(
    () =>
      (typeof window === "undefined" ? null : readSnap(window.sessionStorage, testId)) ??
      defaultSnapFor(testId, hasContent)
  );
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
  const desktopResizeRef = useRef<{
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const mobileDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const dragFrameRef = useRef(0);
  const asideRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${panelWidth}px`);
  }, [panelWidth]);

  // The top bar centres itself over the map area, which means it needs to know how much of the
  // window the panel is currently eating.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sidebar-w-open", mobile ? "0px" : `${panelWidth}px`);
    return () => root.style.setProperty("--sidebar-w-open", "0px");
  }, [mobile, panelWidth]);

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

  // Publish the sheet height as the map's bottom padding so `easeTo`/`fitBounds` centre into the
  // visible strip rather than behind the sheet.
  const publishSheetHeight = useCallback(
    (heightPx: number | null) => {
      const root = document.documentElement;
      if (!mobile || heightPx == null) {
        root.style.removeProperty("--sheet-h");
        return;
      }
      root.style.setProperty("--sheet-h", `${Math.round(heightPx)}px`);
    },
    [mobile]
  );

  useEffect(() => {
    if (!mobile) {
      publishSheetHeight(null);
      return;
    }
    publishSheetHeight(snapHeightPx(snap, chromeLayout()));
    return () => publishSheetHeight(null);
  }, [mobile, snap, publishSheetHeight]);

  const applySnap = useCallback(
    (next: PanelSnap) => {
      setSnap(next);
      if (typeof window !== "undefined") writeSnap(window.sessionStorage, testId, next);
      onSnapChange?.(next);
    },
    [onSnapChange, testId]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!mobile) return;
      mobileDragRef.current = {
        startY: event.clientY,
        startHeight: snapHeightPx(snap, chromeLayout())
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [mobile, snap]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = mobileDragRef.current;
      const el = asideRef.current;
      if (!drag || !el) return;
      const height = drag.startHeight + (drag.startY - event.clientY);
      // rAF-throttled: the map padding follows the finger, and doing that synchronously on every
      // pointermove costs a layout per event.
      if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = 0;
        el.style.setProperty("--panel-snap-h", `${Math.round(height)}px`);
        publishSheetHeight(height);
      });
    },
    [publishSheetHeight]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const drag = mobileDragRef.current;
      const el = asideRef.current;
      mobileDragRef.current = null;
      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = 0;
      }
      if (!drag || !el) return;
      el.style.removeProperty("--panel-snap-h");
      const draggedDown = event.clientY - drag.startY;
      const height = drag.startHeight - draggedDown;
      const layout = chromeLayout();
      if (dismissible && snap === "peek" && draggedDown >= DISMISS_DRAG_PX) {
        shell.closeLeftContext();
        return;
      }
      applySnap(nearestSnap(height, layout));
    },
    [applySnap, dismissible, shell, snap]
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
      {/* Only the `full` snap covers the map: a tap on the remaining strip brings the sheet
          back to `half` (§21.2). At `half` and `peek` the map itself takes the taps. */}
      {mobile && snap === "full" && (
        <div className="panel-left-overlay" onClick={() => applySnap("half")} aria-hidden="true" />
      )}
      <aside
        ref={asideRef}
        className={`panel-left${className ? ` ${className}` : ""}`}
        data-testid={testId}
        data-snap={mobile ? snap : undefined}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile ? "false" : undefined}
        aria-label={title}
      >
        {mobile && (
          <div
            className="panel-grabber"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => applySnap(snap === "full" ? "peek" : "full")}
            role="slider"
            tabIndex={0}
            aria-label={t("drawer.height")}
            aria-valuemin={0}
            aria-valuemax={PANEL_SNAPS.length - 1}
            aria-valuenow={snapIndex(snap)}
            aria-valuetext={t(`drawer.snap.${snap}`)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                applySnap(snapAt(snapIndex(snap) + 1));
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (snap === "peek") {
                  if (dismissible) shell.closeLeftContext();
                  return;
                }
                applySnap(snapAt(snapIndex(snap) - 1));
              }
            }}
          >
            <span className="panel-handle" />
          </div>
        )}
        <div className="panel-left-header">
          {onBack && (
            <IconButton
              icon="arrow_back"
              label={backLabel ?? t("panel.back")}
              size="sm"
              testId={`${testId}-back`}
              onClick={onBack}
            />
          )}
          <h2>{title}</h2>
          {headerExtra}
          <IconButton
            icon="close"
            label={t("panel.close")}
            size="sm"
            onClick={() => shell.closeLeftContext()}
          />
        </div>
        {busy && (
          <div className="panel-left-progress" data-testid={`${testId}-busy`}>
            <ProgressLinear label={busyLabel ?? t("status.loading")} />
          </div>
        )}
        <div id={`${testId}-body`} className="panel-left-body" data-testid="layer-switcher">
          {children}
        </div>
        {footer && <div className="panel-left-footer">{footer}</div>}
        {!mobile && (
          <div
            className="panel-left-resizer"
            data-testid="left-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label={t("panel.resize")}
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
