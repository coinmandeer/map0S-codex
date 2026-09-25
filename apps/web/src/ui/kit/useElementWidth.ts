import { useLayoutEffect, useState, type RefObject } from "react";

/** Observes an element's content-box width. Used where a layout decision depends on the space
 *  an element actually has rather than on the viewport — the top bar pill sits in a strip whose
 *  width changes when a panel opens, which no media query can see.
 *
 *  The first measurement runs before paint so consumers never render one frame against a width
 *  of zero. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
