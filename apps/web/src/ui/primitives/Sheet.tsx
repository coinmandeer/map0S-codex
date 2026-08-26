import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/** Full-width bottom sheet on mobile, centred dialog on desktop. Renders through a portal so
 *  it escapes the map's stacking context, and traps Escape while open. */
export function Sheet({
  title,
  onClose,
  variant = "auto",
  footer,
  testId,
  children
}: {
  title: string;
  onClose: () => void;
  /** "auto" picks sheet on mobile / dialog on desktop via CSS; force one to override. */
  variant?: "auto" | "sheet" | "dialog";
  footer?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isSheet =
    variant === "sheet" ||
    (variant === "auto" && typeof window !== "undefined" && window.innerWidth < 900);

  const node = (
    <>
      <div className="overlay" onClick={onClose} data-testid="sheet-overlay" />
      <div
        className={`panel ${isSheet ? "sheet" : "dialog"}`}
        role="dialog"
        aria-label={title}
        data-testid={testId}
      >
        {isSheet && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>{title}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Zavřít">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">{children}</div>
        {footer}
      </div>
    </>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

/** A labelled block inside a Sheet — used heavily by SettingsSheet. */
export function SheetSection({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="sheet-section">
      <div className="section-label">{title}</div>
      {description && <p className="meta sheet-section-desc">{description}</p>}
      {children}
    </section>
  );
}

/** One settings row: label + optional hint on the left, control on the right. */
export function SettingRow({
  label,
  hint,
  control,
  onClick,
  testId
}: {
  label: string;
  hint?: string;
  control?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <span className="setting-row-text">
        <span className="setting-row-label">{label}</span>
        {hint && <span className="setting-row-hint">{hint}</span>}
      </span>
      {control}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="setting-row" onClick={onClick} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className="setting-row" data-testid={testId}>
      {body}
    </div>
  );
}
