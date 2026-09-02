import assert from "node:assert/strict";
import test from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { buildPlanItinerary } from "./planItinerary.js";

test("itinerary keeps ordered stops, exact coordinates and honest unresolved segments", () => {
  const plan = planV1ToV2(
    {
      id: "copy-plan",
      name: "Cesta na jih",
      departureAt: "2026-09-02T00:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "Praha", lng: 14.42, lat: 50.08, dwellMinutes: 0 },
        { id: "b", name: "Tábor", lng: 14.6578, lat: 49.4144, dwellMinutes: 30 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-02T00:00:00.000Z" }
  );
  const text = buildPlanItinerary(plan);
  assert.match(text, /^Cesta na jih/);
  assert.match(text, /1\. Praha\n {3}GPS: 50\.08000, 14\.42000/);
  assert.match(text, /úsek čeká na výpočet/);
  assert.match(text, /2\. Tábor\n {3}GPS: 49\.41440, 14\.65780 · pobyt 30 min/);
  assert.match(text, /Externí navigace může trasu přepočítat odlišně/);
});
