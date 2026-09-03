import { useMemo, useState, type ReactNode } from "react";
import {
  isDisplayableDetailMedia,
  type DetailFieldValue,
  type DetailMediaAsset,
  type DetailSurfaceId,
  type Place,
  type PlaceSourceId
} from "@mapos/layer-sdk";
import { DETAIL_SURFACE_V2_ENABLED } from "../lib/featureFlags";
import { Tabs } from "../ui/kit";
import type { IconName } from "../ui/kit/icons";
import { TabBar } from "../ui/primitives";
import { ModuleErrorBoundary } from "../ui/primitives/ModuleErrorBoundary";
import { PIN_STYLES } from "../ui/presets";
import { detailSurfaceOrder, safeExternalUrl } from "./detailModel";
import { infoPanelsFor, type InfoPanel } from "./registry";

interface InfoEngineProps {
  place: Place;
  refs: Partial<Record<PlaceSourceId, string>>;
  /** Rights-complete media only. Raw legacy photo URLs are accepted by the rollback branch. */
  media?: DetailMediaAsset[];
  /** @deprecated Compatibility input used only when VITE_DETAIL_SURFACE_V2 is disabled. */
  photos?: string[];
  providerFields?: DetailFieldValue[];
  /** MapOS-owned community content; provider panels remain separate registry entries. */
  social?: ReactNode;
  /** Owner-only/device-only content, rendered in its own labelled bucket. */
  privateContent?: ReactNode;
}

const SURFACES: Record<DetailSurfaceId, { label: string; icon: IconName }> = {
  overview: { label: "Přehled", icon: "description" },
  media: { label: "Fotky", icon: "photo_library" },
  practical: { label: "Praktické", icon: "schedule" },
  social: { label: "Komentáře", icon: "forum" },
  more: { label: "Více", icon: "more_horiz" }
};

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
  return dates.length ? new Date(dates[0]!).toLocaleString("cs-CZ") : null;
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
  if (typeof value === "boolean") return value ? "Ano" : "Ne";
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
              <span>Údaje poskytovatele</span>
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

function MediaGallery({ media }: { media: DetailMediaAsset[] }) {
  return (
    <div className="detail-media-grid" data-testid="detail-media-gallery">
      {media.map((asset) => (
        <figure key={asset.id} className="detail-media-item">
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

function UnifiedInfoEngine(props: InfoEngineProps) {
  const { place, refs, providerFields = [], social, privateContent, media: rawMedia = [] } = props;
  const panels = useMemo(() => infoPanelsFor({ place, refs }), [place, refs]);
  const media = useMemo(() => rawMedia.filter(isDisplayableDetailMedia), [rawMedia]);
  const [requestedSurface, setRequestedSurface] = useState<DetailSurfaceId>("overview");

  const grouped = useMemo(() => groupBy(panels, (panel) => panel.surface ?? "more"), [panels]);
  const available = useMemo(() => {
    return detailSurfaceOrder({
      media: media.length > 0,
      practical: Boolean(providerFields.length || grouped.get("practical")?.length),
      social: Boolean(social || privateContent || grouped.get("social")?.length),
      more: Boolean(grouped.get("more")?.length)
    });
  }, [grouped, media.length, privateContent, providerFields.length, social]);
  const activeSurface = available.includes(requestedSurface) ? requestedSurface : available[0]!;
  const surfacePanels = grouped.get(activeSurface) ?? [];

  const body = (
    <div className="info-body" data-testid="info-panel-body">
      {activeSurface === "media" && <MediaGallery media={media} />}
      {activeSurface === "practical" && (
        <>
          {surfacePanels.length > 0 && (
            <PanelGroup panels={surfacePanels} place={place} refs={refs} />
          )}
          <ProviderFields fields={providerFields} />
        </>
      )}
      {activeSurface === "social" && (
        <div className="detail-social-groups">
          {surfacePanels.length > 0 && (
            <section className="detail-source-group" data-content-owner="provider">
              <PanelGroup panels={surfacePanels} place={place} refs={refs} sourceLabels />
            </section>
          )}
          {social && (
            <section className="detail-source-group" data-content-owner="mapos">
              {social}
            </section>
          )}
          {privateContent && (
            <section className="detail-source-group" data-content-owner="private">
              <div className="detail-source-label">
                <strong>Soukromé</strong>
                <span>Jen toto zařízení</span>
              </div>
              {privateContent}
            </section>
          )}
        </div>
      )}
      {(activeSurface === "overview" || activeSurface === "more") && (
        <PanelGroup panels={surfacePanels} place={place} refs={refs} />
      )}
    </div>
  );

  return (
    <div className="info-engine" data-detail-surface="v2">
      <Tabs
        testId="detail-section"
        value={activeSurface}
        onValueChange={(id) => setRequestedSurface(id as DetailSurfaceId)}
        tabs={available.map((id) => ({
          id,
          ...SURFACES[id],
          children: id === activeSurface ? body : null
        }))}
      />
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
