import { formatDistance, formatDuration } from "../../planning/planFormat";
import type { DistanceUnits } from "../../settings/preferences";
import { Button, IconButton } from "../kit";
import type { PlanShareTab } from "./PlanShareDialog";

export interface PlanTotals {
  distanceM: number;
  durationS: number;
  ready: number;
  failed: number;
  stale: number;
  total: number;
}

/** The sticky bottom bar (§4.5): one primary action plus the icon row for what you do with a
 *  finished route. Share, export and hand-off all open the same tabbed dialog (§29.3). */
export function PlanFooter({
  totals,
  units,
  busy,
  saving,
  readOnlyShared,
  onCalculate,
  onSave,
  onOpenShare
}: {
  totals: PlanTotals;
  units: DistanceUnits;
  busy: boolean;
  saving: boolean;
  readOnlyShared: boolean;
  onCalculate: () => void;
  onSave: () => void;
  onOpenShare: (tab: PlanShareTab) => void;
}) {
  return (
    <div className="planner-footer">
      {totals.ready > 0 && (
        <div className="planner-footer-summary" data-testid="planning-result">
          <span className="planner-footer-total">
            {formatDistance(totals.distanceM, units)} · {formatDuration(totals.durationS)}
          </span>
          <span className="planner-footer-segments">
            {totals.ready}/{totals.total} hotových úseků
            {totals.failed > 0 ? ` · ${totals.failed} selhalo` : ""}
            {totals.stale > 0 ? ` · ${totals.stale} čeká na přepočet` : ""}
          </span>
        </div>
      )}
      <div className="planner-footer-row">
        <Button
          block
          variant="filled"
          icon="route"
          loading={busy}
          disabled={busy}
          testId="calculate-plan"
          onClick={onCalculate}
        >
          {busy ? "Počítám úseky…" : "Vypočítat trasu"}
        </Button>
        <div className="planner-footer-actions">
          <IconButton
            icon="save"
            label={
              saving ? "Ukládám…" : readOnlyShared ? "Uložit vlastní kopii" : "Uložit do Osobní"
            }
            size="sm"
            disabled={saving}
            testId="save-plan"
            onClick={onSave}
          />
          <IconButton
            icon="share"
            label="Sdílet"
            size="sm"
            testId="open-plan-share"
            onClick={() => onOpenShare("share")}
          />
          <IconButton
            icon="download"
            label="Exportovat"
            size="sm"
            testId="open-plan-export"
            onClick={() => onOpenShare("export")}
          />
          <IconButton
            icon="open_in_new"
            label="Otevřít v jiné mapě"
            size="sm"
            testId="open-plan-handoff"
            onClick={() => onOpenShare("handoff")}
          />
        </div>
      </div>
    </div>
  );
}
