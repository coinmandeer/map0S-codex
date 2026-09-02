import { type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";

export function ProgressCircular({
  size = 20,
  label = "Načítám"
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span
      className="kit-progress-circular"
      style={{ "--progress-size": `${size}px` } as React.CSSProperties}
      role="progressbar"
      aria-label={label}
    />
  );
}

export function ProgressLinear({
  value,
  label
}: {
  /** Omit for an indeterminate bar. */
  value?: number;
  label: string;
}) {
  const determinate = value != null;
  return (
    <span
      className="kit-progress-linear"
      data-indeterminate={determinate ? undefined : true}
      role="progressbar"
      aria-label={label}
      aria-valuenow={determinate ? Math.round(value * 100) : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
    >
      <span
        className="kit-progress-linear-fill"
        style={determinate ? { transform: `scaleX(${Math.min(1, Math.max(0, value))})` } : undefined}
      />
    </span>
  );
}

export function Skeleton({
  height = 44,
  count = 1,
  radius
}: {
  height?: number;
  count?: number;
  radius?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="kit-skeleton"
          style={{ height, borderRadius: radius }}
          aria-hidden
        />
      ))}
    </>
  );
}

/** One sentence and at most one action (§2.6). No illustrations, no apologies. */
export function EmptyState({
  icon = "info",
  title,
  actionLabel,
  onAction,
  testId
}: {
  icon?: IconName;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <div className="kit-empty" data-testid={testId}>
      <Icon name={icon} size={24} className="kit-empty-icon" />
      <p className="kit-empty-title">{title}</p>
      {actionLabel && onAction && (
        <Button variant="tonal" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  children,
  action
}: {
  tone?: "info" | "warning" | "danger" | "success";
  children: ReactNode;
  action?: ReactNode;
}) {
  const icon: IconName =
    tone === "warning"
      ? "warning"
      : tone === "danger"
        ? "error"
        : tone === "success"
          ? "check_circle"
          : "info";

  return (
    <div className="kit-notice" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon} size={20} />
      <span className="kit-notice-text">{children}</span>
      {action}
    </div>
  );
}
