import { useEffect, useState } from "react";

/** Below this width the shell switches to the bottom-nav + bottom-sheet composition (§3.2).
 *  It is the single source of truth: the CSS media queries and the `--bottom-nav-h` /
 *  `--sidebar-w` token overrides all use the same 900 px boundary, so there is no band where
 *  the layout reserves space for chrome that is not rendered. Tablets get the phone
 *  composition because a 380 px drawer plus a 360 px sidebar leaves no map at 834 px. */
export const MOBILE_MQ = "(max-width: 899px)";

export function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
