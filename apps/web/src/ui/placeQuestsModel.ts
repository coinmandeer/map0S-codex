import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";

/** A quest bound to a place or area (§2.11, §10). The distance is what tells the reader whether
 *  this is something they can do now or a reason to come back. */
export interface PlaceQuest {
  id: string;
  title: string;
  description: string;
  rewardPoints: number;
  lng: number;
  lat: number;
  sourceId?: string;
  sourceLabel?: string;
  externalUrl?: string;
  anchorName?: string;
  distanceM: number;
}

export type PlaceQuestsState =
  { status: "loading" } | { status: "error" } | { status: "ready"; quests: PlaceQuest[] };

/** Quests near a coordinate. Kept separate from reviews/comments so a quest outage cannot take
 *  the community tab with it, and vice versa. */
export function usePlaceQuests(lng: number, lat: number): PlaceQuestsState {
  const [state, setState] = useState<PlaceQuestsState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void apiGet<{ quests: PlaceQuest[] }>("/game/quests/near", {
      signal: controller.signal,
      query: { lng, lat, radiusKm: 3 }
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({
          status: "ready",
          quests: Array.isArray(data.quests) ? data.quests : []
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [lng, lat]);
  return state;
}
