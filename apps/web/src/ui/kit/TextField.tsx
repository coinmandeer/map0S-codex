import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes
} from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./Button";

interface FieldFrameProps {
  label?: string;
  /** One short line under the field. Anything longer belongs behind an InfoTip. */
  hint?: string;
  error?: string;
  /** Hides the visual label but keeps it for screen readers — for fields whose purpose is
   *  obvious from context, like the search box in the top bar. */
  hideLabel?: boolean;
  children: ReactNode;
  id: string;
}

function FieldFrame({ label, hint, error, hideLabel, children, id }: FieldFrameProps) {
  return (
    <div className="kit-field" data-invalid={error ? true : undefined}>
      {label && (
        <label className="kit-field-label" htmlFor={id} data-visually-hidden={hideLabel || undefined}>
          {label}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p className="kit-field-hint" data-error={error ? true : undefined} id={`${id}-hint`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  label?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  icon?: IconName;
  /** Rendered at the trailing edge, inside the field. Use for a unit, a state chip or an
   *  IconButton such as "my location". */
  trailing?: ReactNode;
  /** Shows a clear button whenever the field has a value. */
  onClear?: () => void;
  size?: "sm" | "md" | "lg";
  testId?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, hideLabel, icon, trailing, onClear, size = "md", testId, ...rest },
  ref
) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  const hasValue = rest.value != null && String(rest.value).length > 0;

  return (
    <FieldFrame label={label} hint={hint} error={error} hideLabel={hideLabel} id={id}>
      <div className="kit-input-shell" data-size={size}>
        {icon && <Icon name={icon} size={20} className="kit-input-icon" />}
        <input
          {...rest}
          id={id}
          ref={ref}
          className="kit-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-hint` : rest["aria-describedby"]}
          data-testid={testId}
        />
        {onClear && hasValue && (
          <IconButton icon="close" label="Vymazat" size="sm" onClick={onClear} round />
        )}
        {trailing}
      </div>
    </FieldFrame>
  );
});

/** A text field pre-wired for search: `type=search`, the magnifier, a clear button and
 *  `role=searchbox` semantics. Kept separate so every search box in the app is identical. */
export const SearchField = forwardRef<HTMLInputElement, TextFieldProps>(function SearchField(
  props,
  ref
) {
  return <TextField {...props} ref={ref} type="search" icon={props.icon ?? "search"} />;
});

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  label?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  testId?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, hideLabel, testId, ...rest },
  ref
) {
  const generatedId = useId();
  const id = rest.id ?? generatedId;

  return (
    <FieldFrame label={label} hint={hint} error={error} hideLabel={hideLabel} id={id}>
      <textarea
        {...rest}
        id={id}
        ref={ref}
        className="kit-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-hint` : rest["aria-describedby"]}
        data-testid={testId}
      />
    </FieldFrame>
  );
});

export function NumberField({
  label,
  hint,
  error,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  testId
}: {
  label?: string;
  hint?: string;
  error?: string;
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown inside the field at the trailing edge (km, °C, min). */
  unit?: string;
  testId?: string;
}) {
  const id = useId();

  return (
    <BaseNumberField.Root
      id={id}
      className="kit-field"
      value={value}
      onValueChange={(next) => onChange(next)}
      min={min}
      max={max}
      step={step}
    >
      {label && <BaseNumberField.ScrubArea className="kit-field-label">{label}</BaseNumberField.ScrubArea>}
      <BaseNumberField.Group className="kit-input-shell" data-size="md">
        <BaseNumberField.Decrement className="kit-stepper" aria-label="Snížit">
          <Icon name="remove" size={18} />
        </BaseNumberField.Decrement>
        <BaseNumberField.Input className="kit-input kit-input-numeric" data-testid={testId} />
        {unit && <span className="kit-input-unit">{unit}</span>}
        <BaseNumberField.Increment className="kit-stepper" aria-label="Zvýšit">
          <Icon name="add" size={18} />
        </BaseNumberField.Increment>
      </BaseNumberField.Group>
      {(error || hint) && (
        <p className="kit-field-hint" data-error={error ? true : undefined}>
          {error || hint}
        </p>
      )}
    </BaseNumberField.Root>
  );
}
