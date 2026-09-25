import { emit } from "../../lib/events";
import { getMapStore } from "../../store/mapStore";
import { activateStatistic, deactivateStatistic } from "../../statistics/explorerStore";
import type { AiStatisticCard } from "./chatTypes";

export function validStatisticCard(card: AiStatisticCard): boolean {
  return (
    typeof card.available === "boolean" &&
    typeof card.title === "string" &&
    typeof card.country === "string" &&
    /^[A-Z]{2}$/.test(card.country) &&
    typeof card.themeId === "string" &&
    /^[a-z][a-z0-9-]{1,40}$/.test(card.themeId) &&
    /^(latest|[0-9]{4})$/.test(card.period) &&
    Array.isArray(card.bbox) &&
    card.bbox.length === 4 &&
    card.bbox.every(Number.isFinite) &&
    card.bbox[0] >= -180 &&
    card.bbox[2] <= 180 &&
    card.bbox[1] >= -90 &&
    card.bbox[3] <= 90 &&
    card.bbox[0] < card.bbox[2] &&
    card.bbox[1] < card.bbox[3] &&
    Array.isArray(card.excludedDatasetIds) &&
    card.excludedDatasetIds.length <= 50 &&
    card.excludedDatasetIds.every((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id))
  );
}
/** A server-grounded statistical question requests this map view; rendering text never calls it. */
export function showStatisticAnswer(
  card: AiStatisticCard,
  fitCamera = true,
  signal?: AbortSignal,
  onApplied?: () => void
) {
  if (!validStatisticCard(card)) return;
  // An old municipality filter must not silently clip a question about a different country.
  getMapStore().setAreaSelection(null);
  if (fitCamera) emit("fit-bounds", { bbox: card.bbox });
  if (!card.available) deactivateStatistic();
  if (card.available)
    return activateStatistic(card.themeId, card.period, card.excludedDatasetIds, {
      signal,
      reveal: false,
      fitCoverage: false,
      onApplied
    });
}
