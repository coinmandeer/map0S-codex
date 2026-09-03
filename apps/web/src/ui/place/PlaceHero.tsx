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
  onPhotoIndexChange
}: {
  place: Place;
  media: readonly DetailMediaAsset[];
  photoIndex: number;
  onPhotoIndexChange: (index: number) => void;
}) {
  const style = PIN_STYLES[place.category];
  const categoryLabel = style?.label ?? place.category;
  const photos = media.filter((asset) => asset.kind === "photo");
  const hero = photos[photoIndex] ?? photos[0] ?? null;

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
    <header className="place-hero place-hero-photo" data-testid="place-hero">
      <img src={hero.url} alt={hero.caption ?? place.name} />
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
      <p className="place-hero-credit">
        {hero.attribution} · {hero.license}
      </p>
      {photos.length > 1 && (
        <div className="place-hero-gallery">
          {photos.map((asset, index) => (
            <IconButton
              key={asset.id}
              icon="image"
              label={`Fotografie ${index + 1}`}
              size="sm"
              active={index === photoIndex}
              onClick={() => onPhotoIndexChange(index)}
            />
          ))}
        </div>
      )}
    </header>
  );
}
