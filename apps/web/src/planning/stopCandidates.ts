/**
 * Places for a stop input's open question (§4.5).
 *
 * The assistant's chat endpoint is asked and only its places card is kept: titles, coordinates and
 * the source each one came from. A candidate without coordinates is dropped rather than guessed,
 * and a candidate without a source cannot be shown, because the pin has to be checkable.
 */

import { apiPostEventStream } from "../lib/api";
import type { AiStopResult } from "../ui/planning/types";

interface ChatPlace {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  distanceMeters?: number;
  sourceId: string;
}

interface ChatAnswer {
  text: string;
  cards: Array<
    | { type: "places"; title: string; places: ChatPlace[]; layerIds: string[] }
    | { type: string }
  >;
  sources: Array<{ sourceId: string; label: string; url?: string }>;
}

type ChatEvent =
  | { type: "done"; answer: ChatAnswer }
  | { type: "error"; message: string }
  | { type: string };

export interface StopCandidateAnswer {
  text: string;
  results: AiStopResult[];
  layerIds: string[];
}

export async function askForStopCandidates(input: {
  prompt: string;
  longitude: number;
  latitude: number;
  zoom: number;
  activeLayerIds: string[];
  planId: string;
  externalModel: boolean;
  signal?: AbortSignal;
}): Promise<StopCandidateAnswer> {
  let answer: ChatAnswer | null = null;
  let failure: string | null = null;

  await apiPostEventStream<ChatEvent>(
    "/v2/ai/chat",
    {
      message: input.prompt,
      context: {
        mapCenter: { longitude: input.longitude, latitude: input.latitude },
        zoom: input.zoom,
        activeLayerIds: input.activeLayerIds,
        mode: "planning",
        planId: input.planId
      },
      consent: { externalModel: input.externalModel, preciseLocation: false }
    },
    (event) => {
      if (event.type === "done") answer = (event as { answer: ChatAnswer }).answer;
      if (event.type === "error") failure = (event as { message: string }).message;
    },
    { auth: true, ...(input.signal ? { signal: input.signal } : {}) }
  );

  if (failure) throw new Error(failure);
  if (!answer) throw new Error("AI odpověď nedorazila");

  const settled: ChatAnswer = answer;
  const labels = new Map(settled.sources.map((source) => [source.sourceId, source]));
  const card = settled.cards.find(
    (entry): entry is Extract<ChatAnswer["cards"][number], { type: "places" }> =>
      entry.type === "places"
  );
  const results: AiStopResult[] = (card?.places ?? [])
    .filter((place) => Number.isFinite(place.longitude) && Number.isFinite(place.latitude))
    .slice(0, 5)
    .map((place) => {
      const source = labels.get(place.sourceId);
      return {
        id: place.id,
        layerId: place.layerId,
        title: place.title,
        longitude: place.longitude,
        latitude: place.latitude,
        distanceMeters: place.distanceMeters ?? 0,
        source: {
          sourceId: place.sourceId,
          label: source?.label ?? place.sourceId,
          ...(source?.url ? { url: source.url } : {})
        }
      };
    });

  return { text: settled.text, results, layerIds: card?.layerIds ?? [] };
}
