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
      linkLabel="Otevřít v OpenStreetMap"
      attribution="© OpenStreetMap přispěvatelé (ODbL)"
      height={360}
    />
  );
}

export function MapillaryPanel({ place }: InfoPanelProps) {
  return (
    <EmbedFrame
      testId="panel-mapillary"
      url={`https://www.mapillary.com/embed?map_style=Mapillary+streets&lat=${place.lat}&lng=${place.lng}&z=17&style=photo`}
      title="Mapillary"
      linkLabel="Otevřít na Mapillary"
      attribution="Mapillary (CC BY-SA)"
    />
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
      linkLabel="Otevřít na Windy.com"
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
