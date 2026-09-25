import { t, intlLocale } from "../../i18n";
import { useInfoData } from "../useInfoData";
import { useState } from "react";
/** Panels that show somebody else's page.
 *
 *  Each one is a URL builder plus the question "can this be framed?" — the answer comes from
 *  the server probe inside `EmbedFrame`, so a service that starts refusing embeds degrades to a
 *  link on its own rather than needing a code change. */

import { EmbedFrame } from "../EmbedFrame";
import type { InfoPanelProps } from "../registry";

export function OsmPanel({ place }: InfoPanelProps) {
  const box = 0.004;
  const bbox = [place.lng - box, place.lat - box / 2, place.lng + box, place.lat + box / 2]
    .map((n) => n.toFixed(5))
    .join("%2C");
  const marker = `${place.lat.toFixed(5)}%2C${place.lng.toFixed(5)}`;

  return (
    <EmbedFrame
      testId="panel-osm"
      url={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`}
      title="OpenStreetMap"
      linkLabel={t("polish.open", { name: "OpenStreetMap" })}
      attribution="© OpenStreetMap přispěvatelé (ODbL)"
      height={360}
    />
  );
}

export function MapillaryPanel({ place, refs }: InfoPanelProps) {
  const known = String(
    (refs as Record<string, string | undefined>).mapillary ??
      (place.id.startsWith("mapillary:") ? place.id : "")
  ).replace(/^mapillary:/, "");
  const imageId = /^\d{1,30}$/.test(known) ? known : null;
  const [retry, setRetry] = useState(0);
  return (
    <StreetPanorama
      key={`${place.id}:${retry}`}
      place={place}
      refs={refs}
      imageId={imageId}
      retry={() => setRetry((value) => value + 1)}
    />
  );
}
function StreetPanorama({
  place,
  imageId,
  retry
}: InfoPanelProps & { imageId: string | null; retry: () => void }) {
  const state = useInfoData<{
    status: "ready" | "empty" | "unconfigured";
    imageId?: string;
    distanceMeters?: number;
    capturedAt?: string;
    isPano?: boolean;
    sequence?: string | null;
    images?: Array<{
      imageId: string;
      distanceMeters: number;
      isPano: boolean;
      sequence: string | null;
    }>;
  }>(imageId ? null : "/info/panorama", { lng: place.lng, lat: place.lat });
  const [chosen, setChosen] = useState<string | null>(null);
  const images =
    state.status === "ready" && Array.isArray(state.data.images) ? state.data.images : [];
  const selectedImage =
    chosen ??
    imageId ??
    (state.status === "ready" && state.data.status === "ready" ? state.data.imageId : null);
  if (selectedImage)
    return (
      <>
        {state.status === "ready" && (
          <p className="meta">
            {t("polish.panoramaNearby", { distance: state.data.distanceMeters ?? 0 })}
            {state.data.capturedAt
              ? ` · ${new Date(state.data.capturedAt).toLocaleDateString(intlLocale())}`
              : ""}
            {state.data.isPano ? ` · ${t("polish.panorama360")}` : ""}.
          </p>
        )}
        <EmbedFrame
          testId="panel-mapillary"
          url={`https://www.mapillary.com/embed?image_key=${encodeURIComponent(selectedImage)}&style=photo`}
          title="Mapillary — pohled z ulice"
          linkLabel={t("polish.open", { name: "Mapillary" })}
          attribution="Mapillary · atribuce a datum ve snímku"
          height={360}
        />
        {images.length > 1 && (
          <div className="panorama-sequence" data-testid="panorama-sequence">
            <span className="meta">{t("polish.panoramaSequence")}</span>
            <div className="panorama-sequence-items">
              {images.map((image) => (
                <button
                  key={image.imageId}
                  type="button"
                  className="panorama-sequence-item"
                  aria-pressed={image.imageId === selectedImage}
                  data-testid={`panorama-image-${image.imageId}`}
                  onClick={() => setChosen(image.imageId)}
                >
                  {image.distanceMeters} m{image.isPano ? " · 360°" : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </>
    );
  return (
    <div className="info-panel" data-testid="panel-mapillary">
      <p role="status">
        {state.status === "loading"
          ? t("polish.panoramaSearching")
          : state.status === "error"
            ? t("polish.panoramaError")
            : state.status === "ready" && state.data.status === "unconfigured"
              ? t("polish.panoramaUnconfigured")
              : t("polish.panoramaEmpty")}
      </p>
      {state.status === "error" && (
        <button className="kit-button" onClick={retry}>
          {t("action.retry")}
        </button>
      )}
      <a
        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${place.lat},${place.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        {t("polish.panoramaGoogle")} ↗
      </a>
      <p className="meta">
        <a
          href={`https://www.mapillary.com/app/?lat=${place.lat}&lng=${place.lng}&z=17`}
          target="_blank"
          rel="noreferrer"
        >
          {t("polish.panoramaMapillary")} ↗
        </a>
      </p>
    </div>
  );
}

/** The same street-level question as Mapillary, answered by the open Panoramax network.
 *
 *  The reader gets a real thumbnail from the picture's own instance and a link to its viewer,
 *  rather than an embed: Panoramax instances open a picture on their own page, and pretending
 *  otherwise would be an iframe we cannot guarantee. */
export function PanoramaxPanel({ place }: InfoPanelProps) {
  const state = useInfoData<{
    status: "ready" | "empty";
    imageId?: string;
    distanceMeters?: number;
    capturedAt?: string | null;
    viewerUrl?: string;
    thumbnailUrl?: string | null;
    sequence?: string | null;
  }>("/info/panorama/panoramax", { lng: place.lng, lat: place.lat });
  if (state.status === "loading") return <p role="status">{t("polish.panoramaSearching")}</p>;
  if (state.status !== "ready" || state.data.status === "empty") {
    return (
      <div className="info-panel" data-testid="panel-panoramax">
        <p>{state.status === "error" ? t("polish.panoramaError") : t("polish.panoramaEmpty")}</p>
        <p className="meta">
          <a
            href={`https://api.panoramax.xyz/#focus=pic&map=17/${place.lat}/${place.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("polish.panoramaPanoramax")} ↗
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="info-panel" data-testid="panel-panoramax">
      <p className="meta">
        {t("polish.panoramaNearby", { distance: state.data.distanceMeters ?? 0 })}
        {state.data.capturedAt
          ? ` · ${new Date(state.data.capturedAt).toLocaleDateString(intlLocale())}`
          : ""}
      </p>
      {state.data.thumbnailUrl && (
        <img
          className="detail-panorama-thumb"
          src={state.data.thumbnailUrl}
          alt={place.name}
          loading="lazy"
        />
      )}
      {state.data.viewerUrl && (
        <a className="kit-button" href={state.data.viewerUrl} target="_blank" rel="noreferrer">
          {t("polish.open", { name: "Panoramax" })} ↗
        </a>
      )}
    </div>
  );
}

export function WindyPanel({ place }: InfoPanelProps) {
  const params = new URLSearchParams({
    lat: place.lat.toFixed(3),
    lon: place.lng.toFixed(3),
    detailLat: place.lat.toFixed(3),
    detailLon: place.lng.toFixed(3),
    zoom: "9",
    level: "surface",
    overlay: "wind",
    detail: "true",
    metricWind: "km/h",
    metricTemp: "°C"
  });
  return (
    <EmbedFrame
      testId="panel-windy"
      url={`https://embed.windy.com/embed2.html?${params}`}
      title="Windy"
      linkLabel={t("polish.open", { name: "Windy" })}
      attribution="Windy.com"
      height={440}
    />
  );
}

/** Framing is refused outright by these, so they are declared `link` panels and never render a
 *  frame at all — the probe would only confirm what we already know. */
export function ExternalLinksPanel({ place, refs }: InfoPanelProps) {
  const links: Array<{ label: string; url: string; note: string }> = [
    {
      label: "Google Maps",
      url: `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`,
      note: "Recenze, fotky a Street View"
    },
    {
      label: "Geocaching",
      url: `https://www.geocaching.com/play/map?lat=${place.lat}&lng=${place.lng}&zoom=14`,
      note: "Keše v okolí"
    },
    {
      label: "Komoot",
      url: `https://www.komoot.com/discover/${place.lat},${place.lng}`,
      note: "Trasy v okolí"
    }
  ];

  if (refs.osm) {
    links.push({
      label: "Editovat v OSM",
      url: `https://www.openstreetmap.org/edit?node=${refs.osm}`,
      note: "Opravit údaje o tomto místě"
    });
  }
  if (place.website) {
    links.unshift({ label: "Oficiální web", url: place.website, note: "Stránky provozovatele" });
  }

  return (
    <div className="info-panel" data-testid="panel-odkazy">
      <ul className="info-links">
        {links.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noreferrer">
              <strong>{link.label}</strong>
              <span className="meta">{link.note}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="meta">Tyto služby nedovolují vložení do stránky, otevřou se v novém panelu.</p>
    </div>
  );
}
