/** A context gesture starts with a press, never with a stationary cursor. */
export function attachPressGesture(
  element: HTMLElement,
  open: (x: number, y: number) => void,
  suppressClick: () => void,
  allowed: () => boolean = () => true
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let press: { id: number; x: number; y: number; fired: boolean } | null = null;
  let lastOpen = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    press = null;
  };
  const invoke = (x: number, y: number) => {
    if (!allowed()) return;
    lastOpen = Date.now();
    suppressClick();
    const rect = element.getBoundingClientRect();
    open(x - rect.left, y - rect.top);
  };
  const down = (e: PointerEvent) => {
    cancel();
    if (!e.isPrimary || e.button !== 0 || e.ctrlKey || !allowed()) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
    timer = setTimeout(() => {
      if (!press) return;
      press.fired = true;
      invoke(press.x, press.y);
    }, 650);
  };
  const move = (e: PointerEvent) => {
    if (
      press &&
      (e.pointerId !== press.id || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8)
    )
      cancel();
  };
  const up = () => {
    if (press?.fired) suppressClick();
    cancel();
  };
  const context = (e: MouseEvent) => {
    if (!allowed()) return;
    e.preventDefault();
    // Some touch browsers also dispatch contextmenu after our timer.
    if (!press?.fired && Date.now() - lastOpen > 350) invoke(e.clientX, e.clientY);
    cancel();
  };
  element.addEventListener("wheel", cancel, { passive: true });
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerleave", cancel);
  element.addEventListener("contextmenu", context);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", cancel);
  return {
    cancel,
    detach() {
      cancel();
      element.removeEventListener("wheel", cancel);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", cancel);
      element.removeEventListener("contextmenu", context);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    }
  };
}
