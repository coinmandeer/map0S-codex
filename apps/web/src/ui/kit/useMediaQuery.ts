import { useEffect, useState } from "react";

/** Subscribes to a media query. Used where a layout decision cannot be expressed in CSS —
 *  a segmented control collapsing to icons, say, since CSS media queries cannot switch a
 *  component's accessible name. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
