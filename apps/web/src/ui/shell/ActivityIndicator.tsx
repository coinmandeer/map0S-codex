import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n/cs";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { useTaskRegistrySnapshot } from "../../tasks/useTaskRegistrySnapshot";
import { Icon } from "../kit";
import { activityRows, activitySummary } from "./activityModel";

/** Nothing is shown for the first third of a second: most layer queries resolve inside it, and
 *  a pill that appears and vanishes again is worse than no pill. */
const APPEAR_DELAY_MS = 300;
/** How long a finished row keeps its tick before fading out. */
const SUCCESS_HOLD_MS = 200;
/** Failures stay long enough to read and click. */
const FAILURE_HOLD_MS = 5000;

/** The one loading surface in the app (§4.12), bottom right above the zoom controls.
 *
 *  It replaces both the letter strip of place sources and the expandable task centre: those
 *  told the user which of seven providers was slow, which is information for the layer drawer,
 *  not for someone watching the map.
 */
export function ActivityIndicator() {
  const shell = getShellStore();
  const rightUtilityOpen = useShellStoreSnapshot((state) => state.rightUtility.type !== "closed");
  const footerActive = useShellStoreSnapshot((state) => state.footerContributions.length > 0);
  const tasks = useTaskRegistrySnapshot((snapshot) => snapshot);

  // Ids of tasks that have finished but whose row is still on screen. Held here rather than in
  // the registry because the hold time is a presentation choice.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const [visible, setVisible] = useState(false);
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = timersRef.current;
    for (const task of tasks) {
      if (task.status !== "succeeded" && task.status !== "failed") continue;
      if (timers.has(task.id)) continue;
      const hold = task.status === "failed" ? FAILURE_HOLD_MS : SUCCESS_HOLD_MS;
      setSettled((current) => new Set(current).add(task.id));
      timers.set(
        task.id,
        window.setTimeout(() => {
          timers.delete(task.id);
          setSettled((current) => {
            const next = new Set(current);
            next.delete(task.id);
            return next;
          });
        }, hold)
      );
    }
  }, [tasks]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const rows = useMemo(() => activityRows(tasks, settled), [tasks, settled]);
  const hasRows = rows.length > 0;

  useEffect(() => {
    if (!hasRows) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasRows]);

  if (!hasRows || !visible) return null;

  const failed = rows.some((row) => row.tone === "error");
  const summary = activitySummary(rows);

  return (
    <aside
      className="activity-indicator mapos-slide-up"
      data-testid="activity-indicator"
      data-failure={failed || undefined}
      data-right-open={rightUtilityOpen || undefined}
      data-footer-active={footerActive || undefined}
      aria-label={t("status.activity")}
    >
      <span className="visually-hidden" role="status" aria-live="polite">
        {summary}
      </span>
      {rows.map((row) => {
        const content = (
          <>
            <span className="activity-row-icon" aria-hidden="true">
              {row.tone === "running" ? (
                <span className="kit-progress-circular" data-size="sm" />
              ) : (
                <Icon name={row.icon} size={16} filled={row.tone === "done"} />
              )}
            </span>
            <span className="activity-row-copy">
              <span className="activity-row-label">{row.label}</span>
              {row.detail && <span className="activity-row-detail">{row.detail}</span>}
            </span>
            {row.tone === "running" && row.progress != null && (
              <span className="activity-row-progress" aria-hidden="true">
                <span style={{ width: `${Math.round(row.progress * 100)}%` }} />
              </span>
            )}
          </>
        );

        // A failed row is the one place this surface is interactive: it opens the layer drawer,
        // where the notice for that layer explains what the upstream actually said.
        return row.tone === "error" ? (
          <button
            key={row.id}
            type="button"
            className="activity-row"
            data-tone={row.tone}
            data-testid="activity-row"
            onClick={() => shell.openRightUtility("layers")}
          >
            {content}
          </button>
        ) : (
          <div
            key={row.id}
            className="activity-row"
            data-tone={row.tone}
            data-testid="activity-row"
          >
            {content}
          </div>
        );
      })}
    </aside>
  );
}
