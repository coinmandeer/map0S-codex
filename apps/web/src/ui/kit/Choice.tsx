import { type ReactNode, useId } from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Icon } from "./Icon";

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  testId
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Required. A bare switch with the label somewhere else in the DOM is unreadable to
   *  screen readers, so the label is either rendered or applied as `aria-label`. */
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <BaseSwitch.Root
      className="kit-switch"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
    >
      <BaseSwitch.Thumb className="kit-switch-thumb" />
    </BaseSwitch.Root>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  testId
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();

  return (
    <span className="kit-choice">
      <BaseCheckbox.Root
        id={id}
        className="kit-checkbox"
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        data-testid={testId}
      >
        <BaseCheckbox.Indicator className="kit-checkbox-indicator">
          <Icon name="check" size={16} weight={600} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <label className="kit-choice-label" htmlFor={id}>
        {label}
      </label>
    </span>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Second line under the label. One short sentence; longer text belongs in an InfoTip. */
  description?: string;
  disabled?: boolean;
}

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId
}: {
  options: readonly RadioOption<T>[];
  value: T | null;
  onChange: (next: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <BaseRadioGroup
      className="kit-radio-group"
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="kit-radio-row"
          data-selected={option.value === value || undefined}
        >
          <BaseRadio.Root
            value={option.value}
            className="kit-radio"
            disabled={option.disabled}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
          >
            <BaseRadio.Indicator className="kit-radio-indicator" />
          </BaseRadio.Root>
          <span className="kit-radio-text">
            <span className="kit-radio-label">{option.label}</span>
            {option.description && (
              <span className="kit-radio-description">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format,
  testId
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  /** Renders the current value next to the label; omit to hide the readout. */
  format?: (value: number) => string;
  testId?: string;
}) {
  return (
    <div className="kit-slider-field">
      <div className="kit-slider-header">
        <span className="kit-slider-label">{label}</span>
        {format && <span className="kit-slider-value">{format(value)}</span>}
      </div>
      <BaseSlider.Root
        className="kit-slider"
        value={value}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        data-testid={testId}
      >
        <BaseSlider.Control className="kit-slider-control">
          <BaseSlider.Track className="kit-slider-track">
            <BaseSlider.Indicator className="kit-slider-indicator" />
            <BaseSlider.Thumb className="kit-slider-thumb" />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
    </div>
  );
}

export function RangeSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  format,
  testId
}: {
  value: readonly [number, number];
  onChange: (next: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  format?: (value: readonly [number, number]) => string;
  testId?: string;
}) {
  return (
    <div className="kit-slider-field">
      <div className="kit-slider-header">
        <span className="kit-slider-label">{label}</span>
        {format && <span className="kit-slider-value">{format(value)}</span>}
      </div>
      <BaseSlider.Root
        className="kit-slider"
        value={[value[0], value[1]]}
        onValueChange={(next) => {
          const pair = Array.isArray(next) ? next : [next, next];
          onChange([pair[0], pair[1]]);
        }}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        data-testid={testId}
      >
        <BaseSlider.Control className="kit-slider-control">
          <BaseSlider.Track className="kit-slider-track">
            <BaseSlider.Indicator className="kit-slider-indicator" />
            <BaseSlider.Thumb className="kit-slider-thumb" index={0} />
            <BaseSlider.Thumb className="kit-slider-thumb" index={1} />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
    </div>
  );
}
