import test from "node:test";
import assert from "node:assert/strict";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { editDraftInstruction } from "./draftEdits.js";
const draft = () =>
  planV1ToV2({
    id: "trip",
    name: "Výlet",
    createdAt: "2026-09-24T00:00:00Z",
    departureAt: "2026-09-24T00:00:00Z",
    visibility: "private",
    variant: "fast",
    vehicle: { profile: "foot" },
    stops: [
      { id: "a", name: "Start", lng: 14, lat: 50, dwellMinutes: 15 },
      { id: "b", name: "Kavárna", lng: 14.01, lat: 50, dwellMinutes: 15 },
      { id: "c", name: "Vyhlídka", lng: 14.02, lat: 50, dwellMinutes: 15 },
      { id: "d", name: "Cíl", lng: 14.03, lat: 50, dwellMinutes: 15 }
    ]
  });
test("draft edits preserve fixed endpoints, locks and source document", () => {
  const original = draft();
  assert.equal(editDraftInstruction(original, "odeber Start")?.plan, undefined);
  const locked = structuredClone(original);
  locked.stops[1]!.locked = true;
  assert.equal(editDraftInstruction(locked, "odeber Kavárna")?.plan, undefined);
  const edited = editDraftInstruction(original, "odeber Kavárna")!.plan!;
  assert.deepEqual(
    edited.stops.map((s) => s.id),
    ["a", "c", "d"]
  );
  assert.equal(original.stops.length, 4);
  assert.equal(edited.revision, original.revision + 1);
  assert.equal(editDraftInstruction(original, "změň na kolo")!.plan!.routePolicy.profile, "bike");
  assert.equal(
    editDraftInstruction(original, "přejmenuj plán na Večerní výlet")!.plan!.name,
    "Večerní výlet"
  );
  assert.deepEqual(
    editDraftInstruction(original, "přesuň Kavárna na pozici 3")!.plan!.stops.map((s) => s.id),
    ["a", "c", "b", "d"]
  );
});

test("model batches are atomic and preserve fixed endpoints and locked ordering", async () => {
  const { editDraftFromModel } = await import("./draftEdits.js");
  const original = draft();
  const changed = editDraftFromModel(
    original,
    [
      { op: "move-stop", stopId: "b", toIndex: 2 },
      { op: "rename-plan", name: "Nový návrh" }
    ],
    []
  );
  assert.deepEqual(
    changed.stops.map((s) => s.id),
    ["a", "c", "b", "d"]
  );
  assert.equal(changed.revision, original.revision + 1);
  assert.equal(changed.routePolicy.profile, original.routePolicy.profile);
  assert.equal(original.name, "Výlet");
  assert.throws(() =>
    editDraftFromModel(
      original,
      [
        { op: "rename-plan", name: "Invalid" },
        { op: "remove-stop", stopId: "a" }
      ],
      []
    )
  );
  assert.equal(original.name, "Výlet");
  const locked = structuredClone(original);
  locked.stops[2]!.locked = true;
  assert.throws(() =>
    editDraftFromModel(locked, [{ op: "move-stop", stopId: "b", toIndex: 2 }], [])
  );
  assert.throws(() =>
    editDraftFromModel(original, [{ op: "add-stop", placeId: "invented", atIndex: 2 }], [])
  );
  assert.throws(() =>
    editDraftFromModel(original, [{ op: "move-stop", stopId: "b", toIndex: 0 }], [])
  );
});
