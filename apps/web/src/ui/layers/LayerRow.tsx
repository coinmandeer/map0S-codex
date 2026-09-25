import type { ReactNode } from "react";
import { Icon, Switch, type IconName } from "../kit";
import { LayerActivityBadge } from "./LayerActivityBadge";
import { LayerSettingsPopover } from "./LayerSettingsPopover";

export function LayerRow({
  id,
  name,
  icon = "layers",
  active,
  onChange,
  disabled = false,
  summary,
  notice,
  children,
  testId,
  filtered = false
}: {
  id: string;
  name: string;
  icon?: IconName;
  active: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  summary?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  testId?: string;
  filtered?: boolean;
}) {
  return (
    <div className="layer-row-block" data-active={active || undefined}>
      <div className="layer-row" data-active={active || undefined}>
        <span className="layer-row-icon">
          <LayerActivityBadge id={id}>
            <Icon name={icon} size={20} filled={active} />
          </LayerActivityBadge>
        </span>
        <span className="layer-row-text">
          <span className="layer-row-name">{name}</span>
          {summary && <span className="layer-row-meta">{summary}</span>}
          {notice && <span className="layer-row-notice">{notice}</span>}
        </span>
        <span className="layer-row-actions">
          <LayerSettingsPopover layerId={id} name={name} active={filtered}>
            {children}
          </LayerSettingsPopover>
          <Switch
            checked={active}
            disabled={disabled}
            label={name}
            testId={testId ?? `overflow-${id}`}
            onChange={onChange}
          />
        </span>
      </div>
    </div>
  );
}
