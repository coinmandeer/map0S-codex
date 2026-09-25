import { LiveTrafficDetail } from "./LiveTrafficDetail";
import { addDiscoveredPlace } from "../info/appendDiscoveredPlace";
import { worldRuntime } from "../world/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PLACE_SOURCE_BY_ID,
  distanceMeters,
  featureAnchor,
  type DetailAction,
  type DetailMediaAsset,
  type GeoFeature,
  type Place,
  type Position
} from "@mapos/layer-sdk";
import { InfoEngine } from "../info";

import {
  detailActionsFromManifest,
  detailFieldsFromFeature,
  detailMediaFromFeature,
  osmCorrectionUrl,
  safeExternalUrl
} from "../info/detailModel";
import { API_BASE } from "../lib/api";
import { t } from "../i18n";
import { presentationLabel } from "../i18n/presentation";
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
import { resolvePhotoUrl } from "./photoCache";

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** The place as the map already knows it. Rendered immediately, then filled by the server — the
 * detail opens at click speed and remains useful if the network is unavailable. */
const SERVICE_LABELS: Record<string, () => string> = {
  water: () => t("service.water"),
  electricity: () => t("service.electricity"),
  wifi: () => t("service.wifi"),
  shower: () => t("service.shower"),
  toilets: () => t("service.toilets")
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
    ...list(properties.services).map((service) => SERVICE_LABELS[service]?.() ?? service)
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
        label={t("place.previous")}
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
        label={t("place.next")}
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
  const nearby = useMemo(() => {
    // Freeze neighbours while this pin is open. Panning must not reorder navigation or sort
    // thousands of unrelated features during every camera notification.
    const active = store.activeLayers;
    const visibleFeatures = store.visibleFeatures;
    const view = store.view;
    const all: { feature: GeoFeature; layerId: string; distance: number }[] = [];
    for (const [layerId, state] of Object.entries(active)) {
      if (!state.visible) continue;
      for (const feature of visibleFeatures[layerId] ?? []) {
        const [lng, lat] = featureAnchor(feature);
        all.push({ feature, layerId, distance: distanceMeters(view, { lng, lat }) });
      }
    }
    return all.sort((left, right) => left.distance - right.distance).slice(0, 80);
  }, [store]);

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
      const [lng, lat] = featureAnchor(next.feature);
      emit("fly-to", { lng, lat, zoom: 16 });
      store.selectPin({ feature: next.feature, layerId: next.layerId });
    },
    [index, nearby, store]
  );

  useEffect(() => {
    if (!pin || index < 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest(
            "input,textarea,select,button,a,[contenteditable],[role=tablist],[role=dialog]"
          ))
      )
        return;
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
  const featureMedia = useMemo(
    () => (pin ? detailMediaFromFeature(pin.feature, manifest) : []),
    [manifest, pin]
  );
  // Photos found elsewhere: the place's Wikidata entry (P18 → Commons) and whatever the strict
  // detail fetch turned up. They arrive after the panel has already drawn, so they extend the
  // gallery rather than deciding the hero — and each one keeps the name of where it came from,
  // because a picture with no provenance is the thing this app is trying not to be.
  const lowData = useMapStoreSnapshot((state) => state.preferences.lowData);
  const [requestedMedia, setRequestedMedia] = useState<string | null>(null);
  const mediaKey = pin && refs ? `${pin.layerId}:${refs.id}` : null;
  const mediaAllowed = !lowData || (mediaKey !== null && requestedMedia === mediaKey);
  const [resolved, setResolved] = useState<DetailMediaAsset[]>([]);
  const media = useMemo(() => mergeMedia(featureMedia, resolved), [featureMedia, resolved]);
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
    setResolved([]);
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
        if (detail.photo) {
          setResolved((current) =>
            mergeMedia(current, [
              commonsAsset(`${refs.id}:detail`, detail.photo!, sourceLabel(detail), detail.name)
            ])
          );
        }
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
              ? t("place.detail.offline")
              : t("place.detail.partial")
        });
      });

    return () => controller.abort();
  }, [pin, refs, retry]);

  useEffect(() => {
    if (!refs || !mediaAllowed) return;
    const controller = new AbortController();
    // Wikidata knows a picture for a great many landmarks that carry none of their own.
    if (refs.wikidata && mediaAllowed) {
      void resolvePhotoUrl({ wikidata: refs.wikidata }).then((url) => {
        if (controller.signal.aborted || !url) return;
        setResolved((current) =>
          mergeMedia(current, [
            commonsAsset(`${refs.id}:wikidata`, url, "Wikimedia Commons", refs.name)
          ])
        );
      });
    }

    // A street-level frame as the header photo: Panoramax is keyless, so an empty answer only
    // means no coverage here. The thumbnail travels as a photo asset so the hero and the
    // lightbox behave like with any other picture.
    void fetch(`${API_BASE}/info/panorama/panoramax?lng=${refs.lng}&lat=${refs.lat}`, {
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (data: { status?: string; thumbnailUrl?: string | null; viewerUrl?: string } | null) => {
          if (controller.signal.aborted || !data || data.status !== "ready" || !data.thumbnailUrl)
            return;
          setResolved((current) =>
            mergeMedia(current, [
              {
                id: `${refs.id}:panoramax`,
                kind: "photo",
                url: data.thumbnailUrl!,
                thumbnailUrl: data.thumbnailUrl!,
                sourceId: "panoramax",
                sourceLabel: "Panoramax",
                ...(data.viewerUrl ? { sourceUrl: data.viewerUrl } : {}),
                attribution: "Panoramax",
                license: "CC-BY-SA-4.0",
                moderationStatus: "approved",
                transformStatus: "ready"
              }
            ])
          );
        }
      )
      .catch(() => {
        // No coverage and failed fetches both leave the gallery as it was.
      });

    return () => controller.abort();
  }, [refs, mediaAllowed]);

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
      store.showToast(t("place.route.failed"));
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
      store.showToast(t("place.save.signIn"));
      return;
    }
    if (result === "ok") emit("layers-changed");
    store.showToast(
      result === "ok"
        ? t("place.save.done")
        : result === "exists"
          ? t("place.save.exists")
          : t("place.save.failed")
    );
  };

  const addToPlan = () => addDiscoveredPlace(place);

  const sharePlace = async () => {
    const text = `${place.name}\nMapOS ID: ${place.id}\nGPS: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: place.name, text });
      } else {
        await navigator.clipboard.writeText(text);
        store.showToast(t("place.share.copied"));
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      store.showToast(t("place.share.failed"));
    }
  };

  const openExternal = (url: string) => {
    window.open(url, "_blank", "noreferrer");
  };

  const overflowActions: MenuAction[] = [
    { id: "share", label: t("action.share"), icon: "share", onSelect: () => void sharePlace() },
    {
      id: "message",
      label: t("polish.message"),
      icon: "chat_bubble",
      onSelect: () => worldRuntime.openSocial({ lng: place.lng, lat: place.lat, placeId: place.id })
    },
    ...providerActions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: (action.kind === "report" ? "flag" : "open_in_new") as MenuAction["icon"],
      onSelect: () => openExternal(action.url!)
    })),
    {
      id: "google",
      label: t("place.openGoogleMaps"),
      icon: "open_in_new" as const,
      onSelect: () => openExternal(googleMapsLink(lat, lng))
    },
    ...(correctionUrl
      ? [
          {
            id: "osm",
            label: t("polish.editOsm"),
            icon: "edit" as const,
            onSelect: () => openExternal(correctionUrl)
          }
        ]
      : [])
  ];

  const returnTo = leftContext.type === "feature" ? leftContext.returnTo : undefined;

  return (
    <PanelShell
      title={place.name}
      testId="pin-detail"
      className="panel-place-detail"
      dismissible
      busy={loadState.status === "loading"}
      busyLabel={t("place.detail.loading")}
      onBack={
        returnTo && returnTo.type !== "closed" ? () => shell.closeFeatureContext() : undefined
      }
      headerExtra={<PlaceStepper index={index} total={nearby.length} onStep={goTo} />}
    >
      {mediaAllowed && (
        <PlaceHero
          showIdentity={false}
          place={place}
          media={media}
          photoIndex={photoIndex}
          onPhotoIndexChange={setPhotoIndex}
        />
      )}
      <h2 className="detail-place-name">{place.name}</h2>
      {!mediaAllowed && (
        <Button
          variant="tonal"
          testId="load-place-media"
          onClick={() => setRequestedMedia(mediaKey)}
        >
          {t("settings.loadMedia")}
        </Button>
      )}
      <p className="place-identity-meta" data-testid="place-kind">
        {presentationLabel("category", place.category, place.category)}
        {place.rating != null ? ` · ★ ${place.rating.toFixed(1)}` : ""}
      </p>

      <PlaceActionRow>
        <PlaceAction
          icon="directions"
          label={t("polish.route")}
          primary
          testId="route-car"
          onClick={() => void planRoute("car")}
        />
        <PlaceAction
          icon="add_location"
          label={t("polish.plan")}
          testId="add-place-to-plan"
          onClick={addToPlan}
        />
        {pin.layerId !== SAVED_PLACES_LAYER_ID && (
          <PlaceAction
            icon="bookmark"
            label={t("action.save")}
            testId="save-place"
            onClick={() => void savePlace()}
          />
        )}
        <PlaceAction
          icon="share"
          label={t("action.share")}
          testId="share-place"
          onClick={() => void sharePlace()}
        />
      </PlaceActionRow>
      <div className="detail-extra-actions">
        <PlaceActionOverflow actions={overflowActions.filter((action) => action.id !== "share")} />
      </div>

      {loadState.status === "error" && (
        <InlineNotice
          tone="warning"
          testId="detail-load-error"
          action={
            <Button variant="text" size="sm" onClick={() => setRetry((value) => value + 1)}>
              {t("action.retry")}
            </Button>
          }
        >
          {loadState.message}
        </InlineNotice>
      )}

      <InfoEngine
        layerId={pin.layerId}
        key={`${pin.layerId}:${String(pin.feature.properties.id)}`}
        photoContent={
          mediaAllowed && media.some((asset) => asset.kind === "photo") ? (
            <PlaceHero
              showIdentity={false}
              place={place}
              media={media}
              photoIndex={photoIndex}
              onPhotoIndexChange={setPhotoIndex}
            />
          ) : (
            <p className="meta">
              {mediaAllowed
                ? "Pro toto místo zatím nemáme dostupné fotografie."
                : "Fotografie jsou vypnuté v režimu Low Data. Můžeš je načíst tlačítkem nahoře."}
            </p>
          )
        }
        place={mediaAllowed ? place : { ...place, photo: undefined }}
        refs={refs.refs}
        media={mediaAllowed ? media : []}
        photos={mediaAllowed ? legacyPhotos : []}
        providerFields={providerFields}
        summary={<PlaceAiBrief place={place} layerId={pin.layerId} feature={pin.feature} />}
        social={<PlaceSocial place={place} />}
        privateContent={<PrivatePlaceNote place={place} />}
      />
    </PanelShell>
  );
}

export function PinDetail() {
  const pin = useMapStoreSnapshot((state) => state.selectedPin);
  return pin && ["live-aircraft", "live-vessels"].includes(pin.layerId) ? (
    <LiveTrafficDetail key={`${pin.layerId}:${pin.feature.properties.id}`} feature={pin.feature} />
  ) : pin?.layerId === "events" ? (
    <EventPinDetail pin={pin} />
  ) : (
    <PlacePinDetail key={`${pin?.layerId}:${String(pin?.feature.properties.id)}`} />
  );
}

/** One photo from a named source, in the shape the gallery already understands. */
function commonsAsset(
  id: string,
  url: string,
  sourceLabel: string,
  caption?: string
): DetailMediaAsset {
  return {
    id,
    kind: "photo",
    url,
    thumbnailUrl: url,
    ...(caption ? { caption } : {}),
    sourceId: sourceLabel,
    sourceLabel,
    attribution: sourceLabel,
    license: "",
    // Published by the source under a free licence, already a thumbnail: nothing to moderate
    // here that the source has not moderated for fifteen years.
    moderationStatus: "approved",
    transformStatus: "ready"
  };
}

/** Union by URL: the same picture reached us from the feature and from Wikidata often enough
 *  that a two-photo gallery of one photo was the common case. */
function mergeMedia(
  base: readonly DetailMediaAsset[],
  extra: readonly DetailMediaAsset[]
): DetailMediaAsset[] {
  const seen = new Set(base.map((asset) => asset.url));
  return [...base, ...extra.filter((asset) => !seen.has(asset.url))];
}
