import { getMapStore } from "../../store/mapStore";
import { LayerActivityBadge, useLayerActivity } from "../layers/LayerActivityBadge";
import { activityLabel, layerActivity, mapActivitySummary } from "../../tasks/layerActivity";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BrandLogo } from "../BrandLogo";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useTaskRegistrySnapshot } from "../../tasks/useTaskRegistrySnapshot";
import { taskRegistry } from "../../tasks/TaskRegistry";
import { getLayerPlugin } from "../../layers";
import { SearchHereButton } from "../SearchHereButton";
import { emit } from "../../lib/events";
import { experienceRegistry, experienceById } from "../../product/registry";
import { Icon } from "../kit";
import { st } from "../../statistics/labels";
import "./mapStatus.css";

export function MapStatus({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const view = useMapStoreSnapshot((s) => s.view);
  const tasks = useTaskRegistrySnapshot((s) => s);
  const activityRevision = useSyncExternalStore(
    layerActivity.subscribe,
    layerActivity.revision,
    layerActivity.revision
  );
  const ids = Object.keys(active).filter((id) => active[id]?.visible);
  const summary = mapActivitySummary(ids.map((id) => layerActivity.get(id)));
  const busy = ids.some((id) =>
    ["queued", "loading", "rendering"].includes(layerActivity.get(id)?.phase ?? "off")
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Only real failures raise the alert. "Partial" is the normal state of a progressive source
  // that is still filling in (or a capped answer) and is already explained on the layer's row;
  // counting it made every busy map open with "4 layers failed to load".
  // A failure stays reported while the layer tries again (a pan or a Retry re-queries it) and
  // clears once it answers, drops out of range or is turned off. Tracking only the live phase made
  // the alert blink out and back on with every retry — on a phone, right after it first appeared.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setFailed((previous) => {
      const next = new Set(
        [...previous].filter(
          (id) =>
            active[id]?.visible &&
            ["error", "queued", "loading", "rendering"].includes(
              layerActivity.get(id)?.phase ?? "off"
            )
        )
      );
      for (const id of ids) if (layerActivity.get(id)?.phase === "error") next.add(id);
      return next.size === previous.size && [...next].every((id) => previous.has(id))
        ? previous
        : next;
    });
    // `ids` is derived from `active`; the activity revision covers phase changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activityRevision]);
  const failures = ids.filter((id) => failed.has(id) || layerActivity.get(id)?.phase === "error");

  const noticesToShow = failures.filter((id) => !dismissed.has(id));
  const noticeLabel = noticeNames(noticesToShow);

  useEffect(() => {
    setDismissed((previous) => {
      const next = new Set(
        [...previous].filter(
          (id) =>
            active[id]?.visible && !["ready", "empty"].includes(layerActivity.get(id)?.phase ?? "")
        )
      );
      return next.size === previous.size ? previous : next;
    });
  }, [active, activityRevision]);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const experience = experienceById(experienceId);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div className="map-status" ref={host}>
      <button
        className="chrome-brand map-status-trigger"
        aria-label="Map status"
        aria-expanded={open}
        aria-busy={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <BrandLogo size={24} world={experienceId} accent={experience.accent} />
        {!compact && <span>MapOS</span>}
      </button>
      {!open && noticesToShow.length > 0 && (
        <section className="map-status-popover" role="alert" aria-label="Problém s načítáním">
          <strong>
            {noticesToShow.length === 1
              ? st(
                  `${noticeLabel}: data se nepodařilo načíst`,
                  `${noticeLabel}: the data could not be loaded`
                )
              : st(`Nepodařilo se načíst: ${noticeLabel}`, `Could not load: ${noticeLabel}`)}
          </strong>
          {noticesToShow.length === 1 && layerActivity.get(noticesToShow[0]!)?.message ? (
            <small>{layerActivity.get(noticesToShow[0]!)!.message}</small>
          ) : null}
          <div className="ai-turn-card-actions">
            <button
              className="kit-button"
              onClick={() => {
                for (const id of noticesToShow) emit("refresh-layer", { id });
              }}
            >
              {st("Opakovat", "Retry")}
            </button>
            <button
              className="kit-button"
              onClick={() => {
                for (const id of noticesToShow) getMapStore().toggleLayer(id);
              }}
            >
              {st("Vypnout", "Turn off")}
            </button>
            <button
              className="kit-button"
              aria-label={st("Zavřít oznámení", "Dismiss")}
              onClick={() => setDismissed(new Set([...dismissed, ...noticesToShow]))}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </section>
      )}
      {open && (
        <section className="map-status-popover" aria-label="Map status">
          <strong>Map status</strong>
          <div className="map-status-worlds" aria-label="Svět mapy">
            {experienceRegistry.list().map((world) => (
              <button
                key={world.id}
                type="button"
                className="map-status-world"
                data-active={world.id === experienceId || undefined}
                onClick={() => getMapStore().setExperience(world.id)}
              >
                <BrandLogo size={20} world={world.id} accent={world.accent} />
                <span>{world.name}</span>
                {world.id === experienceId ? <Icon name="check" size={16} /> : null}
              </button>
            ))}
          </div>
          {experienceId === "global" ? <p>{experience.description}</p> : null}
          <p>{summary}</p>
          {Object.entries(active)
            .filter(([, s]) => s.visible)
            .map(([id]) => (
              <ActivityRow key={id} id={id} zoom={view.zoom} />
            ))}
          {tasks
            .filter((t) => t.status === "failed")
            .slice(-5)
            .map((task) => (
              <div key={task.id}>
                {task.label} · {task.error?.message}
                <button onClick={() => taskRegistry.retry(task.id)}>Zkusit znovu</button>
              </div>
            ))}
          <SearchHereButton />
        </section>
      )}
    </div>
  );
}

/** Layer names for the alert: up to three, then "+ N more". */
function noticeNames(ids: string[]): string {
  const names = ids.map((id) => getLayerPlugin(id)?.manifest.name ?? id);
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} ${st(`a ${names.length - 3} další`, `and ${names.length - 3} more`)}`
    : names.join(", ");
}

function ActivityRow({ id, zoom }: { id: string; zoom: number }) {
  const state = useLayerActivity(id);
  const plugin = getLayerPlugin(id);
  const unit =
    state?.transferredBytes == null
      ? "přenos nezměřen"
      : `${(state.transferredBytes / 1024).toFixed(1)} kB`;
  return (
    <div className="map-status-row">
      <strong>
        <LayerActivityBadge id={id} /> {plugin?.manifest.name ?? id}
      </strong>
      <span>{activityLabel(state)}</span>
      <small>
        {state?.durationMs != null ? `${(state.durationMs / 1000).toFixed(2)} s · ` : ""}
        {state?.cache ? "mezipaměť" : unit}
      </small>
      {state && ["partial", "error", "pending", "zoom"].includes(state.phase) && (
        <button
          onClick={() => {
            if (zoom < (plugin?.minQueryZoom ?? 0))
              emit("fly-to", { ...getMapStore().view, zoom: plugin?.minQueryZoom ?? 8 });
            else emit("refresh-layer", { id });
          }}
        >
          {state.phase === "zoom" ? "Přiblížit mapu" : "Opakovat"}
        </button>
      )}
    </div>
  );
}
