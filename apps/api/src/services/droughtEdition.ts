import { flattenWmsLayers, parseWmsCapabilities } from "@mapos/adapter-sdk";
import { fetchText } from "../utils/upstream.js";
const ENDPOINT = "https://drought.emergency.copernicus.eu/api/wms";
/** CDI advertises dekadal data as P10D. Take the explicit published endpoint, never invent a date by stepping 10 days from 2012. */
export function latestDroughtEdition(xml: string) {
  const layer = flattenWmsLayers(parseWmsCapabilities(xml).layers).find((l) => l.id === "cdiad");
  if (!layer?.time || layer.time.units.toLowerCase() !== "iso8601" || !layer.bbox)
    throw new Error("CDI time/coverage missing");
  const candidates = layer.time.values
    .split(",")
    .flatMap((token) => [token.trim().includes("/") ? token.trim().split("/")[1]! : token.trim()])
    .filter((value) => /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(value))
    .filter(
      (value) =>
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value.slice(0, 10)
    )
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const at = candidates.at(-1);
  if (!at) throw new Error("No explicit CDI edition advertised");
  return {
    at,
    layer: "cdiad",
    bbox: layer.bbox,
    endpoint: ENDPOINT,
    legendUrl: `${ENDPOINT}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=cdiad&FORMAT=image/png`,
    coverageNotice:
      "Průhledné části mohou znamenat absenci indikace sucha nebo chybějící data; samotná dlaždice je nerozlišuje."
  };
}
export async function getDroughtEdition(signal?: AbortSignal) {
  const xml = await fetchText(`${ENDPOINT}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`, {
    providerId: "copernicus-drought-capabilities",
    signal,
    ttlMs: 24 * 3600000,
    timeoutMs: 15000,
    maxResponseBytes: 2 * 1024 * 1024,
    acceptedContentTypes: ["text/xml", "application/xml", "application/vnd.ogc.wms_xml"]
  });
  signal?.throwIfAborted();
  return latestDroughtEdition(xml);
}
