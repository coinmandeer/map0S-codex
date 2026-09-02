import { useEffect, useId, useMemo, useState } from "react";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { taskRegistry } from "../tasks/TaskRegistry";
import { taskCenterModel, taskProgressLabel, taskTypeLabel } from "../tasks/taskCenterModel";
import { useTaskRegistrySnapshot } from "../tasks/useTaskRegistrySnapshot";
import { Icon } from "./primitives";

export function TaskCenter() {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const rightUtilityOpen = useShellStoreSnapshot((state) => state.rightUtility.type !== "closed");
  const footerActive = useShellStoreSnapshot((state) => state.footerContributions.length > 0);
  const tasks = useTaskRegistrySnapshot((snapshot) => snapshot);
  const model = useMemo(() => taskCenterModel(tasks), [tasks]);

  useEffect(() => {
    if (!model.entries.length) setExpanded(false);
  }, [model.entries.length]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  if (!model.entries.length) return null;

  return (
    <aside
      className="task-center"
      data-testid="task-center"
      data-expanded={expanded}
      data-failure={model.hasFailure}
      data-right-open={rightUtilityOpen}
      data-footer-active={footerActive}
      aria-label="Průběh úloh"
    >
      {expanded && (
        <section className="task-center-panel" id={panelId} data-testid="task-center-panel">
          <header>
            <div>
              <p className="task-center-eyebrow">Průběh na jednom místě</p>
              <h2>Právě zpracovávám</h2>
            </div>
            <button
              type="button"
              className="task-center-icon-button"
              aria-label="Sbalit průběh úloh"
              onClick={() => setExpanded(false)}
            >
              <Icon name="close" size={17} />
            </button>
          </header>
          <div className="task-center-list" role="list">
            {model.entries.map((task) => {
              const failed = task.status === "failed";
              const active = task.status === "queued" || task.status === "running";
              const canRetry = failed && taskRegistry.canRetry(task.id);
              return (
                <article
                  className="task-center-entry"
                  data-status={task.status}
                  data-task-type={task.type}
                  data-testid="task-center-entry"
                  key={task.id}
                  role="listitem"
                >
                  <span className="task-center-entry-icon" aria-hidden="true">
                    {failed ? (
                      <Icon name="alert" size={17} />
                    ) : task.type === "routing" ? (
                      <Icon name="route" size={17} />
                    ) : task.type === "weather" ? (
                      <Icon name="cloud" size={17} />
                    ) : task.type === "ai" ? (
                      <Icon name="sparkles" size={17} />
                    ) : (
                      <Icon name="layers" size={17} />
                    )}
                  </span>
                  <div className="task-center-entry-copy">
                    <div className="task-center-entry-title">
                      <strong>{task.label}</strong>
                      <span>{taskProgressLabel(task)}</span>
                    </div>
                    <small>{taskTypeLabel(task.type)}</small>
                    {(task.message || task.error?.message) && (
                      <p>{task.error?.message ?? task.message}</p>
                    )}
                    {!failed && (
                      <span
                        className="task-center-progress"
                        aria-label={
                          task.progress == null
                            ? "Průběh není číselně dostupný"
                            : `Dokončeno ${Math.round(task.progress * 100)} procent`
                        }
                      >
                        <span
                          style={{
                            width: `${task.progress == null ? 34 : Math.round(task.progress * 100)}%`
                          }}
                        />
                      </span>
                    )}
                    <div className="task-center-entry-actions">
                      {active && task.cancellable && (
                        <button type="button" onClick={() => taskRegistry.cancel(task.id)}>
                          Zrušit
                        </button>
                      )}
                      {canRetry && (
                        <button
                          type="button"
                          onClick={() => {
                            if (taskRegistry.retry(task.id)) taskRegistry.dismiss(task.id);
                          }}
                        >
                          Zkusit znovu
                        </button>
                      )}
                      {failed && (
                        <button type="button" onClick={() => taskRegistry.dismiss(task.id)}>
                          Skrýt
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <button
        type="button"
        className="task-center-summary"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="task-center-summary-icon" aria-hidden="true">
          {model.active.length ? (
            <span className="task-center-spinner" />
          ) : (
            <Icon name="alert" size={17} />
          )}
        </span>
        <span className="task-center-summary-copy">
          <strong>{model.compactLabel}</strong>
          <small>
            {model.active.length
              ? `${model.active.length} aktivní · klepnutím zobrazíš podrobnosti`
              : "Klepnutím zobrazíš chybu a opakování"}
          </small>
        </span>
        <Icon name={expanded ? "chevronDown" : "chevronLeft"} size={17} />
      </button>
    </aside>
  );
}
