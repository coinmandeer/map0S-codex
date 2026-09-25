import { st } from "../statistics/labels";
import { DetailDisclosure, LocalStatistics, NearbyMapPlaces } from "./PlaceDetailSections";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  isDisplayableDetailMedia,
  type DetailFieldValue,
  type DetailMediaAsset,
  type Place,
  type PlaceSourceId
} from "@mapos/layer-sdk";
import { DETAIL_SURFACE_V2_ENABLED } from "../lib/featureFlags";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Tabs, Button, Dialog } from "../ui/kit";
import { t } from "../i18n";
import { presentationLabel } from "../i18n/presentation";
import { uniqueProviderFields } from "./detailProfile";
import { SectionAvailability } from "./SectionAvailability";
import { PLACE_SOURCE_BY_ID } from "@mapos/layer-sdk";
import { PracticalPanel } from "./panels/PracticalPanel";
import { TabBar } from "../ui/primitives";
import { ModuleErrorBoundary } from "../ui/primitives/ModuleErrorBoundary";
import { PIN_STYLES } from "../ui/presets";
import { safeExternalUrl } from "./detailModel";
import { infoPanelsFor, type InfoPanel } from "./registry";
import { intlLocale } from "../i18n";

interface InfoEngineProps {
  layerId?: string;
  place: Place;
  refs: Partial<Record<PlaceSourceId, string>>;
  /** Rights-complete media only. Raw legacy photo URLs are accepted by the rollback branch. */
  media?: DetailMediaAsset[];
  /** @deprecated Compatibility input used only when VITE_DETAIL_SURFACE_V2 is disabled. */
  photos?: string[];
  providerFields?: DetailFieldValue[];
  /** MapOS-owned community content; provider panels remain separate registry entries. */
  social?: ReactNode;
  summary?: ReactNode;
  photoContent?: ReactNode;
  /** Owner-only/device-only content, rendered in its own labelled bucket. */
  privateContent?: ReactNode;
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function newestSourceDate(place: Place): string | null {
  const dates = place.sources
    .map((source) => Date.parse(source.refreshedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left);
  return dates.length ? new Date(dates[0]!).toLocaleString(intlLocale()) : null;
}

function PlaceHero({
  place,
  media,
  photoIndex,
  setPhotoIndex
}: {
  place: Place;
  media: DetailMediaAsset[];
  photoIndex: number;
  setPhotoIndex(index: number): void;
}) {
  const style = PIN_STYLES[place.category];
  const photos = media.filter((asset) => asset.kind === "photo");
  const hero = photos[photoIndex] ?? photos[0] ?? null;
  const refreshed = newestSourceDate(place);

  return (
    <>
      {hero ? (
        <div className="pin-photo-wrap">
          <img className="pin-photo" src={hero.url} alt={hero.caption ?? place.name} />
          <p className="media-credit">
            {hero.attribution} · {hero.license}
          </p>
          {photos.length > 1 && (
            <div className="pin-gallery">
              {photos.map((asset, index) => (
                <button
                  key={asset.id}
                  type="button"
                  className={index === photoIndex ? "active" : ""}
                  onClick={() => setPhotoIndex(index)}
                  aria-label={`Fotografie ${index + 1}`}
                >
                  <img src={asset.thumbnailUrl ?? asset.url} alt="" />
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
          {refreshed && <p className="meta">Zdrojová data: {refreshed}</p>}
        </div>
        {place.rating != null && (
          <span className="pin-rating">
            ★ {place.rating.toFixed(1)}
            {place.ratingCount ? <span className="meta"> ({place.ratingCount})</span> : null}
          </span>
        )}
      </div>
    </>
  );
}

function PanelGroup({
  panels,
  place,
  refs,
  sourceLabels = false
}: {
  panels: InfoPanel[];
  place: Place;
  refs: Partial<Record<PlaceSourceId, string>>;
  sourceLabels?: boolean;
}) {
  const [requested, setRequested] = useState<string | null>(null);
  const active = panels.find((panel) => panel.id === requested) ?? panels[0];
  const Panel = active?.render;
  if (!Panel || !active) return null;

  const body = (
    <>
      {sourceLabels && (
        <div className="detail-source-label">
          <strong>{active.label}</strong>
          <span>{active.attribution}</span>
        </div>
      )}
      <ModuleErrorBoundary
        moduleId={`place-detail-extension:${active.id}`}
        title={active.label}
        compact
        resetKey={active.id}
      >
        <Panel place={place} refs={refs} />
      </ModuleErrorBoundary>
    </>
  );

  if (panels.length === 1) {
    return (
      <div className="detail-panel-group">
        <span className="legacy-info-tab-marker" data-testid={`info-tab-${active.id}`} />
        {body}
      </div>
    );
  }

  return (
    <div className="detail-panel-group">
      <Tabs
        testId="info-tab"
        value={active.id}
        onValueChange={setRequested}
        tabs={panels.map((panel) => ({
          id: panel.id,
          label: panel.label,
          // Only the selected source is mounted: every panel fetches on mount, and opening a
          // place must not fire one request per integration.
          children: panel.id === active.id ? body : null
        }))}
      />
    </div>
  );
}

function fieldContent(field: DetailFieldValue): ReactNode {
  const value = Array.isArray(field.value) ? field.value.join(" · ") : field.value;
  if (field.kind === "link") {
    const url = safeExternalUrl(String(value));
    if (url) {
      return (
        <a href={url} target="_blank" rel="noreferrer">
          {new URL(url).hostname.replace(/^www\./, "")}
        </a>
      );
    }
  }
  if (field.kind === "phone") {
    return <a href={`tel:${String(value).replace(/\s+/g, "")}`}>{String(value)}</a>;
  }
  if (field.kind === "email") return <a href={`mailto:${String(value)}`}>{String(value)}</a>;
  if (typeof value === "boolean") return value ? t("polish.yes") : t("polish.no");
  return String(value);
}

function ProviderFields({ fields }: { fields: DetailFieldValue[] }) {
  if (!fields.length) return null;
  const bySource = groupBy(fields, (field) => `${field.sourceId}\0${field.sourceLabel}`);
  return (
    <div className="detail-provider-fields">
      {[...bySource.entries()].map(([key, values]) => {
        const [sourceId, sourceLabel] = key.split("\0");
        return (
          <section className="detail-source-group" key={key} data-source-id={sourceId}>
            <div className="detail-source-label">
              <strong>{sourceLabel}</strong>
              <span>{t("polish.provider")}</span>
            </div>
            <dl className="info-facts">
              {values.map((field) => (
                <div className="detail-field-row" key={field.id}>
                  <dt>{field.label}</dt>
                  <dd>{fieldContent(field)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

/** Two-column gallery with the media's own aspect ratio (§2.10). A photo is a box of its own
 *  shape, not a fixed tile cropped to square; a video never autoplays; a link is a link. */
function MediaGallery({ media }: { media: DetailMediaAsset[] }) {
  return (
    <div className="detail-media-grid" data-testid="detail-media-gallery">
      {media.map((asset) => (
        <figure key={asset.id} className="detail-media-item" data-kind={asset.kind}>
          {asset.kind === "photo" && (
            <img src={asset.thumbnailUrl ?? asset.url} alt={asset.caption ?? ""} loading="lazy" />
          )}
          {asset.kind === "video" && (
            <video controls preload="metadata" poster={asset.thumbnailUrl}>
              <source src={asset.url} />
            </video>
          )}
          {asset.kind === "link" && (
            <a href={asset.url} target="_blank" rel="noreferrer">
              {asset.caption ?? "Otevřít médium"}
            </a>
          )}
          <figcaption>
            {asset.caption && <span>{asset.caption}</span>}
            {asset.sourceUrl ? (
              <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                {asset.attribution} · {asset.license}
              </a>
            ) : (
              <span>
                {asset.attribution} · {asset.license}
              </span>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * Files the reader can actually take away (§2.10).
 *
 * Only media the source publishes as a file is offered, and it is linked rather than proxied:
 * re-serving somebody else's asset from our origin would misrepresent where it came from and
 * break the credit. With nothing downloadable the section is simply absent.
 */
function DetailDownloads({ media, place }: { media: DetailMediaAsset[]; place: Place }) {
  const downloadable = media.filter((asset) => asset.kind === "photo" || asset.kind === "video");
  if (!downloadable.length) return null;
  return (
    <section className="detail-downloads" data-testid="detail-downloads">
      <h4>{t("polish.downloads")}</h4>
      <ul>
        {downloadable.map((asset) => (
          <li key={asset.id}>
            <a href={asset.url} target="_blank" rel="noreferrer" download>
              {asset.caption ?? `${place.name} · ${asset.kind === "photo" ? "foto" : "video"}`}
            </a>
            <small className="meta">
              {asset.attribution}
              {asset.license ? ` · ${asset.license}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LegacyInfoEngine({ place, refs, photos = [], social }: InfoEngineProps) {
  const panels = useMemo(() => infoPanelsFor({ place, refs }), [place, refs]);
  const [requested, setRequested] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const active = panels.find((panel) => panel.id === requested) ?? panels[0];
  const Panel = active?.render;
  const legacyMedia: DetailMediaAsset[] = photos.map((url, index) => ({
    id: `legacy-${index}`,
    kind: "photo",
    url,
    sourceId: "legacy",
    sourceLabel: "Legacy",
    attribution: "Legacy",
    license: "Legacy rollback only",
    moderationStatus: "approved",
    transformStatus: "ready"
  }));

  return (
    <div className="info-engine" data-detail-surface="legacy">
      <PlaceHero
        place={place}
        media={legacyMedia}
        photoIndex={photoIndex}
        setPhotoIndex={setPhotoIndex}
      />
      <TabBar
        tabs={panels.map((panel) => ({ id: panel.id, label: panel.label, icon: panel.icon }))}
        active={active?.id ?? ""}
        onChange={setRequested}
        testId="info-tab"
      />
      <div className="info-body" role="tabpanel" data-testid="info-panel-body">
        {Panel ? (
          <ModuleErrorBoundary
            moduleId={`legacy-place-detail-extension:${active?.id ?? "unknown"}`}
            title={active?.label ?? "Rozšíření detailu"}
            compact
            resetKey={active?.id}
          >
            <Panel place={place} refs={refs} />
          </ModuleErrorBoundary>
        ) : null}
      </div>
      {social}
    </div>
  );
}

function DetailSection({
  panel,
  place,
  refs
}: {
  panel: InfoPanel;
  place: Place;
  refs: InfoEngineProps["refs"];
}) {
  const [status, setStatus] = useState({ empty: false, error: false });
  const report = useCallback(
    (patch: { empty?: boolean; error?: boolean }) =>
      setStatus((previous) => ({ ...previous, ...patch })),
    []
  );
  const [retry, setRetry] = useState(0);
  return (
    <section
      className="detail-source-group"
      hidden={status.empty}
      data-testid={`detail-section-${panel.id}`}
    >
      <h4>{presentationLabel("panel", panel.id, panel.label)}</h4>
      <SectionAvailability.Provider value={report}>
        <PanelGroup
          key={`${place.id}:${panel.id}:${retry}`}
          panels={[panel]}
          place={place}
          refs={refs}
        />
      </SectionAvailability.Provider>
      {status.error && (
        <Button
          className="detail-section-retry"
          size="sm"
          onClick={() => setRetry((value) => value + 1)}
        >
          {t("action.retry")}
        </Button>
      )}
    </section>
  );
}

function UnifiedInfoEngine({
  place,
  refs,
  providerFields = [],
  social,
  summary,
  privateContent,
  media: rawMedia = []
}: InfoEngineProps) {
  const fsqEnabled = useMapStoreSnapshot((state) => Boolean(state.capabilities?.fsq));
  const panels = useMemo(
    () => infoPanelsFor({ place, refs }).filter((panel) => panel.id !== "foursquare" || fsqEnabled),
    [place, refs, fsqEnabled]
  );
  const media = useMemo(() => rawMedia.filter(isDisplayableDetailMedia), [rawMedia]);
  const fields = uniqueProviderFields(providerFields, place);
  const [tab, setTab] = useState("info");
  const [visited, setVisited] = useState(() => new Set(["info"]));
  const [embed, setEmbed] = useState<string | null>(null);
  const selectedEmbed = panels.find((panel) => panel.id === embed);
  const changeTab = (value: string) => {
    setTab(value);
    setVisited((previous) => new Set([...previous, value]));
  };
  const sources = [...new Map(place.sources.map((source) => [source.source, source])).values()];
  const caveats = [
    ...new Set(sources.map((source) => PLACE_SOURCE_BY_ID[source.source]?.caveat).filter(Boolean))
  ];
  const panelFor = (id: string) => panels.find((p) => p.id === id);
  const renderPanel = (id: string) => {
    const panel = panelFor(id);
    return panel ? <DetailSection panel={panel} place={place} refs={refs} /> : null;
  };
  const panorama = (
    <Button icon="photo_camera" onClick={() => setEmbed("mapillary")}>
      {st("Otevřít panorama", "Open panorama")}
    </Button>
  );
  const info = (
    <div className="info-body detail-curated" data-testid="info-panel-body">
      {place.description && <p className="detail-description">{place.description}</p>}
      <PracticalPanel place={place} refs={refs} />
      <ProviderFields fields={fields} />
      <div className="detail-open-in">
        <span>{st("Otevřít v", "Open in")}</span>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
        >
          Google Maps
        </a>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://mapy.com/zakladni?x=${place.lng}&y=${place.lat}&z=16`}
        >
          Mapy.com
        </a>
        <button onClick={() => setEmbed("mapillary")}>Mapillary</button>
        {panelFor("wikipedia") && <button onClick={() => setEmbed("wikipedia")}>Wiki</button>}
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://www.geocaching.com/play/map?lat=${place.lat}&lng=${place.lng}&zoom=14`}
        >
          Geocaching
        </a>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://www.komoot.com/discover/${place.lat},${place.lng}`}
        >
          Komoot
        </a>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(place.name)}`}
        >
          Booking
        </a>
      </div>
      <DetailDisclosure id="panorama" title={st("Panorama", "Panorama")}>
        {panorama}
      </DetailDisclosure>
      <DetailDisclosure id="statistics" title={st("Statistiky", "Statistics")} initialOpen>
        <LocalStatistics place={place} />
      </DetailDisclosure>
      {panelFor("pocasi") && (
        <DetailDisclosure id="weather" title={st("Počasí", "Weather")} initialOpen>
          {renderPanel("pocasi")}
        </DetailDisclosure>
      )}
      <DetailDisclosure id="events" title={st("Nadcházející události", "Upcoming events")}>
        <NearbyMapPlaces place={place} events />
      </DetailDisclosure>
      <DetailDisclosure id="places" title={st("Seznam míst", "List of places")}>
        <NearbyMapPlaces place={place} />
      </DetailDisclosure>
      {panelFor("geologie") && (
        <DetailDisclosure id="geology" title={st("Geologie", "Geology")}>
          {renderPanel("geologie")}
        </DetailDisclosure>
      )}
      <DetailDisclosure id="notes" title={st("Vaše poznámky", "Your notes")}>
        {privateContent}
      </DetailDisclosure>
      <DetailDisclosure id="sources" title={st("Zdroje", "Sources")}>
        <div data-testid="provenance">
          {sources.map((source) => (
            <p key={source.source}>
              {PLACE_SOURCE_BY_ID[source.source]?.label ?? source.source} · {source.refreshedAt}
            </p>
          ))}
        </div>
        {caveats.map((c) => (
          <p className="meta" key={c}>
            {c}
          </p>
        ))}
        {panels
          .filter(
            (p) => !["prakticke", "pocasi", "geologie", "mapillary", "prehled"].includes(p.id)
          )
          .map((p) => (
            <Button
              variant="text"
              key={p.id}
              testId={`detail-source-open-${p.id}`}
              onClick={() => setEmbed(p.id)}
            >
              {presentationLabel("panel", p.id, p.label)}
            </Button>
          ))}
      </DetailDisclosure>
      {summary}
    </div>
  );
  return (
    <div className="info-engine detail-tabbed" data-detail-surface="v2">
      <Tabs
        testId="place-detail-tabs"
        value={tab}
        onValueChange={changeTab}
        tabs={[
          { id: "info", label: st("INFO", "INFO"), keepMounted: true, children: info },
          {
            id: "media",
            label: st("MÉDIA", "MEDIA"),
            keepMounted: true,
            children: visited.has("media") ? (
              <div className="info-body detail-media">
                <div className="detail-panorama-preview">{panorama}</div>
                {media.length ? (
                  <>
                    <MediaGallery media={media} />
                    <DetailDownloads media={media} place={place} />
                  </>
                ) : (
                  <p>
                    {st(
                      "Pro toto místo zatím nemáme dostupná média.",
                      "No media available for this place yet."
                    )}
                  </p>
                )}
              </div>
            ) : null
          },
          {
            id: "community",
            label: st("KOMUNITA", "COMMUNITY"),
            keepMounted: true,
            children: visited.has("community") ? (
              <div className="info-body">
                {social}
                {panelFor("foursquare") && (
                  <DetailDisclosure id="provider-reviews" title="Foursquare">
                    {renderPanel("foursquare")}
                  </DetailDisclosure>
                )}
              </div>
            ) : null
          }
        ]}
      />
      <Dialog
        open={Boolean(selectedEmbed)}
        onOpenChange={(open) => {
          if (!open) setEmbed(null);
        }}
        title={
          selectedEmbed ? presentationLabel("panel", selectedEmbed.id, selectedEmbed.label) : ""
        }
        size="lg"
        testId="detail-embed-dialog"
      >
        {selectedEmbed && (
          <PanelGroup key={selectedEmbed.id} panels={[selectedEmbed]} place={place} refs={refs} />
        )}
      </Dialog>
    </div>
  );
}

/** Manifest/registry-driven unified place detail. The layer decides provider fields/actions; the
 * host owns the five stable surfaces and the source-content boundaries. */
export function InfoEngine(props: InfoEngineProps) {
  return DETAIL_SURFACE_V2_ENABLED ? (
    <UnifiedInfoEngine {...props} />
  ) : (
    <LegacyInfoEngine {...props} />
  );
}
