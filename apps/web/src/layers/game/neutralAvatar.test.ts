import assert from "node:assert/strict";
import test from "node:test";
import { GAME_FRAME_BUDGETS } from "./gamePerformance";
import { createNeutralAvatar } from "./neutralAvatar";

test("neutral avatar is real procedural 3D geometry within both static budgets", () => {
  const low = createNeutralAvatar("low");
  const balanced = createNeutralAvatar("balanced");

  assert.equal(low.root.type, "Group");
  assert.ok(low.root.children.length > 0);
  assert.equal(low.diagnostics.source, "mapos-procedural");
  assert.ok(low.diagnostics.triangles > 0);
  assert.ok(low.diagnostics.triangles < balanced.diagnostics.triangles);
  assert.ok(low.diagnostics.drawCalls <= GAME_FRAME_BUDGETS.low.maxSceneDrawCalls);
  assert.ok(low.diagnostics.triangles <= GAME_FRAME_BUDGETS.low.maxSceneTriangles);
  assert.ok(low.diagnostics.estimatedGpuBytes <= GAME_FRAME_BUDGETS.low.maxEstimatedGpuBytes);

  low.dispose();
  balanced.dispose();
});

test("neutral avatar implements the shared animation-state contract", () => {
  const avatar = createNeutralAvatar("low");
  for (const state of ["idle", "walk", "run", "collect", "interact"] as const) {
    avatar.setAnimation(state);
    avatar.update(1 / 30);
    assert.equal(avatar.animation, state);
  }
  avatar.dispose();
});
