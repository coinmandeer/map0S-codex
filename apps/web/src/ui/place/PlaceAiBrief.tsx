import { useState } from "react";
import type { Place } from "@mapos/layer-sdk";
import { useInfoData } from "../../info/useInfoData";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Button, Chip, Icon, Skeleton } from "../kit";

interface Brief {
  text: string | null;
  model: string | null;
  nearby: { name: string; category: string; categoryLabel: string; distanceM: number }[];
  attribution: string;
}

/** The generated summary under the action row (§4.10).
 *
 *  It loads by itself when the detail opens, because a summary that needs a click is a tab
 *  nobody opens. The facts it was written from stay visible next to it: a short generated
 *  paragraph is exactly the kind of text people take at face value.
 */
export function PlaceAiBrief({ place }: { place: Place }) {
  const store = getMapStore();
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const autoSummary = useMapStoreSnapshot((state) => state.preferences.aiAutoSummary);
  const [requested, setRequested] = useState(false);
  const wanted = aiEnabled && (autoSummary || requested);

  if (!aiEnabled) return null;

  if (!wanted) {
    return (
      <section className="place-brief" data-testid="place-brief">
        <p className="place-brief-head">
          <Icon name="auto_awesome" size={18} />
          <span>Souhrn AI</span>
        </p>
        <Button
          variant="tonal"
          size="sm"
          icon="auto_awesome"
          testId="place-brief-load"
          onClick={() => setRequested(true)}
        >
          Načíst souhrn
        </Button>
      </section>
    );
  }

  return (
    <BriefContent
      place={place}
      onDisable={() => {
        store.setPreference("aiAutoSummary", false);
        setRequested(false);
        store.showToast("Automatický souhrn je vypnutý", {
          action: {
            label: "Vrátit",
            onSelect: () => store.setPreference("aiAutoSummary", true)
          }
        });
      }}
    />
  );
}

function BriefContent({ place, onDisable }: { place: Place; onDisable: () => void }) {
  const state = useInfoData<Brief>("/info/brief", {
    lng: place.lng.toFixed(4),
    lat: place.lat.toFixed(4),
    name: place.name,
    category: place.category,
    qid: place.wikidata
  });

  return (
    <section className="place-brief" data-testid="place-brief">
      <p className="place-brief-head">
        <Icon name="auto_awesome" size={18} />
        <span>Souhrn AI</span>
        <Button variant="text" size="sm" testId="place-brief-off" onClick={onDisable}>
          Vypnout
        </Button>
      </p>

      {state.status === "loading" && (
        <div className="place-brief-skeleton" data-testid="place-brief-loading">
          <Skeleton height={12} count={3} />
        </div>
      )}

      {state.status === "error" && (
        <p className="place-brief-empty">Souhrn se teď nepodařilo načíst.</p>
      )}

      {state.status === "empty" && (
        <p className="place-brief-empty">K tomuto místu jsem nic dalšího nenašla.</p>
      )}

      {state.status === "ready" && (
        <>
          {state.data.text ? (
            <p className="place-brief-text" data-testid="brief-text">
              {state.data.text}
            </p>
          ) : (
            <p className="place-brief-empty">K tomuto místu jsem nic dalšího nenašla.</p>
          )}
          {state.data.nearby.length > 0 && (
            <div className="place-brief-nearby">
              {state.data.nearby.slice(0, 4).map((neighbour) => (
                <Chip
                  key={`${neighbour.name}-${neighbour.distanceM}`}
                  label={`${neighbour.name} · ${neighbour.distanceM} m`}
                />
              ))}
            </div>
          )}
          <p className="place-brief-sources">
            Zdroje: {state.data.attribution}
            {state.data.model ? ` · ${state.data.model}` : ""}
          </p>
        </>
      )}
    </section>
  );
}
