import { useState, type ReactNode } from "react";
import { t } from "../../i18n";
import { Dialog, IconButton, Popover } from "../kit";
import { useIsMobile } from "../useIsMobile";

/** One settings surface and one entry point, with touch-sized presentation on mobile. */
export function LayerSettingsPopover({
  layerId,
  name,
  children,
  active = false
}: {
  layerId: string;
  name: string;
  children: ReactNode;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const trigger = (
    <IconButton
      icon="tune"
      size="sm"
      active={active}
      label={t("polish.settings", { name })}
      testId={`layer-filter-btn-${layerId}`}
    />
  );
  const content = (
    <div className="layer-settings-body" data-testid={`layer-settings-${layerId}`}>
      {open ? children : null}
    </div>
  );
  if (mobile)
    return (
      <>
        <IconButton
          icon="tune"
          size="sm"
          active={active}
          label={t("polish.settings", { name })}
          testId={`layer-filter-btn-${layerId}`}
          onClick={() => setOpen(true)}
        />
        <Dialog open={open} onOpenChange={setOpen} title={name} testId={`layer-filter-${layerId}`}>
          {content}
        </Dialog>
      </>
    );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title={name}
      side="left"
      align="start"
      width={320}
      testId={`layer-filter-${layerId}`}
    >
      {content}
    </Popover>
  );
}
