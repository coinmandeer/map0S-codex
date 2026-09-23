import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Icon, type IconName } from "./Icon";

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

/** Kit components own their base class; callers may add one for positioning only, never for
 *  restyling the control itself. */
function classes(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

export interface ButtonProps extends NativeButton {
  /** `filled` is the one primary action on a surface, `tonal` a secondary one, `text` a
   *  tertiary one. More than one filled button per panel and neither reads as primary. */
  variant?: "filled" | "tonal" | "outlined" | "text" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  trailingIcon?: IconName;
  /** Stretches to the container; used for the single CTA at the bottom of a panel. */
  block?: boolean;
  loading?: boolean;
  children?: ReactNode;
  testId?: string;
  /** Positioning only — see `classes`. */
  className?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "text",
    size = "md",
    icon,
    trailingIcon,
    block = false,
    loading = false,
    disabled,
    children,
    testId,
    className,
    ...rest
  },
  ref
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      className={classes("kit-button", className)}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      data-testid={testId}
    >
      {loading ? (
        <span className="kit-button-spinner" aria-hidden />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 16 : 20} />
      )}
      {children != null && <span className="kit-button-label">{children}</span>}
      {trailingIcon && <Icon name={trailingIcon} size={size === "sm" ? 16 : 20} />}
    </button>
  );
});

export interface IconButtonProps extends NativeButton {
  icon: IconName;
  /** Always required: an icon-only control has no accessible name otherwise. Also the tooltip. */
  label: string;
  variant?: "plain" | "filled" | "tonal" | "outlined";
  size?: "sm" | "md" | "lg";
  /** Renders the pressed/selected state, and switches the glyph to its filled variant. */
  active?: boolean;
  round?: boolean;
  testId?: string;
  /** Positioning only — see `classes`. */
  className?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = "plain",
    size = "md",
    active = false,
    round = false,
    testId,
    className,
    ...rest
  },
  ref
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      className={classes("kit-icon-button", className)}
      data-variant={variant}
      data-size={size}
      data-round={round || undefined}
      aria-label={label}
      title={label}
      aria-pressed={rest["aria-pressed"] ?? (active || undefined)}
      data-active={active || undefined}
      data-testid={testId}
    >
      <Icon name={icon} size={size === "sm" ? 18 : size === "lg" ? 24 : 20} filled={active} />
    </button>
  );
});

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

/** M3 segmented button: mutually exclusive choices that all fit on one line.
 *
 *  The active indicator is a single absolutely positioned element moved with `transform`,
 *  so switching slides rather than blinks. Use it for 2–5 options; beyond that use a Select. */
export function SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  block = false,
  iconsOnly = false,
  stacked = false,
  ariaLabel,
  testId
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  size?: "sm" | "md";
  block?: boolean;
  /** Puts the icon above the label. Four choices in a narrow panel fit as columns, not rows. */
  stacked?: boolean;
  /** Collapses to icons plus tooltips. The caller decides, because the width at which the
   *  labels stop fitting depends on how much else shares the row. */
  iconsOnly?: boolean;
  ariaLabel: string;
  testId?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  return (
    <ToggleGroup
      className="kit-segmented"
      data-size={size}
      data-block={block || undefined}
      data-icons-only={iconsOnly || undefined}
      data-stacked={stacked || undefined}
      aria-label={ariaLabel}
      data-testid={testId}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        // Toggle groups allow deselecting; a segmented control must always have a choice.
        if (picked && picked !== value) onChange(picked);
      }}
      style={{ "--segment-count": options.length, "--segment-index": index } as React.CSSProperties}
    >
      <span className="kit-segmented-indicator" aria-hidden />
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className="kit-segment"
          disabled={option.disabled}
          title={option.label}
          aria-label={iconsOnly ? option.label : undefined}
          data-testid={testId ? `${testId}-${option.value}` : undefined}
        >
          {option.icon && (
            <Icon
              name={option.icon}
              size={size === "sm" ? 18 : 20}
              filled={option.value === value}
            />
          )}
          <span className="kit-segment-label">{option.label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
