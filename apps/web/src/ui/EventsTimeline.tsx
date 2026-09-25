import { useEffect, useMemo, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { MapTimeline } from "./MapTimeline";
import { RangeSlider } from "./RangeSlider";
import { intlLocale } from "../i18n";

const DAY_MS = 86_400_000;

/** The range is in whole days from today, so the slider works in integers and the histogram
 *  buckets line up with the handles without any rounding of dates. */
function dayStart(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return new Date(date.getTime() + offset * DAY_MS);
}

function formatDay(offset: number): string {
  if (offset === 0) return "dnes";
  if (offset === 1) return "zítra";
  return dayStart(offset).toLocaleDateString(intlLocale(), { day: "numeric", month: "numeric" });
}

const RANGE_MIN = 0;
const RANGE_MAX = 30;

/** Dragging two handles on a phone to say "tonight" is a chore, so the common answers are one
 *  tap. Offsets are from today. */
function presets(): Array<{ id: string; label: string; range: [number, number] }> {
  const today = new Date().getDay();
  // Days until Saturday; Sunday is 0, so a Sunday's "weekend" is today.
  const toSaturday = today === 0 ? 0 : 6 - today;
  return [
    { id: "today", label: "Dnes", range: [0, 0] },
    { id: "weekend", label: "Víkend", range: [toSaturday, toSaturday + (today === 0 ? 0 : 1)] },
    { id: "week", label: "Týden", range: [0, 7] },
    { id: "month", label: "Měsíc", range: [0, 30] }
  ];
}

export function EventsTimeline() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const features = useMapStoreSnapshot((s) => s.visibleFeatures.events);
  const [range, setRange] = useState<[number, number]>([0, 7]);

  const visible = Boolean(active.events?.visible);

  // The layer reads the range through its filters, which is the same path every other layer
  // uses — the timeline writes a filter, the engine refetches.
  useEffect(() => {
    if (!visible) return;
    const from = dayStart(range[0]);
    const to = new Date(dayStart(range[1]).getTime() + DAY_MS - 1000);
    store.setLayerFilters("events", {
      ...(active.events?.filters ?? {}),
      from: from.toISOString(),
      to: to.toISOString()
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, range[0], range[1]]);

  // The histogram is counted from what the map already loaded, so it costs nothing extra — and
  // it is the thing that stops the axis looking like an empty strip: Saturday being five times
  // Wednesday is visible before you drag anything.
  const days = useMemo(() => {
    const counts = new Array<number>(RANGE_MAX + 1).fill(0);
    const today = dayStart(0).getTime();
    for (const feature of features ?? []) {
      const startsAt = feature.properties?.startsAt;
      if (typeof startsAt !== "string") continue;
      const offset = Math.floor((new Date(startsAt).getTime() - today) / DAY_MS);
      if (offset >= 0 && offset <= RANGE_MAX) counts[offset]! += 1;
    }
    return counts;
  }, [features]);

  const peak = useMemo(() => Math.max(1, ...days), [days]);
  const total = useMemo(
    () => days.slice(range[0], range[1] + 1).reduce((sum, n) => sum + n, 0),
    [days, range]
  );

  if (!visible) return null;

  const activePreset = presets().find((p) => p.range[0] === range[0] && p.range[1] === range[1]);

  return (
    <MapTimeline testId="events-timeline" wide>
      <div className="timeline-presets">
        {presets().map((preset) => (
          <button
            key={preset.id}
            className={`owm-pill ${activePreset?.id === preset.id ? "active" : ""}`}
            aria-pressed={activePreset?.id === preset.id}
            onClick={() => setRange(preset.range)}
            data-testid={`events-preset-${preset.id}`}
          >
            {preset.label}
          </button>
        ))}
        <span className="meta" data-testid="events-count">
          {total} {total === 1 ? "událost" : total >= 2 && total <= 4 ? "události" : "událostí"}
        </span>
      </div>

      <RangeSlider
        min={RANGE_MIN}
        max={RANGE_MAX}
        value={range}
        onChange={setRange}
        format={formatDay}
        label="Rozsah událostí"
        testId="events-range"
      >
        <div className="range-histogram" aria-hidden>
          {Array.from({ length: RANGE_MAX + 1 }, (_, day) => (
            <span
              key={day}
              className={`range-bar${day >= range[0] && day <= range[1] ? " in-range" : ""}`}
              style={{ height: `${((days[day] ?? 0) / peak) * 100}%` }}
            />
          ))}
        </div>
      </RangeSlider>
    </MapTimeline>
  );
}
