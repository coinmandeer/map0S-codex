import { useMemo, useState, type ReactNode } from "react";
import type { Place, PlaceSourceId } from "@mapos/layer-sdk";
import { TabBar } from "../ui/primitives";
import { PIN_STYLES } from "../ui/presets";
import { infoPanelsFor } from "./registry";

/**
 * The place detail's body: hero, tab strip, active panel.
 *
 * The engine knows nothing about any individual panel. It asks the registry which panels this
 * place earns, and renders the one the user picked — so a new source of information about a
 * place is a new file plus a `registerInfoPanel` call, not a change here.
 */
export function InfoEngine({
  place,
  refs,
  photos = [],
  actions
}: {
  place: Place;
  refs: Partial<Record<PlaceSourceId, string>>;
  photos?: string[];
  /** Rendered under the hero — routing, saving and other things only the caller can do. */
  actions?: ReactNode;
}) {
  const panels = useMemo(() => infoPanelsFor({ place, refs }), [place, refs]);
  const [requested, setRequested] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  // Stepping to a neighbouring pin can take its tab away with it; falling back to the first
  // panel keeps the detail from going blank mid-browse.
  const active = panels.find((p) => p.id === requested) ?? panels[0];
  const Panel = active?.render;

  const style = PIN_STYLES[place.category];
  const hero = photos[photoIndex] ?? photos[0] ?? null;

  return (
    <div className="info-engine">
      {hero ? (
        <div className="pin-photo-wrap">
          <img className="pin-photo" src={hero} alt="" />
          {photos.length > 1 && (
            <div className="pin-gallery">
              {photos.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  className={i === photoIndex ? "active" : ""}
                  onClick={() => setPhotoIndex(i)}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="pin-photo-placeholder" aria-hidden>
          {style?.icon ?? "📍"}
        </div>
      )}

      <div className="pin-hero">
        <div className="pin-badge" style={{ background: style?.color ?? "#B7791F" }}>
          {style?.icon ?? "📍"}
        </div>
        <div>
          <h3>{place.name}</h3>
          <p className="meta">{style?.label ?? place.category}</p>
        </div>
        {place.rating != null && (
          <span className="pin-rating">
            ★ {place.rating.toFixed(1)}
            {place.ratingCount ? <span className="meta"> ({place.ratingCount})</span> : null}
          </span>
        )}
      </div>

      {actions && <div className="actions">{actions}</div>}

      <TabBar
        tabs={panels.map((p) => ({ id: p.id, label: p.label, icon: p.icon }))}
        active={active?.id ?? ""}
        onChange={setRequested}
        testId="info-tab"
      />

      <div className="info-body" role="tabpanel" data-testid="info-panel-body">
        {Panel ? <Panel place={place} refs={refs} /> : null}
      </div>
    </div>
  );
}
