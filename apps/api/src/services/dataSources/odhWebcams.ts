import type { GeoFeature } from "@mapos/layer-sdk";
import { point } from "./types.js";
import { webcamLink } from "./webcams.js";
interface OdhCamera {
  Id?: string;
  Active?: boolean;
  Shortname?: string;
  Webcamname?: Record<string, string>;
  Webcamurl?: string;
  Source?: string;
  LastChange?: string;
  GpsInfo?: Array<{ Gpstype?: string; Latitude?: number; Longitude?: number }>;
  LicenseInfo?: { License?: string; ClosedData?: boolean; Author?: string; LicenseHolder?: string };
}
/** This importer builds an explicitly open catalogue, not a generic rights gate. */
export function mapOdhWebcams(items: OdhCamera[]): {
  features: GeoFeature[];
  unverifiedLicense: number;
  invalid: number;
} {
  const features: GeoFeature[] = [];
  let unverifiedLicense = 0,
    invalid = 0;
  for (const item of items) {
    const license = item.LicenseInfo?.License?.trim();
    if (
      item.LicenseInfo?.ClosedData ||
      !license ||
      !/^(CC0|CC0-1\.0|CC BY 4\.0|CC-BY-4\.0|CC-BY)$/i.test(license)
    ) {
      unverifiedLicense++;
      continue;
    }
    const gps = item.GpsInfo?.find((p) => p.Gpstype === "position");
    const lat = gps?.Latitude,
      lng = gps?.Longitude;
    // In this South Tyrol catalogue zero latitude/longitude are missing-position sentinels.
    const website = webcamLink(item.Webcamurl);
    if (
      !item.Id ||
      !item.Active ||
      !website ||
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat === 0 ||
      lng === 0 ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      invalid++;
      continue;
    }
    features.push(
      point(
        `odh-webcam:${item.Id}`,
        item.Webcamname?.en ?? item.Webcamname?.it ?? item.Shortname ?? "Webkamera",
        lng,
        lat,
        "webcams",
        {
          category: "webcam",
          website,
          operator: item.Source,
          sourceUrl: `https://tourism.api.opendatahub.com/v1/WebcamInfo/${encodeURIComponent(item.Id)}`,
          dataUpdatedAt: item.LastChange,
          catalogueSource: "Open Data Hub",
          cameraAccess: "Odkaz na provozovatele; čas změny katalogu není časem snímku",
          mediaRights: "Licence metadat se nevztahuje automaticky na Webcamurl ani obrazový přenos",
          attribution: `Open Data Hub · ${item.LicenseInfo?.Author || item.Source || "původní poskytovatel"} · ${license}`,
          metadataLicense: license
        }
      )
    );
  }
  return { features, unverifiedLicense, invalid };
}
