import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

/**
 * Sky darkness from satellite night lights.
 *
 * The overlay is the flip side of a light-pollution map: bright pixels are places that emit
 * light (and therefore have little darkness left), black pixels are where the night sky is still
 * genuinely dark. NASA GIBS serves the VIIRS "Black Marble" composite as keyless Web-Mercator
 * tiles, so a fresh clone gets it without a key. Above the source's own maximum zoom MapLibre
 * overzooms the same pixels rather than fetching a pyramid that does not exist.
 */
registerLayer({
  kind: "raster",
  manifest: {
    id: "dark-sky",
    name: "Noční světla (2016)",
    icon: "🌌",
    color: "#1e1b4b",
    description:
      "Historický kompozit nočních světel NASA VIIRS Black Marble z roku 2016. Světlé plochy zobrazují světelné emise; nejde o aktuální měření světelného znečištění ani záruku tmavé oblohy.",
    category: "environment"
  },
  defaultOpacity: 0.85,
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      // GIBS serves {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x}.
      tiles: [
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"
      ],
      maxzoom: 8,
      attribution: '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> · VIIRS Black Marble'
    }),
  attribution: [
    {
      label: "NASA GIBS · VIIRS Black Marble",
      url: "https://earthdata.nasa.gov/gibs",
      license: "NASA open data"
    }
  ]
});
