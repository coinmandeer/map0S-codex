import { type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export { Icon, ICONS, type IconName } from "./Icon";
export { Sheet, SheetSection, SettingRow } from "./Sheet";
export { SourceIconStrip } from "./SourceIconStrip";

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  size = 18,
  round = false,
  small = false,
  testId
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  size?: number;
  round?: boolean;
  small?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${round ? " round" : ""}${small ? " small" : ""}${active ? " accent" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Chip({
  label,
  active = false,
  color,
  onClick,
  testId
}: {
  label: string;
  active?: boolean;
  color?: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`chip${active ? " active" : ""}`}
      style={
        active && color
          ? { background: color, borderColor: "transparent", color: "#fff" }
          : undefined
      }
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
    >
      {color && <span className="dot" style={{ background: active ? "#fff" : color }} />}
      {label}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  small = false,
  disabled = false,
  testId
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  small?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle${on ? " on" : ""}${small ? " small" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-testid={testId}
    />
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
    <span className="stat-chip" data-testid={testId}>
      <strong>{value}</strong>
      {label}
    </span>
  );
}

export function EmptyState({
  icon = "info",
  title,
  action
}: {
  icon?: IconName;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name={icon} size={20} />
      </span>
      <p>{title}</p>
      {action}
    </div>
  );
}

export function Skeleton({ height = 68, count = 1 }: { height?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </>
  );
}
