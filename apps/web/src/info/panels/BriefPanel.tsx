import { EmptyState, Skeleton } from "../../ui/primitives";
import { locationBriefRequest } from "../placeBriefRequest";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Neighbour {
  name: string;
  category: string;
  categoryLabel: string;
  distanceM: number;
}

interface Brief {
  text: string | null;
  model: string | null;
  nearby: Neighbour[];
  attribution: string;
}

/**
 * The generated brief, with the facts it was written from underneath it.
 *
 * The list is not decoration. A short generated paragraph is exactly the kind of text people
 * take at face value, so the things it was given — with distances — stay visible next to it, and
 * carry the panel on their own when the model has nothing to say.
 */
export function BriefPanel({ place }: InfoPanelProps) {
  // No pin here: this panel describes a location the reader clicked, so it sends the location
  // and nothing more (pin-specific facts travel with PlaceAiBrief).
  const state = useInfoData<Brief>("/info/brief", locationBriefRequest(place).query);

  if (state.status === "loading") return <Skeleton height={100} />;
  if (state.status !== "ready") {
    return <EmptyState title={state.status === "error" ? state.message : "Zatím tu nic nemáme"} />;
  }

  const { text, model, nearby } = state.data;
  return (
    <div className="info-panel" data-testid="panel-souhrn">
      {text ? (
        <p className="ai-brief" data-testid="brief-text">
          {text}
        </p>
      ) : (
        <p className="meta">Souhrn není k dispozici, tady je aspoň co je poblíž.</p>
      )}

      {nearby.length > 0 && (
        <ul className="brief-nearby">
          {nearby.map((n) => (
            <li key={`${n.name}-${n.distanceM}`}>
              <strong>{n.name}</strong>
              <span className="meta">
                {n.categoryLabel} · {n.distanceM} m
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="meta">
        {state.data.attribution}
        {model && ` · souhrn: ${model}`}
      </p>
    </div>
  );
}
