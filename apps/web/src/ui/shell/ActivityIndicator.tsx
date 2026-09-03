import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n/cs";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { taskRegistry } from "../../tasks/TaskRegistry";
import { useTaskRegistrySnapshot } from "../../tasks/useTaskRegistrySnapshot";
import { Button, Icon, Popover } from "../kit";
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
  // Tasks whose hold window has already been granted. A finished task stays in the registry,
  // so without this the next registry change would grant it another one and its row would
  // reappear for as long as anything else on the map keeps loading.
  const heldRef = useRef(new Set<string>());

  useEffect(() => {
    const timers = timersRef.current;
    const held = heldRef.current;
    const live = new Set(tasks.map((task) => task.id));
    for (const id of held) {
      if (!live.has(id)) held.delete(id);
    }
    for (const task of tasks) {
      if (task.status !== "succeeded" && task.status !== "failed") continue;
      if (held.has(task.id)) continue;
      held.add(task.id);
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
  const actionable = tasks.filter(
    (task) =>
      task.status === "failed" ||
      ((task.status === "queued" || task.status === "running") && task.cancellable)
  );

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
      <Popover
        title="Průběh úloh"
        side="top"
        align="end"
        width={300}
        testId="activity-tasks"
        trigger={
          <button type="button" className="activity-rows" aria-label={t("status.activity")}>
            {rows.map((row) => (
              <span
                key={row.id}
                className="activity-row"
                data-tone={row.tone}
                data-testid="activity-row"
              >
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
              </span>
            ))}
          </button>
        }
      >
        {/* §29.3: the pill stays a status, and everything the old task centre could do —
            cancel, retry, dismiss — lives here instead of on the map. */}
        <div className="activity-tasks">
          {actionable.length === 0 && <p className="activity-tasks-empty">Nic nevyžaduje zásah.</p>}
          {actionable.map((task) => (
            <div className="activity-task" key={task.id} data-testid="activity-task">
              <span className="activity-task-label">{task.label}</span>
              {(task.error?.message || task.message) && (
                <span className="activity-task-detail">{task.error?.message ?? task.message}</span>
              )}
              <div className="activity-task-actions">
                {(task.status === "queued" || task.status === "running") && task.cancellable && (
                  <Button variant="text" size="sm" onClick={() => taskRegistry.cancel(task.id)}>
                    Zrušit
                  </Button>
                )}
                {task.status === "failed" && taskRegistry.canRetry(task.id) && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => {
                      if (taskRegistry.retry(task.id)) taskRegistry.dismiss(task.id);
                    }}
                  >
                    Zkusit znovu
                  </Button>
                )}
                {task.status === "failed" && (
                  <>
                    <Button variant="text" size="sm" onClick={() => taskRegistry.dismiss(task.id)}>
                      Skrýt
                    </Button>
                    {task.layerId && (
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => shell.openRightUtility("layers")}
                      >
                        Otevřít Vrstvy
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Popover>
    </aside>
  );
}
