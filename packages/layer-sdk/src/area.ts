import type { Bbox } from "./types.js";
export interface AreaSelection {
  id: string;
  revision: string;
  name: string;
  level: "country" | "adm1" | "adm2" | "lau";
  country: string;
  source: string;
  code: string;
  bbox: Bbox;
}
export function boundaryAreaId(
  source: string,
  country: string,
  level: string,
  code: string
): string {
  return JSON.stringify([source, country, level, code]);
}
