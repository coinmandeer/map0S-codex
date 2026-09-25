import { useState } from "react";
import { t, activeLocale } from "../../i18n";
import type { GeoFeature, Place, OverviewTarget } from "@mapos/layer-sdk";
import { pinBriefRequest } from "../../info/placeBriefRequest";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { OverviewView } from "../ai/OverviewView";
import { Button } from "../kit";

/** Optional overview below the factual detail; starts only when the reader expands it. */
export function PlaceAiBrief({
  place,
  layerId,
  feature
}: {
  place: Place;
  layerId?: string;
  feature?: GeoFeature;
}) {
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const lowData = useMapStoreSnapshot((state) => state.preferences.lowData);
  const worldId = useMapStoreSnapshot((state) => state.experienceId);
  const brief = pinBriefRequest({ place, layerId, feature });
  const externalModel = aiEnabled && !lowData;
  // Overview stays collapsed until requested, including auto-capable layers.
  // The pin's own public fields travel with the request so the answer describes the object, not the
  // corner — they are untrusted data on the server and never choose a source.
  const [open, setOpen] = useState(false);
  if (!brief.enabled) return null;
  const target: OverviewTarget =
    layerId && feature?.properties.id != null
      ? {
          type: "poi",
          layerId,
          featureId: String(feature.properties.id),
          lng: place.lng,
          lat: place.lat
        }
      : { type: "coordinate", lng: place.lng, lat: place.lat };
  return (
    <div data-testid="place-brief">
      <Button
        size="sm"
        icon="auto_awesome"
        aria-expanded={open}
        testId="place-overview-open"
        onClick={() => setOpen((value) => !value)}
      >
        {t("polish.overview")}
      </Button>
      {open && (
        <OverviewView
          request={{
            target,
            language: activeLocale(),
            worldId,
            web: externalModel,
            consent: { externalModel },
            ...(brief.query.facts ? { facts: brief.query.facts } : {}),
            ...(brief.query.layerName ? { intent: brief.query.layerName } : {})
          }}
          autoStart={brief.auto}
        />
      )}
    </div>
  );
}
