import { useSectionEmpty } from "../SectionAvailability";
import { EmptyState, Skeleton } from "../../ui/primitives";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface GeologyUnit {
  id: string;
  name: string;
  lithology: string | null;
  description: string | null;
  period: string | null;
  ageRange: [number, number] | null;
  color: string | null;
}

interface GeologyReport {
  units: GeologyUnit[];
  explanation: string | null;
  model: string | null;
  attribution: string;
}

/** Ages here run from thousands of years to billions, so the unit has to move with them. */
function formatAge(range: [number, number]): string {
  const [older, younger] = range;
  const one = (ma: number) => {
    if (ma >= 1000) return `${(ma / 1000).toFixed(1)} mld.`;
    if (ma >= 1) return `${Math.round(ma)} mil.`;
    return `${Math.round(ma * 1000)} tis.`;
  };
  return `před ${one(older)} – ${one(younger)} let`;
}

export function GeologyPanel({ place }: InfoPanelProps) {
  const state = useInfoData<GeologyReport>("/info/geology", {
    lng: place.lng.toFixed(4),
    lat: place.lat.toFixed(4)
  });

  useSectionEmpty(
    state.status === "empty" ||
      (state.status === "ready" && !state.data.units.length && !state.data.explanation)
  );
  if (state.status === "loading") return <Skeleton height={120} />;
  if (state.status !== "ready") {
    return (
      <EmptyState
        title={state.status === "error" ? state.message : "Geologii pro toto místo neznáme"}
      />
    );
  }

  const { units, explanation, model, attribution } = state.data;
  return (
    <div className="info-panel" data-testid="panel-geologie">
      {explanation && (
        <p className="ai-brief" data-testid="geology-explanation">
          {explanation}
        </p>
      )}

      <ul className="geology-units">
        {units.map((unit) => (
          <li key={unit.id} className="geology-unit">
            <span
              className="geology-swatch"
              style={{ background: unit.color ?? "#9ca3af" }}
              aria-hidden
            />
            <div>
              <strong>{unit.name}</strong>
              {unit.lithology && unit.lithology !== unit.name && (
                <span className="meta"> · {unit.lithology}</span>
              )}
              <div className="meta">
                {unit.period}
                {unit.period && unit.ageRange && " · "}
                {unit.ageRange && formatAge(unit.ageRange)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="meta">
        {attribution}
        {model && ` · vysvětlení: ${model}`}
      </p>
    </div>
  );
}
