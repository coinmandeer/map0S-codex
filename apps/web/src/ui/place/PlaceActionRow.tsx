import type { ReactNode } from "react";
import { IconButton, Menu, type MenuAction } from "../kit";
import type { IconName } from "../kit/icons";
import { t } from "../../i18n";

/** One of the five detail actions: a round icon button with its label underneath (§4.10). The
 *  label is `aria-hidden` because the button already carries the same text as its accessible
 *  name — a screen reader should hear it once, not twice. */
export function PlaceAction({
  icon,
  label,
  primary = false,
  disabled = false,
  testId,
  onClick
}: {
  icon: IconName;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <span className="place-action" data-primary={primary || undefined}>
      <IconButton
        icon={icon}
        label={label}
        variant={primary ? "tonal" : "plain"}
        round
        disabled={disabled}
        testId={testId}
        onClick={onClick}
      />
      <span className="place-action-label" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

/** The fifth slot: everything that is not one of the four everyday actions. */
export function PlaceActionOverflow({ actions }: { actions: readonly MenuAction[] }) {
  return (
    <span className="place-action">
      <Menu
        actions={actions}
        trigger={
          <IconButton
            icon="more_horiz"
            label={t("polish.actionsMore")}
            round
            testId="place-action-more"
          />
        }
      />
      <span className="place-action-label" aria-hidden="true">
        {t("polish.actionsMore")}
      </span>
    </span>
  );
}

export function PlaceActionRow({ children }: { children: ReactNode }) {
  return (
    <div className="place-actions" role="group" aria-label={t("place.actions")}>
      {children}
    </div>
  );
}
