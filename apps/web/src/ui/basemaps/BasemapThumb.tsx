import { useEffect, useState, type CSSProperties } from "react";
import type { BasemapDefinition } from "@mapos/layer-sdk";
import { thumbHue, thumbKind, thumbSource } from "./basemapPresentation";

/** Real Berlin previews; unavailable providers have an explicit fallback. */
export function BasemapThumb({ basemap }: { basemap: BasemapDefinition }) {
  const [rendered, setRendered] = useState(true);
  useEffect(() => setRendered(true), [basemap.id]);
  const style = { "--basemap-thumb-hue": thumbHue(basemap.id) } as CSSProperties;

  return (
    <span
      className="basemap-preview"
      data-preview-kind={thumbKind(basemap)}
      style={style}
      title={
        rendered
          ? basemap.id === "cuzk-ortofoto"
            ? "Česko · skutečný náhled podkladu © ČÚZK"
            : "Berlín · skutečný náhled podkladu"
          : "Náhled není dostupný"
      }
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
          <small>Náhled není dostupný</small>
        </>
      )}
      {rendered && basemap.proxy?.provider === "mapy" && (
        <small
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            background: "#fff",
            color: "#222",
            fontSize: 9,
            padding: "1px 3px"
          }}
        >
          © Mapy.com
        </small>
      )}
    </span>
  );
}
