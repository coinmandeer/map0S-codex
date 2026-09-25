import {
  BASEMAPS,
  CATALOG_GROUPS,
  type MapContextSnapshot,
  type MapScenePatch
} from "@mapos/layer-sdk";
import type { AiChatAnswer } from "./chatService.js";

/** Compile grounded catalogue selections into declarative changes; no model URLs or expressions. */
export function answerScenePatch(
  answer: AiChatAnswer,
  snapshot: MapContextSnapshot | undefined,
  conversationId: string,
  runId: string,
  revision: number,
  question: string
): MapScenePatch | null {
  const cards = answer.cards.filter((c) => c.type === "layer");
  if (!cards.length) return null;
  const catalog = CATALOG_GROUPS.flatMap((group) => group.items);
  const layers: MapScenePatch["layers"] = {};
  let basemapId: string | undefined;
  for (const card of cards)
    for (const id of card.layerIds) {
      const basemap = BASEMAPS.find((b) => b.id === id);
      if (basemap) {
        basemapId = id;
        continue;
      }
      const direct = catalog.find((item) => item.id === id);
      const source = catalog.find((item) => item.layer === id);
      const item =
        direct ?? (source ? { ...source, facet: undefined, values: undefined } : undefined);
      if (!item) continue;
      const old = snapshot?.layers[item.layer];
      const filters = { ...(layers[item.layer]?.filters ?? old?.filters ?? {}), ...card.filters };
      if (item.facet)
        filters[item.facet] = [
          ...new Set([
            ...((layers[item.layer]?.filters[item.facet] as string[] | undefined) ?? []),
            ...(item.values ?? [])
          ])
        ];
      layers[item.layer] = {
        visible: true,
        opacity: card.opacityByLayer?.[id] ?? old?.opacity ?? 0.75,
        filters
      };
    }
  if (!Object.keys(layers).length && !basemapId) return null;
  for (const [id, state] of Object.entries(snapshot?.layers ?? {}))
    if (state.visible && !layers[id]) layers[id] = { ...state, visible: false };
  if (!basemapId && /obloh|hvezd|hvězd|stargaz|night sky/iu.test(question))
    basemapId = "carto-dark";
  return {
    schema: "mapos.scene-patch",
    schemaVersion: "1.0.0",
    id: `${runId}:scene`,
    runId,
    conversationId,
    revision,
    explanation: cards
      .map((c) => c.title)
      .join(" · ")
      .slice(0, 500),
    layers,
    ...([...cards].reverse().find((c) => c.time !== undefined)?.time !== undefined
      ? { time: [...cards].reverse().find((c) => c.time !== undefined)!.time }
      : {}),
    ...(basemapId ? { basemapId } : {})
  };
}
