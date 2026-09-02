import { ClientError } from "../utils/clientError.js";
import { getRegion } from "./regionService.js";

function fallbackText(name: string): string {
  return `${name} je území plné míst k objevování. Přibliž mapu, zapni kategorie ve Vrstvách a prohlédni si památky, přírodu i příspěvky lidí.`;
}

export async function getRegionSummary(
  regionId: string
): Promise<{ text: string; model: string | null; cached: boolean }> {
  const region = getRegion(regionId);
  if (!region) throw new ClientError("Region not found", 404);

  // The former implementation sent only an attacker-selected region name to a model and cached
  // the resulting unsupported claims forever. Until a public, cited context collector exists,
  // the honest result is a deterministic navigation hint. It is intentionally not stored as AI.
  return { text: fallbackText(region.name), model: null, cached: false };
}
