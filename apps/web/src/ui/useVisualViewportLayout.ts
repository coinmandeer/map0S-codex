import { useEffect } from "react";

export interface VisualViewportLayoutInput {
  layoutHeight: number;
  visualHeight: number;
  focusedEditable: boolean;
}

/** A soft keyboard is inferred only while an editable control owns focus. This avoids treating
 * browser chrome, split-screen resizing or an orientation change as a keyboard. */
export function isSoftKeyboardOpen({
  layoutHeight,
  visualHeight,
  focusedEditable
}: VisualViewportLayoutInput): boolean {
  if (!focusedEditable || !Number.isFinite(layoutHeight) || !Number.isFinite(visualHeight)) {
    return false;
  }
  const missingHeight = layoutHeight - visualHeight;
  return missingHeight >= Math.max(140, layoutHeight * 0.18);
}

function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (!(element instanceof HTMLInputElement) || element.readOnly || element.disabled) return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
  ].includes(element.type);
}

/** Publishes Visual Viewport metrics as CSS variables so mobile sheets remain above the software
 * keyboard without remounting inputs or stealing focus. Browsers without Visual Viewport keep the
 * normal dynamic-viewport fallback. */
export function useVisualViewportLayout(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;

    const apply = () => {
      const visualHeight = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardOpen = isSoftKeyboardOpen({
        layoutHeight: window.innerHeight,
        visualHeight,
        focusedEditable: isEditable(document.activeElement)
      });
      root.dataset.softKeyboard = keyboardOpen ? "open" : "closed";
      root.style.setProperty("--visual-viewport-h", `${Math.max(1, Math.round(visualHeight))}px`);
      root.style.setProperty(
        "--visual-viewport-offset-top",
        `${Math.max(0, Math.round(offsetTop))}px`
      );
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    apply();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      delete root.dataset.softKeyboard;
      root.style.removeProperty("--visual-viewport-h");
      root.style.removeProperty("--visual-viewport-offset-top");
    };
  }, []);
}
