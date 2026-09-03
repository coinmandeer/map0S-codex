import { formatDistance } from "../../planning/planFormat";
import type { DistanceUnits } from "../../settings/preferences";
import { Button, Chip, InfoTip, Skeleton } from "../kit";
import type { AdventureCandidate, AdventureRecommendation } from "./types";

/** One row under the itinerary for the Dobrodružná profile (§29.3).
 *
 *  Every chip is a real OSM place whose detour was verified through the same routing provider
 *  as the plan, so the row can offer them without a card per candidate; the arithmetic behind
 *  the ranking sits in the InfoTip. */
export function PlanAdventure({
  recommendation,
  detourLimit,
  busy,
  routed,
  units,
  onApply
}: {
  recommendation: AdventureRecommendation | null;
  detourLimit: number;
  busy: boolean;
  /** Suggestions need a computed route to measure a detour against. */
  routed: boolean;
  units: DistanceUnits;
  onApply: (candidates: AdventureCandidate[]) => void;
}) {
  const suggestions = recommendation?.suggestions ?? [];

  return (
    <section className="planner-adventure" data-testid="adventure-planner" aria-busy={busy}>
      <header className="planner-adventure-head">
        <span className="kit-eyebrow">
          Zajímavá místa po cestě
          {suggestions.length > 0 && ` (${suggestions.length})`}
          <InfoTip title="Jak vzniká výběr" label="Jak vzniká výběr míst" testId="adventure-method">
            {recommendation
              ? `${recommendation.algorithm.formula}. Zajížďka každého místa je ověřená stejným
                 routovacím providerem jako trasa a nesmí překročit
                 ${recommendation.algorithm.detourLimitPercent} %.`
              : `Skutečná místa z OpenStreetMap v okolí trasy, seřazená podle zajímavosti a
                 ověřené zajížďky do ${detourLimit} %.`}
          </InfoTip>
        </span>
        {suggestions.length > 0 && (
          <Button
            variant="text"
            size="sm"
            icon="add_location"
            testId="apply-adventure-route"
            onClick={() => onApply(suggestions)}
          >
            Přidat všechna
          </Button>
        )}
      </header>

      {busy && <Skeleton height={32} />}

      {!busy && !routed && <p className="planner-hint">Místa se nabídnou po výpočtu trasy.</p>}

      {!busy && routed && suggestions.length === 0 && (
        <p className="planner-hint" role="status">
          V limitu {recommendation?.algorithm.detourLimitPercent ?? detourLimit} % není žádné vhodné
          místo. Zkus vyšší zajížďku v profilu trasy.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="planner-suggestions">
          {suggestions.map((candidate, index) => (
            <Chip
              key={candidate.id}
              icon="landscape"
              testId={`adventure-candidate-${index + 1}`}
              label={`${candidate.name} · +${formatDistance(candidate.detourM, units)}`}
              onClick={() => onApply([candidate])}
            />
          ))}
        </div>
      )}
    </section>
  );
}
