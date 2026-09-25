import { t } from "../../i18n";
import { presentationLabel } from "../../i18n/presentation";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { DetailMediaAsset, Place } from "@mapos/layer-sdk";
import { PIN_STYLES } from "../presets";
import { poiCategoryIcon } from "../layers/layerPresentation";
import { Chip, Icon, IconButton } from "../kit";

/** Top of the place detail (§4.10).
 *
 *  With a photo it is a 16:9 image carrying the name over a gradient; without one there is no
 *  hero at all — an empty gradient with a placeholder glyph looks like a failed image, so the
 *  name simply sits next to a category icon instead.
 */
export function PlaceHero({
  place,
  media,
  photoIndex,
  onPhotoIndexChange,
  showIdentity = true
}: {
  showIdentity?: boolean;
  place: Place;
  media: readonly DetailMediaAsset[];
  photoIndex: number;
  onPhotoIndexChange: (index: number) => void;
}) {
  const style = PIN_STYLES[place.category];
  const categoryLabel = presentationLabel(
    "category",
    place.category,
    style?.label ?? place.category
  );
  const photos = media.filter((asset) => asset.kind === "photo");
  const hero = photos[photoIndex] ?? photos[0] ?? null;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!hero && !showIdentity) return null;
  if (!hero) {
    return (
      <header className="place-hero place-hero-plain" data-testid="place-hero">
        <span className="place-hero-icon" aria-hidden="true">
          <Icon name={poiCategoryIcon(place.category)} size={24} />
        </span>
        <div className="place-hero-copy">
          <h3>{place.name}</h3>
          <p className="place-hero-meta">
            {categoryLabel}
            {place.rating != null ? ` · ★ ${place.rating.toFixed(1)}` : ""}
          </p>
        </div>
      </header>
    );
  }

  return (
    <Dialog.Root open={lightboxOpen} onOpenChange={setLightboxOpen}>
      <header className="place-hero place-hero-photo" data-testid="place-hero">
        <Dialog.Trigger
          className="place-hero-image-button"
          aria-label={t("polish.photoOpen", { count: photoIndex + 1 })}
        >
          <img src={hero.url} alt={hero.caption ?? place.name} />
          <span className="place-hero-zoom-hint" aria-hidden="true">
            <Icon name="fullscreen" size={18} />
          </span>
        </Dialog.Trigger>
        {/* Over-photo arrows change the photograph only. Moving between places stays on the
          stepper in the header, so the two navigations never look like the same control. */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              className="place-hero-nav place-hero-prev"
              aria-label={t("polish.photoPrev")}
              data-testid="place-hero-prev"
              onClick={() => onPhotoIndexChange((photoIndex - 1 + photos.length) % photos.length)}
            >
              <Icon name="chevron_left" size={24} />
            </button>
            <button
              type="button"
              className="place-hero-nav place-hero-next"
              aria-label={t("polish.photoNext")}
              data-testid="place-hero-next"
              onClick={() => onPhotoIndexChange((photoIndex + 1) % photos.length)}
            >
              <Icon name="chevron_right" size={24} />
            </button>
          </>
        )}
        {showIdentity && (
          <div className="place-hero-overlay">
            <h3>{place.name}</h3>
            <div className="place-hero-chips">
              <Chip label={categoryLabel} icon={poiCategoryIcon(place.category)} />
              {place.rating != null && (
                <Chip
                  label={`${place.rating.toFixed(1)}${place.ratingCount ? ` (${place.ratingCount})` : ""}`}
                  icon="star"
                />
              )}
            </div>
          </div>
        )}
        <p className="place-hero-credit">
          {hero.attribution} · {hero.license}
        </p>
        {photos.length > 1 && (
          <div className="place-hero-gallery">
            {photos.map((asset, index) => (
              <IconButton
                key={asset.id}
                icon="image"
                label={t("polish.photo", { count: index + 1 })}
                size="sm"
                active={index === photoIndex}
                onClick={() => onPhotoIndexChange(index)}
              />
            ))}
          </div>
        )}
        <Dialog.Portal>
          <Dialog.Popup
            className="media-lightbox"
            aria-label={`Fotografie místa ${place.name}`}
            data-testid="media-lightbox"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                const delta = event.key === "ArrowLeft" ? -1 : 1;
                onPhotoIndexChange((photoIndex + delta + photos.length) % photos.length);
              }
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setLightboxOpen(false);
            }}
          >
            <Dialog.Close
              className="media-lightbox-close"
              aria-label={t("polish.photoClose")}
              onClick={() => setLightboxOpen(false)}
            >
              <Icon name="close" size={24} />
            </Dialog.Close>
            {photos.length > 1 && (
              <button
                type="button"
                className="media-lightbox-nav media-lightbox-prev"
                aria-label="Předchozí fotografie"
                onClick={(event) => {
                  event.stopPropagation();
                  onPhotoIndexChange((photoIndex - 1 + photos.length) % photos.length);
                }}
              >
                <Icon name="chevron_left" size={32} />
              </button>
            )}
            <figure className="media-lightbox-figure">
              <img src={hero.url} alt={hero.caption ?? place.name} />
              <figcaption>
                <span>{hero.caption ?? place.name}</span>
                <small>
                  {hero.attribution} · {hero.license} · {photoIndex + 1}/{photos.length}
                </small>
              </figcaption>
            </figure>
            {photos.length > 1 && (
              <button
                type="button"
                className="media-lightbox-nav media-lightbox-next"
                aria-label="Další fotografie"
                onClick={(event) => {
                  event.stopPropagation();
                  onPhotoIndexChange((photoIndex + 1) % photos.length);
                }}
              >
                <Icon name="chevron_right" size={32} />
              </button>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </header>
    </Dialog.Root>
  );
}
