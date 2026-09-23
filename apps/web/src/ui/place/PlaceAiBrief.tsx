import { useState } from "react";
import { t, activeLocale } from "../../i18n";
import type { GeoFeature, Place, OverviewTarget } from "@mapos/layer-sdk";
import { pinBriefRequest } from "../../info/placeBriefRequest";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { OverviewView } from "../ai/OverviewView";
import { Button } from "../kit";

/** The generated overview in the place detail. Runs on its own when the layer allows it and the
 *  reader has the AI features on; web research is the default source, because a named pin is a
 *  thing the web may know about and the local source alone is the same paragraph for every
 *  street corner. */
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
  // `auto` layers generate the overview without a click; a manual click only collapses it again.
  // The pin's own public fields travel with the request so the answer describes the object, not the
  // corner — they are untrusted data on the server and never choose a source.
  const [open, setOpen] = useState(brief.auto && aiEnabled);
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
