import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Two-handle range over a numeric scale.
 *
 * `<input type="range">` has one thumb, so a from–to range has to be built by hand. Pointer
 * events cover mouse, touch and pen in one path; arrow keys and `aria-valuenow` are what make
 * it usable without a pointer at all, which a pair of styled divs would not be.
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
  label,
  testId,
  children
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  format: (value: number) => string;
  label: string;
  testId?: string;
  /** Rendered behind the track — the density histogram, in practice. */
  children?: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<0 | 1 | null>(null);

  const [from, to] = value;
  const span = max - min || 1;
  const percent = (v: number) => ((v - min) / span) * 100;

  const valueAt = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return min;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round((min + ratio * span) / step) * step;
    },
    [min, span, step]
  );

  const move = useCallback(
    (handle: 0 | 1, next: number) => {
      const clamped = Math.min(max, Math.max(min, next));
      // Handles push rather than cross: dragging "from" past "to" would silently swap which
      // handle you are holding.
      onChange(handle === 0 ? [Math.min(clamped, to), to] : [from, Math.max(clamped, from)]);
    },
    [from, to, min, max, onChange]
  );

  const onPointerDown = (handle: 0 | 1) => (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = handle;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    move(dragging.current, valueAt(e.clientX));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = null;
  };

  const onKeyDown = (handle: 0 | 1) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = handle === 0 ? from : to;
    // A day at a time with arrows, a week with page keys: the units the range is read in.
    const delta =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? -step
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? step
          : e.key === "PageDown"
            ? -step * 7
            : e.key === "PageUp"
              ? step * 7
              : e.key === "Home"
                ? min - current
                : e.key === "End"
                  ? max - current
                  : 0;
    if (!delta) return;
    e.preventDefault();
    move(handle, current + delta);
  };

  return (
    <div className="range-slider" data-testid={testId}>
      <div className="range-track" ref={trackRef}>
        {children}
        <div
          className="range-fill"
          style={{ left: `${percent(from)}%`, right: `${100 - percent(to)}%` }}
        />
        {([0, 1] as const).map((handle) => {
          const handleValue = handle === 0 ? from : to;
          return (
            <div
              key={handle}
              className="range-handle"
              role="slider"
              tabIndex={0}
              aria-label={`${label} — ${handle === 0 ? "od" : "do"}`}
              aria-valuemin={handle === 0 ? min : from}
              aria-valuemax={handle === 0 ? to : max}
              aria-valuenow={handleValue}
              aria-valuetext={format(handleValue)}
              data-testid={testId ? `${testId}-${handle === 0 ? "from" : "to"}` : undefined}
              style={{ left: `${percent(handleValue)}%` }}
              onPointerDown={onPointerDown(handle)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown(handle)}
            />
          );
        })}
      </div>
      <div className="range-labels">
        <span>{format(from)}</span>
        <span>{format(to)}</span>
      </div>
    </div>
  );
}
