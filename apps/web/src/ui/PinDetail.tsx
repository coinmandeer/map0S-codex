import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PLACE_SOURCE_BY_ID,
  distanceMeters,
  type DetailAction,
  type GeoFeature,
  type Place,
  type Position
} from "@mapos/layer-sdk";
import { InfoEngine } from "../info";
import { addPlaceToPlanDocument, MAX_INTERACTIVE_PLAN_STOPS } from "../info/placePlanAction";
import {
  detailActionsFromManifest,
  detailFieldsFromFeature,
  detailMediaFromFeature,
  osmCorrectionUrl,
  safeExternalUrl
} from "../info/detailModel";
import { API_BASE } from "../lib/api";
import { emit } from "../lib/events";
import { geolocation, messageFor, type Fix } from "../lib/geolocation";
import { fetchPlaceDetailStrict, placeRefsFromFeature, type PlaceRefs } from "../lib/placeDetail";
import { createSavedPlaceFromFeature, SAVED_PLACES_LAYER_ID } from "../lib/savedPlaces";
import { getLayerManifestV2 } from "../layers/registry";
import { EventPinDetail } from "../events/EventPinDetail";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PanelShell } from "./PanelShell";
import { Button, IconButton, InlineNotice, type MenuAction } from "./kit";
import { PlaceAction, PlaceActionOverflow, PlaceActionRow } from "./place/PlaceActionRow";
import { PlaceAiBrief } from "./place/PlaceAiBrief";
import { PlaceHero } from "./place/PlaceHero";
import { PlaceSocial } from "./PlaceSocial";
import { PrivatePlaceNote } from "./PrivatePlaceNote";

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function localId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

/** The place as the map already knows it. Rendered immediately, then filled by the server — the
 * detail opens at click speed and remains useful if the network is unavailable. */
const SERVICE_LABELS: Record<string, string> = {
  water: "Voda",
  electricity: "Elektřina",
  wifi: "Wifi",
  shower: "Sprcha",
  toilets: "WC"
};

function placeFromPin(refs: PlaceRefs, feature: GeoFeature): Place {
  const properties = feature.properties;
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const num = (value: unknown) => (typeof value === "number" ? value : undefined);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const tags = [
    ...list(properties.tags),
    ...list(properties.services).map((service) => SERVICE_LABELS[service] ?? service)
  ];
  const refreshedAt = str(properties.refreshedAt) ?? str(properties.updatedAt) ?? "";
  const elevation = properties.ele !== undefined ? Number(properties.ele) : undefined;

  return {
    id: refs.id,
    name: refs.name,
    lng: refs.lng,
    lat: refs.lat,
    category: refs.category,
    wikidata: refs.wikidata ?? undefined,
    fsqId: refs.fsqId ?? undefined,
    address: str(properties.address),
    website: str(properties.website),
    phone: str(properties.phone),
    openingHours: str(properties.opening_hours),
    description: str(properties.description),
    photo: str(properties.photo),
    rating: num(properties.rating),
    ratingCount: num(properties.reviews),
    elevationM: elevation !== undefined && Number.isFinite(elevation) ? elevation : undefined,
    tags: tags.length ? [...new Set(tags)] : undefined,
    sources: Object.entries(refs.refs)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([source, sourceRef]) => ({
        source: source as Place["sources"][number]["source"],
        sourceRef,
        confidence: 0.5,
        refreshedAt
      }))
  };
}

