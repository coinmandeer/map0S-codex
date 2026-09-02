import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoFeature } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { RangeSlider } from "../ui/RangeSlider";
import {
  EVENT_TIMELINE_COMMIT_DELAY_MS,
  EVENT_TIMELINE_MAX,
  buildEventHistogram,
  dayToEventTimelinePosition,
  eventDateAtDay,
  eventFilterPatch,
  eventFilterPatchChanges,
  eventRangeFromFilters,
  eventRangePresets,
  eventTimelinePositionToDay,
  startOfLocalDay
} from "./timeline";

const EMPTY_EVENT_FEATURES: GeoFeature[] = [];

function formatDay(day: number, base: Date): string {
  if (day === 0) return "dnes";
  if (day === 1) return "zítra";
  return eventDateAtDay(day, base).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "short",
    year: day > 300 ? "numeric" : undefined
  });
}

export function EventTimelineContribution() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((state) => state.activeLayers);
  const features =
    useMapStoreSnapshot((state) => state.visibleFeatures.events) ?? EMPTY_EVENT_FEATURES;
  const filters = active.events?.filters ?? {};
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const base = useRef(startOfLocalDay(new Date()));
  const initialRange = useRef(eventRangeFromFilters(filters, base.current));
  const [trackRange, setTrackRange] = useState<[number, number]>([
    dayToEventTimelinePosition(initialRange.current[0]),
    dayToEventTimelinePosition(initialRange.current[1])
  ]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const range: [number, number] = [
    eventTimelinePositionToDay(trackRange[0]),
    eventTimelinePositionToDay(trackRange[1])
  ];
  const presets = useMemo(() => eventRangePresets(base.current), []);
  const activePreset = presets.find(
    (preset) => preset.range[0] === range[0] && preset.range[1] === range[1]
  );
  const histogram = useMemo(() => buildEventHistogram(features, base.current), [features]);
  const peak = Math.max(1, ...histogram);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = eventRangeFromFilters(filtersRef.current, base.current);
    const nextTrack: [number, number] = [
      dayToEventTimelinePosition(next[0]),
      dayToEventTimelinePosition(next[1])
    ];
    setTrackRange((current) =>
      Math.abs(current[0] - nextTrack[0]) < 0.01 && Math.abs(current[1] - nextTrack[1]) < 0.01
        ? current
        : nextTrack
    );
  }, [filters.from, filters.to]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const patch = eventFilterPatch(range, base.current);
      const current = filtersRef.current;
      if (eventFilterPatchChanges(current, patch)) {
        store.setLayerFilters("events", { ...current, ...patch });
      }
    }, EVENT_TIMELINE_COMMIT_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Filter values are outputs here; semantic comparison avoids feeding them back into a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range[0], range[1]]);

  const setPreset = (next: [number, number]) => {
    setTrackRange([dayToEventTimelinePosition(next[0]), dayToEventTimelinePosition(next[1])]);
  };

  return (
    <section className="event-timeline" aria-label="Roční časová osa událostí">
      <div className="event-timeline-heading">
        <div>
          <span>Časový výhled</span>
          <strong>Události na 12 měsíců</strong>
        </div>
        <span className="meta" data-testid="events-count" aria-live="polite">
          {features.length} {features.length === 1 ? "událost" : "událostí"} · {timezone}
        </span>
      </div>
      <div className="timeline-presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`owm-pill ${activePreset?.id === preset.id ? "active" : ""}`}
            aria-pressed={activePreset?.id === preset.id}
            onClick={() => setPreset(preset.range)}
            data-testid={`events-preset-${preset.id}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <RangeSlider
        min={0}
        max={EVENT_TIMELINE_MAX}
        value={trackRange}
        onChange={setTrackRange}
        format={(position) => formatDay(eventTimelinePositionToDay(position), base.current)}
        label="Rozsah událostí v příštím roce"
        testId="events-range"
      >
        <div className="range-histogram" aria-hidden>
          {histogram.map((count, index) => {
            const bucketStart = (index / histogram.length) * EVENT_TIMELINE_MAX;
            const inRange = bucketStart >= trackRange[0] && bucketStart <= trackRange[1];
            return (
              <span
                key={index}
                className={`range-bar${inRange ? " in-range" : ""}`}
                style={{ height: `${(count / peak) * 100}%` }}
              />
            );
          })}
        </div>
        <span className="event-scale-break" aria-hidden />
      </RangeSlider>
      <div className="event-scale-labels" aria-label="Měřítko časové osy">
        <span>Dnes–90 dní · detailní denní měřítko</span>
        <span>3–12 měsíců · zhuštěno po týdnech a měsících</span>
      </div>
      <p className="event-timeline-note">
        Výběr mění body v mapě i seznam v panelu Objevuj bez dalšího paralelního dotazu.
      </p>
    </section>
  );
}
