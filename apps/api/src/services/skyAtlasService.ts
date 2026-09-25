import { fromFile } from "geotiff";
import { config } from "../config.js";
import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { point } from "./dataSources/types.js";

export interface SkyBrightness {
  value: number;
  unit: "mcd/m²";
  modelYear: 2015;
  component: "artificial-zenith";
  sourceId: "falchi-world-atlas";
}
export const skyAtlasSource = {
  sourceId: "falchi-world-atlas",
  label: "Falchi et al. — World Atlas 2015, historický model; CC BY-NC 4.0",
  url: "https://doi.org/10.5880/GFZ.1.4.2016.001"
};

/** Bounded preview of native pixels. These samples are not area averages or current readings. */
export async function skyAtlasGrid(
  bbox: Bbox,
  signal?: AbortSignal,
  file = config.skyAtlasPath
): Promise<GeoFeature[]> {
  if (!file) throw new Error("Numerický atlas není na serveru načtený");
  const tiff = await fromFile(file, signal);
  try {
    const image = await tiff.getImage();
    const keys = image.getGeoKeys();
    if (
      keys?.GeographicTypeGeoKey !== 4326 ||
      keys.ProjectedCSTypeGeoKey ||
      image.getSamplesPerPixel() !== 1 ||
      keys.GTRasterTypeGeoKey === 2
    )
      throw new Error("Grid requires a WGS84 PixelIsArea single-band atlas");
    const [x0, y0] = image.getOrigin(),
      [dx, dy] = image.getResolution();
    if (!(dx! > 0 && dy! < 0)) throw new Error("Unsupported atlas orientation");
    const x = Math.max(0, Math.floor((bbox[0] - x0!) / dx!));
    const y = Math.max(0, Math.floor((bbox[3] - y0!) / dy!));
    const right = Math.min(image.getWidth(), Math.ceil((bbox[2] - x0!) / dx!));
    const bottom = Math.min(image.getHeight(), Math.ceil((bbox[1] - y0!) / dy!));
    if (right <= x || bottom <= y) return [];
    if (
      (right - x) * (bottom - y) > 4_000_000 ||
      image.getTileWidth() * image.getTileHeight() * image.getBytesPerPixel() > 8 * 1024 * 1024
    )
      throw new Error("Přibližte mapu pro načtení numerického atlasu");
    const raster = await image.readRasters({
      window: [x, y, right, bottom],
      samples: [0],
      interleave: true,
      signal
    });
    signal?.throwIfAborted();
    const stride = Math.max(1, Math.ceil(Math.sqrt(((right - x) * (bottom - y)) / 1024)));
    const features: GeoFeature[] = [];
    for (let row = y; row < bottom; row += stride)
      for (let col = x; col < right; col += stride) {
        const value = Number(raster[(row - y) * (right - x) + col - x]);
        if (!Number.isFinite(value) || value < 0 || value === image.getGDALNoData()) continue;
        const west = x0! + col * dx!,
          east = x0! + Math.min(right, col + stride) * dx!;
        const north = y0! + row * dy!,
          south = y0! + Math.min(bottom, row + stride) * dy!;
        features.push(
          point(
            `sky-atlas:${col}:${row}:${stride}`,
            `Umělý zenitový jas · ${value.toPrecision(3)} mcd/m²`,
            (west + east) / 2,
            (south + north) / 2,
            "sky-brightness",
            {
              brightness: value,
              unit: "mcd/m²",
              modelYear: 2015,
              cellBounds: [west, south, east, north],
              sourceId: skyAtlasSource.sourceId,
              source: skyAtlasSource.label,
              website: skyAtlasSource.url,
              description: `Historický model 2015, pouze umělá složka. ${stride > 1 ? "Řídký vzorek nativních pixelů; není průměrem buňky." : "Nativní pixel atlasu."} Bez přirozeného pozadí, počasí a Měsíce.`
            }
          )
        );
      }
    return features;
  } finally {
    await tiff.close();
  }
}

/** Only an operator-staged, unscaled WGS84 numerical atlas is accepted. No remote URLs. */
export async function skyBrightnessAt(
  longitude: number,
  latitude: number,
  signal?: AbortSignal,
  file = config.skyAtlasPath
): Promise<SkyBrightness | null> {
  if (!file) return null;
  if (
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90
  )
    throw new Error("Invalid atlas point");
  signal?.throwIfAborted();
  const tiff = await fromFile(file, signal);
  try {
    const image = await tiff.getImage();
    const keys = image.getGeoKeys();
    if (
      keys?.GeographicTypeGeoKey !== 4326 ||
      keys.ProjectedCSTypeGeoKey ||
      image.getSamplesPerPixel() !== 1
    )
      throw new Error("Atlas must be a single-band WGS84 numerical raster");
    const [west, south, east, north] = image.getBoundingBox();
    if (longitude < west! || longitude >= east! || latitude <= south! || latitude > north!)
      return null;
    const [x0, y0] = image.getOrigin(),
      [dx, dy] = image.getResolution();
    if (!(dx! > 0 && dy! < 0)) throw new Error("Unsupported atlas raster orientation");
    const pointPixel = keys.GTRasterTypeGeoKey === 2;
    const x = Math.floor((longitude - x0!) / dx! + (pointPixel ? 0.5 : 0));
    const y = Math.floor((latitude - y0!) / dy! + (pointPixel ? 0.5 : 0));
    if (x < 0 || y < 0 || x >= image.getWidth() || y >= image.getHeight()) return null;
    if (image.getTileWidth() * image.getTileHeight() * image.getBytesPerPixel() > 8 * 1024 * 1024)
      throw new Error("Atlas needs bounded tiles or strips before serving");
    const raster = await image.readRasters({
      window: [x, y, x + 1, y + 1],
      samples: [0],
      interleave: true,
      signal
    });
    signal?.throwIfAborted();
    const value = Number(raster[0]);
    if (!Number.isFinite(value) || value < 0 || value === image.getGDALNoData()) return null;
    return {
      value,
      unit: "mcd/m²",
      modelYear: 2015,
      component: "artificial-zenith",
      sourceId: "falchi-world-atlas"
    };
  } finally {
    await tiff.close();
  }
}