type DetailLoadState =
  { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

function sourceLabel(place: Place): string {
  const primary = place.sources[0]?.source;
  return (primary && PLACE_SOURCE_BY_ID[primary]?.label) || "zdroje";
}

/** Prev/next through the pins the map is currently showing, so a wrong guess costs one click
 *  rather than a close, a squint and another click. */
function PlaceStepper({
  index,
  total,
  onStep
}: {
  index: number;
  total: number;
  onStep: (delta: number) => void;
}) {
  if (index < 0 || total < 2) return null;
  return (
    <span className="place-stepper">
      <IconButton
        icon="chevron_left"
        label="Předchozí místo"
        size="sm"
        disabled={index <= 0}
        testId="pin-prev"
        onClick={() => onStep(-1)}
      />
      <span className="place-stepper-count">
        {index + 1} / {total}
      </span>
      <IconButton
        icon="chevron_right"
        label="Další místo"
        size="sm"
        disabled={index >= total - 1}
        testId="pin-next"
        onClick={() => onStep(1)}
      />
    </span>
  );
}

function PlacePinDetail() {
  const store = getMapStore();
  const shell = getShellStore();
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const pin = useMapStoreSnapshot((state) => state.selectedPin);
  const active = useMapStoreSnapshot((state) => state.activeLayers);
  const visibleFeatures = useMapStoreSnapshot((state) => state.visibleFeatures);
  const view = useMapStoreSnapshot((state) => state.view);

  const nearby = useMemo(() => {
    const all: { feature: GeoFeature; layerId: string; distance: number }[] = [];
    for (const [layerId, state] of Object.entries(active)) {
      if (!state.visible) continue;
      for (const feature of visibleFeatures[layerId] ?? []) {
        const [lng, lat] = feature.geometry.coordinates;
        all.push({ feature, layerId, distance: distanceMeters(view, { lng, lat }) });
      }
    }
    return all.sort((left, right) => left.distance - right.distance).slice(0, 80);
  }, [active, visibleFeatures, view]);

  const index = pin
    ? nearby.findIndex(
        (item) =>
          item.layerId === pin.layerId && item.feature.properties.id === pin.feature.properties.id
      )
    : -1;

  const goTo = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = nearby[index + delta];
      if (!next) return;
      const [lng, lat] = next.feature.geometry.coordinates;
      emit("fly-to", { lng, lat, zoom: 16 });
      store.selectPin({ feature: next.feature, layerId: next.layerId });
    },
    [index, nearby, store]
  );

  useEffect(() => {
    if (!pin || index < 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, index, goTo]);

  const refs = useMemo(() => (pin ? placeRefsFromFeature(pin.feature, pin.layerId) : null), [pin]);
  const manifest = useMemo(() => (pin ? getLayerManifestV2(pin.layerId) : undefined), [pin]);
  const media = useMemo(
    () => (pin ? detailMediaFromFeature(pin.feature, manifest) : []),
    [manifest, pin]
  );
  const providerFields = useMemo(
    () => (pin ? detailFieldsFromFeature(pin.feature, manifest) : []),
    [manifest, pin]
  );
  const manifestActions = useMemo(
    () => (pin ? detailActionsFromManifest(pin.feature, manifest) : []),
    [manifest, pin]
  );
  const [place, setPlace] = useState<Place | null>(null);
  const [legacyPhotos, setLegacyPhotos] = useState<string[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loadState, setLoadState] = useState<DetailLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!pin || !refs) return;
    const controller = new AbortController();
    const local = placeFromPin(refs, pin.feature);
    setPlace(local);
    setLegacyPhotos(local.photo ? [local.photo] : []);
    setPhotoIndex(0);
    setLoadState({ status: "loading" });

    void fetchPlaceDetailStrict(refs, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setPlace({
          ...local,
          ...Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined)),
          name: local.name || detail.name,
          tags: local.tags ?? detail.tags,
          sources: detail.sources.length ? detail.sources : local.sources
        } as Place);
        setLegacyPhotos(
          [local.photo, detail.photo].filter(
            (url, photoPosition, values): url is string =>
              Boolean(url) && values.indexOf(url) === photoPosition
          )
        );
        setLoadState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setLoadState({
          status: "error",
          message:
            typeof navigator !== "undefined" && navigator.onLine === false
              ? "Jsi offline. Zobrazuji data, která už byla v mapě."
              : "Úplný detail se nepodařilo načíst. Zobrazuji data z mapy."
        });
      });

    return () => controller.abort();
  }, [pin, refs, retry]);

  if (!pin || !refs || !place) return null;

  const { lng, lat } = refs;
  const rawExternalUrl = safeExternalUrl(pin.feature.properties.externalUrl);
  const hasManifestDeepLink = manifestActions.some((action) => action.kind === "open-url");
  const compatibilityAction: DetailAction | null =
    rawExternalUrl && !hasManifestDeepLink
      ? {
          id: "provider",
          label: `Otevřít u ${manifest?.name ?? sourceLabel(place)}`,
          kind: "open-url",
          url: rawExternalUrl,
          sourceId: manifest?.id,
          offlineAvailable: false
        }
      : null;
  const providerActions = [
    ...manifestActions.filter((action) => action.kind === "open-url" || action.kind === "report"),
    ...(compatibilityAction ? [compatibilityAction] : [])
  ];
  const correctionUrl = osmCorrectionUrl(refs.refs.osm);

  const planRoute = async (profile: "foot" | "bike" | "car" = "car") => {
    let fix: Fix;
    try {
      fix = await geolocation.getPosition();
    } catch (error) {
      store.showToast(messageFor(error));
      return;
    }
    try {
      const from = `${fix.lng},${fix.lat}`;
      const to = `${lng},${lat}`;
      const response = await fetch(`${API_BASE}/routing?from=${from}&to=${to}&profile=${profile}`);
      if (!response.ok) throw new Error(`routing ${response.status}`);
      const data = (await response.json()) as {
        coordinates: Position[];
        distanceM: number;
        durationS: number;
      };
      store.setRoutePreview({
        coordinates: data.coordinates,
        distanceM: data.distanceM,
        durationS: data.durationS,
        profile
      });
    } catch {
      store.showToast("Trasu se nepodařilo načíst");
    }
  };

  const savePlace = async () => {
    const result = await createSavedPlaceFromFeature(
      {
        ...pin.feature,
        properties: {
          ...pin.feature.properties,
          name: place.name,
          category: place.category,
          description: place.description
        }
      },
      pin.layerId
    );
    if (result === "auth") {
      store.openSheet("auth");
      store.showToast("Přihlas se pro uložení bodu");
      return;
    }
    if (result === "ok") emit("layers-changed");
    store.showToast(
      result === "ok"
        ? "Místo je uložené v Osobní"
        : result === "exists"
          ? "Místo už máš uložené"
          : "Uložení se nepovedlo"
    );
  };

  const addToPlan = () => {
    const document = store.activePlanDocument;
    if (!document) {
      store.selectPin(null);
      store.setMode("planning");
      store.showToast("Nejdřív vytvoř plán; místo pak přidej znovu");
      return;
    }
    if (document.stops.length >= MAX_INTERACTIVE_PLAN_STOPS) {
      store.showToast("Interaktivní plán už má 250 zastávek");
      return;
    }
    try {
      store.setActivePlanDocument(addPlaceToPlanDocument(document, place, localId));
      store.showToast("Místo je přidané do rozpracovaného plánu");
    } catch {
      store.showToast("Místo se nepodařilo přidat do plánu");
    }
  };

  const sharePlace = async () => {
    const text = `${place.name}\nMapOS ID: ${place.id}\nGPS: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: place.name, text });
      } else {
        await navigator.clipboard.writeText(text);
        store.showToast("Údaje o místě jsou zkopírované");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      store.showToast("Sdílení se nepodařilo");
    }
  };

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noreferrer");
  };

  const overflowActions: MenuAction[] = [
    ...providerActions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: (action.kind === "report" ? "flag" : "open_in_new") as MenuAction["icon"],
      onSelect: () => openExternal(action.url!)
    })),
    {
      id: "google",
      label: "Otevřít v Google Maps",
      icon: "open_in_new" as const,
      onSelect: () => openExternal(googleMapsLink(lat, lng))
    },
    ...(correctionUrl
      ? [
          {
            id: "osm",
            label: "Opravit v OpenStreetMap",
            icon: "edit" as const,
            onSelect: () => openExternal(correctionUrl)
          }
        ]
      : [])
  ];

  const returnTo = leftContext.type === "feature" ? leftContext.returnTo : undefined;

  return (
    <PanelShell
      title="Detail místa"
      testId="pin-detail"
      className="panel-place-detail"
      dismissible
      busy={loadState.status === "loading"}
      busyLabel="Doplňuji detail ze zdroje"
      onBack={
        returnTo && returnTo.type !== "closed" ? () => shell.closeFeatureContext() : undefined
      }
      headerExtra={<PlaceStepper index={index} total={nearby.length} onStep={goTo} />}
    >
      <PlaceHero
        place={place}
        media={media}
        photoIndex={photoIndex}
        onPhotoIndexChange={setPhotoIndex}
      />

      <PlaceActionRow>
        <PlaceAction
          icon="directions"
          label="Trasa"
          primary
          testId="route-car"
          onClick={() => void planRoute("car")}
        />
        <PlaceAction
          icon="add_location"
          label="Do plánu"
          testId="add-place-to-plan"
          onClick={addToPlan}
        />
        {pin.layerId !== SAVED_PLACES_LAYER_ID && (
          <PlaceAction
            icon="bookmark"
            label="Uložit"
            testId="save-place"
            onClick={() => void savePlace()}
          />
        )}
        <PlaceAction
          icon="share"
          label="Sdílet"
          testId="share-place"
          onClick={() => void sharePlace()}
        />
        <PlaceActionOverflow actions={overflowActions} />
      </PlaceActionRow>

      <PlaceAiBrief place={place} />

      {loadState.status === "error" && (
        <InlineNotice
          tone="warning"
          testId="detail-load-error"
          action={
            <Button variant="text" size="sm" onClick={() => setRetry((value) => value + 1)}>
              Zkusit znovu
            </Button>
          }
        >
          {loadState.message}
        </InlineNotice>
      )}

      <InfoEngine
        place={place}
        refs={refs.refs}
        media={media}
        photos={legacyPhotos}
        providerFields={providerFields}
        social={<PlaceSocial place={place} />}
        privateContent={<PrivatePlaceNote place={place} />}
      />
    </PanelShell>
  );
}

export function PinDetail() {
  const pin = useMapStoreSnapshot((state) => state.selectedPin);
  return pin?.layerId === "events" ? <EventPinDetail pin={pin} /> : <PlacePinDetail />;
}
