import { useState, type CSSProperties } from "react";
import type { BasemapDefinition } from "@mapos/layer-sdk";
import { thumbHue, thumbKind, thumbSource } from "./basemapPresentation";

/** The 96×56 illustration on a basemap card.
 *
 *  Prefers the rendered screenshot from `public/basemaps/`, because nothing describes a map
 *  style like the style itself. When that file is missing — a fresh clone, or a keyed provider
 *  whose sample we may not republish — it draws a schematic map instead of an empty box, so
 *  the card never looks broken.
 */
export function BasemapThumb({ basemap }: { basemap: BasemapDefinition }) {
  const [rendered, setRendered] = useState(true);
  const style = { "--basemap-thumb-hue": thumbHue(basemap.id) } as CSSProperties;

  return (
    <span
      className="basemap-preview"
      data-preview-kind={thumbKind(basemap)}
      style={style}
      aria-hidden
    >
      {rendered ? (
        <img
          className="basemap-preview-image"
          src={thumbSource(basemap)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setRendered(false)}
        />
      ) : (
        <>
          <span className="basemap-preview-water" />
          <span className="basemap-preview-road road-primary" />
          <span className="basemap-preview-road road-secondary" />
        </>
      )}
    </span>
  );
}
