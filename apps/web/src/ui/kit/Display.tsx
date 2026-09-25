import { type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Chip({
  label,
  icon,
  active = false,
  color,
  onClick,
  onRemove,
  disabled = false,
  testId
}: {
  label: ReactNode;
  icon?: IconName;
  active?: boolean;
  /** A data-domain colour, shown as a leading dot. Not the chip's own background — a
   *  saturated chip competes with the map. */
  color?: string;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const content = (
    <>
      {color && <span className="kit-chip-dot" style={{ background: color }} />}
      {icon && <Icon name={icon} size={16} filled={active} />}
      <span className="kit-chip-label">{label}</span>
      {onRemove && (
        <span
          className="kit-chip-remove"
          role="button"
          tabIndex={-1}
          aria-label="Odebrat"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" size={16} />
        </span>
      )}
    </>
  );

  if (!onClick) {
    return (
      <span className="kit-chip" data-active={active || undefined} data-testid={testId}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="kit-chip"
      data-active={active || undefined}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {content}
    </button>
  );
}

export function Badge({
  count,
  max = 99,
  tone = "accent",
  testId
}: {
  count: number;
  max?: number;
  tone?: "accent" | "neutral" | "danger";
  testId?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className="kit-badge"
      data-tone={tone}
      /* Re-keying on the value restarts the pop animation, so the badge reacts when a layer
         is toggled rather than silently changing number. */
      key={count}
      data-testid={testId}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

export function Divider({ inset = false }: { inset?: boolean }) {
  return <hr className="kit-divider" data-inset={inset || undefined} />;
}

/** A titled block inside a panel. A heading plus a divider, never a card — the nesting rule
 *  in §2.4 allows exactly one bordered surface per panel, and that is reserved for items. */
export function Section({
  title,
  eyebrow,
  action,
  children,
  testId
}: {
  title?: string;
  /** The only sanctioned uppercase text in the UI. */
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="kit-section" data-testid={testId}>
      {(title || eyebrow || action) && (
        <header className="kit-section-header">
          <div className="kit-section-heading">
            {eyebrow && <span className="kit-eyebrow">{eyebrow}</span>}
            {title && <h2 className="kit-section-title">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function ListItem({
  icon,
  iconColor,
  title,
  subtitle,
  trailing,
  onClick,
  active = false,
  disabled = false,
  href,
  ariaLabel,
  testId
}: {
  icon?: IconName;
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  href?: string;
  /** Overrides the accessible name when the visible title alone does not say what activating
   *  the row does — "Vyhlídka" versus "Otevřít detail místa Vyhlídka". */
  ariaLabel?: string;
  testId?: string;
}) {
  const body = (
    <>
      {icon && (
        <Icon
          name={icon}
          size={20}
          filled={active}
          className="kit-list-icon"
          style={iconColor ? ({ color: iconColor } as CSSProperties) : undefined}
        />
      )}
      <span className="kit-list-text">
        <span className="kit-list-title">{title}</span>
        {subtitle && <span className="kit-list-subtitle">{subtitle}</span>}
      </span>
    </>
  );

  // The trailing slot is a sibling of the activating control rather than inside it: rows very
  // often carry a switch or an overflow menu, and a button nested in a button is invalid HTML
  // that browsers resolve by dropping the inner one.
  const trailingSlot = trailing && <span className="kit-list-trailing">{trailing}</span>;

  if (href) {
    return (
      <div className="kit-list-row" data-active={active || undefined} data-testid={testId}>
        <a className="kit-list-item" href={href} target="_blank" rel="noreferrer">
          {body}
        </a>
        {trailingSlot}
      </div>
    );
  }

  if (!onClick) {
    return (
      <div className="kit-list-row" data-active={active || undefined} data-testid={testId}>
        <div className="kit-list-item" data-static>
          {body}
        </div>
        {trailingSlot}
      </div>
    );
  }

  return (
    <div className="kit-list-row" data-active={active || undefined} data-testid={testId}>
      <button
        type="button"
        className="kit-list-item"
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
      >
        {body}
      </button>
      {trailingSlot}
    </div>
  );
}

export function StatChip({
  label,
  value,
  testId
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}) {
  return (
    <span className="kit-stat" data-testid={testId}>
      <span className="kit-stat-value">{value}</span>
      <span className="kit-stat-label">{label}</span>
    </span>
  );
}
