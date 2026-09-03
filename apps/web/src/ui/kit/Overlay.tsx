import { type ReactElement, type ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Icon, type IconName } from "./Icon";
import { Button, IconButton } from "./Button";

/** Wraps the whole app once so tooltips share a single delay group: moving between two
 *  adjacent icon buttons shows the second one immediately instead of waiting again. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={400} closeDelay={100}>
      {children}
    </BaseTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "bottom"
}: {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="kit-positioner" side={side} sideOffset={8}>
          <BaseTooltip.Popup className="kit-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export function Popover({
  trigger,
  children,
  title,
  side = "bottom",
  align = "center",
  open,
  onOpenChange,
  width,
  testId
}: {
  trigger: ReactElement;
  children: ReactNode;
  title?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: number;
  testId?: string;
}) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className="kit-positioner" side={side} align={align} sideOffset={8}>
          <BasePopover.Popup
            className="kit-popover"
            style={width ? { width } : undefined}
            data-testid={testId}
          >
            {title && (
              <header className="kit-popover-header">
                <h3>{title}</h3>
                <BasePopover.Close
                  render={<IconButton icon="close" label="Zavřít" size="sm" round />}
                />
              </header>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** The one sanctioned home for explanatory text (§21.1).
 *
 *  Every "which data is shared", "source may be out of date" and licensing note goes behind
 *  one of these instead of taking a grey paragraph of vertical space in a panel. */
export function InfoTip({
  title,
  children,
  label = "Více informací",
  size = "sm",
  testId
}: {
  title?: string;
  children: ReactNode;
  label?: string;
  size?: "sm" | "md";
  testId?: string;
}) {
  return (
    <Popover
      title={title}
      side="bottom"
      align="end"
      width={288}
      testId={testId}
      trigger={<IconButton icon="info" label={label} size={size} variant="plain" round />}
    >
      <div className="kit-infotip-body">{children}</div>
    </Popover>
  );
}

export interface MenuAction {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders in the danger colour and, on touch, after a separator. */
  destructive?: boolean;
}

export function Menu({
  trigger,
  actions,
  align = "end",
  testId
}: {
  trigger: ReactElement;
  actions: readonly MenuAction[];
  align?: "start" | "center" | "end";
  testId?: string;
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="kit-positioner" side="bottom" align={align} sideOffset={6}>
          <BaseMenu.Popup className="kit-menu" data-testid={testId}>
            {actions.map((action) => (
              <BaseMenu.Item
                key={action.id}
                className="kit-menu-item"
                disabled={action.disabled}
                data-destructive={action.destructive || undefined}
                onClick={action.onSelect}
                data-testid={testId ? `${testId}-${action.id}` : undefined}
              >
                {action.icon && <Icon name={action.icon} size={20} />}
                {action.label}
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  testId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** `lg` is the place-detail dialog (§27.4); `sm` is a confirm. */
  size?: "sm" | "md" | "lg";
  testId?: string;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="kit-scrim" />
        <BaseDialog.Popup className="kit-dialog" data-size={size} data-testid={testId}>
          <header className="kit-dialog-header">
            <div>
              <BaseDialog.Title className="kit-dialog-title">{title}</BaseDialog.Title>
              {description && (
                <BaseDialog.Description className="kit-dialog-description">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close render={<IconButton icon="close" label="Zavřít" round />} />
          </header>
          {children && <div className="kit-dialog-body">{children}</div>}
          {footer && <footer className="kit-dialog-footer">{footer}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="text" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button
            variant={destructive ? "danger" : "filled"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
