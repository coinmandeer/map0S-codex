import { useId, type ReactNode } from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Icon, type IconName } from "./Icon";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  description?: string;
  disabled?: boolean;
}

export interface SelectGroup<T extends string> {
  label: string;
  options: readonly SelectOption<T>[];
}

export function Select<T extends string>({
  options,
  groups,
  value,
  onChange,
  label,
  placeholder = "Vyberte…",
  hideLabel = false,
  disabled = false,
  testId
}: {
  options?: readonly SelectOption<T>[];
  groups?: readonly SelectGroup<T>[];
  value: T | null;
  onChange: (next: T) => void;
  label: string;
  placeholder?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const flat = groups ? groups.flatMap((group) => group.options) : (options ?? []);
  const renderItem = (option: SelectOption<T>) => (
    <BaseSelect.Item
      key={option.value}
      value={option.value}
      className="kit-option"
      disabled={option.disabled}
      data-testid={testId ? `${testId}-${option.value}` : undefined}
    >
      {option.icon && <Icon name={option.icon} size={20} />}
      <span className="kit-option-text">
        <BaseSelect.ItemText className="kit-option-label">{option.label}</BaseSelect.ItemText>
        {option.description && (
          <span className="kit-option-description">{option.description}</span>
        )}
      </span>
      <BaseSelect.ItemIndicator className="kit-option-indicator">
        <Icon name="check" size={18} weight={600} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );

  return (
    <BaseSelect.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <div className="kit-field">
        <BaseSelect.Label className="kit-field-label" data-visually-hidden={hideLabel || undefined}>
          {label}
        </BaseSelect.Label>
        <BaseSelect.Trigger className="kit-select-trigger" data-testid={testId}>
          <BaseSelect.Value className="kit-select-value">
            {(selected: string | null) =>
              flat.find((option) => option.value === selected)?.label ?? placeholder
            }
          </BaseSelect.Value>
          <BaseSelect.Icon className="kit-select-icon">
            <Icon name="expand_more" size={20} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal>
        <BaseSelect.Positioner side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="kit-listbox">
            <BaseSelect.List>
              {groups
                ? groups.map((group) => (
                    <BaseSelect.Group key={group.label} className="kit-option-group">
                      <BaseSelect.GroupLabel className="kit-option-group-label">
                        {group.label}
                      </BaseSelect.GroupLabel>
                      {group.options.map(renderItem)}
                    </BaseSelect.Group>
                  ))
                : (options ?? []).map(renderItem)}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export interface ComboboxItem {
  id: string;
  /** The text the input shows once picked, and what typeahead matches against. */
  label: string;
  /** Second line — for places this is the disambiguating hierarchy, "Vinaròs, Castellón,
   *  Španělsko", which is what makes a suggestion list usable (§25). */
  detail?: string;
  icon?: IconName;
  /** Groups the item under a labelled heading in the list. */
  group?: string;
  trailing?: ReactNode;
}

/** Free-text input with a suggestion list.
 *
 *  Filtering is the caller's job — suggestions come from a debounced server call, not from a
 *  local array, so the component never filters what it is given. */
export function Combobox({
  items,
  inputValue,
  onInputChange,
  onSelect,
  label,
  placeholder,
  hideLabel = false,
  icon,
  loading = false,
  emptyMessage = "Nic jsme nenašli",
  groupOrder,
  trailing,
  testId
}: {
  items: readonly ComboboxItem[];
  inputValue: string;
  onInputChange: (next: string) => void;
  onSelect: (item: ComboboxItem) => void;
  label: string;
  placeholder?: string;
  hideLabel?: boolean;
  icon?: IconName;
  loading?: boolean;
  emptyMessage?: string;
  /** Renders groups in this order; anything ungrouped comes first. */
  groupOrder?: readonly string[];
  trailing?: ReactNode;
  testId?: string;
}) {
  const inputId = useId();
  const ungrouped = items.filter((item) => !item.group);
  const groupNames = groupOrder
    ? groupOrder.filter((name) => items.some((item) => item.group === name))
    : [...new Set(items.map((item) => item.group).filter((name): name is string => !!name))];

  const renderItem = (item: ComboboxItem) => (
    <BaseCombobox.Item
      key={item.id}
      value={item}
      className="kit-option"
      data-testid={testId ? `${testId}-item-${item.id}` : undefined}
    >
      {item.icon && <Icon name={item.icon} size={20} />}
      <span className="kit-option-text">
        <span className="kit-option-label">{item.label}</span>
        {item.detail && <span className="kit-option-description">{item.detail}</span>}
      </span>
      {item.trailing}
    </BaseCombobox.Item>
  );

  return (
    <BaseCombobox.Root
      items={items as ComboboxItem[]}
      value={null}
      inputValue={inputValue}
      onInputValueChange={onInputChange}
      onValueChange={(next) => {
        if (next) onSelect(next as ComboboxItem);
      }}
      itemToStringLabel={(item: ComboboxItem) => item.label}
      filter={null}
    >
      <div className="kit-field">
        {/* A native label, not `Combobox.Label`: Base UI wires that one to the trigger, and
            here the input is the form control. */}
        <label
          className="kit-field-label"
          htmlFor={inputId}
          data-visually-hidden={hideLabel || undefined}
        >
          {label}
        </label>
        <div className="kit-input-shell" data-size="md">
          {icon && <Icon name={icon} size={20} className="kit-input-icon" />}
          <BaseCombobox.Input
            id={inputId}
            className="kit-input"
            placeholder={placeholder}
            data-testid={testId}
          />
          {loading && <span className="kit-progress-circular" aria-label="Hledám" />}
          {trailing}
        </div>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner side="bottom" align="start" sideOffset={6}>
          <BaseCombobox.Popup className="kit-listbox">
            <BaseCombobox.Empty className="kit-listbox-empty">{emptyMessage}</BaseCombobox.Empty>
            <BaseCombobox.List>
              {ungrouped.map(renderItem)}
              {groupNames.map((name) => (
                <BaseCombobox.Group key={name} className="kit-option-group">
                  <BaseCombobox.GroupLabel className="kit-option-group-label">
                    {name}
                  </BaseCombobox.GroupLabel>
                  {items.filter((item) => item.group === name).map(renderItem)}
                </BaseCombobox.Group>
              ))}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
