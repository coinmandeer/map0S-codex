/** The MapOS component kit.
 *
 *  Thin wrappers over Base UI (headless, accessible) styled entirely by `styles/kit.css`
 *  from the tokens in `styles/tokens.css`. One import for the whole vocabulary so a panel
 *  never reaches for a raw `<button>` and drifts into its own look.
 *
 *  Rules that keep it coherent:
 *  - Icons come from `ICON_NAMES` only; no emoji in chrome.
 *  - One bordered surface per panel (§2.4) — `Section` is a heading plus a divider, and
 *    cards are for items.
 *  - Explanatory prose goes in an `InfoTip`, never in a grey paragraph (§21.1).
 */
export { Icon, ICON_NAMES, ICON_NAME_SET, type IconName, type IconProps } from "./Icon";
export {
  Button,
  IconButton,
  SegmentedButton,
  type ButtonProps,
  type IconButtonProps,
  type SegmentedOption
} from "./Button";
export {
  NumberField,
  SearchField,
  TextArea,
  TextField,
  type TextAreaProps,
  type TextFieldProps
} from "./TextField";
export {
  Checkbox,
  RadioGroup,
  RangeSlider,
  Slider,
  Switch,
  type RadioOption
} from "./Choice";
export {
  Select,
  Combobox,
  type ComboboxItem,
  type SelectGroup,
  type SelectOption
} from "./Select";
export { Accordion, Tabs, type AccordionSection, type TabDefinition } from "./Disclosure";
export {
  ConfirmDialog,
  Dialog,
  InfoTip,
  Menu,
  Popover,
  Tooltip,
  TooltipProvider,
  type MenuAction
} from "./Overlay";
export { Badge, Chip, Divider, ListItem, Section, StatChip } from "./Display";
export {
  EmptyState,
  InlineNotice,
  ProgressCircular,
  ProgressLinear,
  Skeleton
} from "./Feedback";
export { ToastProvider, notify, toastManager, type ToastTone } from "./Toast";
export { useMediaQuery } from "./useMediaQuery";
