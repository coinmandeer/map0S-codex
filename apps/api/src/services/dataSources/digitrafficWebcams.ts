import type { GeoFeature } from "@mapos/layer-sdk";
import { point } from "./types.js";
interface Station {
  geometry?: { type: string; coordinates: number[] };
  properties?: {
    id: string;
    name?: string;
    collectionStatus?: string;
    state?: string | null;
    dataUpdatedTime?: string;
    presets?: Array<{ id: string; inCollection?: boolean }>;
  };
}
export function mapDigitrafficWebcams(stations: Station[]): GeoFeature[] {
  return stations.flatMap((station) => {
    const p = station.properties,
      c = station.geometry?.coordinates;
    if (
      !p ||
      !/^C\d{5}$/.test(p.id) ||
      station.geometry?.type !== "Point" ||
      !c ||
      !Number.isFinite(c[0]) ||
      !Number.isFinite(c[1]) ||
      Math.abs(c[0]!) > 180 ||
      Math.abs(c[1]!) > 90 ||
      p.collectionStatus !== "GATHERING" ||
      (p.state && p.state !== "OK")
    )
      return [];
    const preset = p.presets?.find((x) => x.inCollection && /^C\d{7}$/.test(x.id));
    if (!preset) return [];
    return [
      point(`digitraffic-webcam:${p.id}`, p.name ?? p.id, c[0]!, c[1]!, "webcams", {
        category: "webcam",
        cameraProvider: "digitraffic",
        catalogueSource: "Fintraffic Digitraffic",
        operator: "Fintraffic",
        website: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
        sourceUrl: `https://tie.digitraffic.fi/api/weathercam/v1/stations/${p.id}`,
        dataUpdatedAt: p.dataUpdatedTime,
        cameraAccess: "Silniční snímek; katalog sbírá data, aktuální dostupnost obrazu neověřena",
        mediaRights: "Fintraffic / digitraffic.fi · CC BY 4.0; zachovat atribuci a čas ve snímku",
        metadataLicense: "CC-BY-4.0",
        attribution: "Fintraffic / digitraffic.fi · CC BY 4.0 · vybraný první aktivní pohled",
        locationMeaning: "Stanoviště kamery; datum aktualizace metadat není čas pořízení snímku"
      })
    ];
  });
}
