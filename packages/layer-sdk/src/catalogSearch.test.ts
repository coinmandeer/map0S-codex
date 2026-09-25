import test from "node:test";
import assert from "node:assert/strict";
import { catalogSearchScore, LAYER_ALIASES } from "./catalogSearch.js";
test("local catalog search ranks exact, prefix, aliases and typo matches", () => {
  const names = ["Noční světla", "Night lights"],
    aliases = LAYER_ALIASES["dark-sky"];
  assert.equal(catalogSearchScore("nocni svetla", names, aliases), 100);
  assert.equal(catalogSearchScore("noční", names, aliases), 90);
  assert.equal(catalogSearchScore("světelný smog", names, aliases), 80);
  assert.equal(catalogSearchScore("hvezdy", names, aliases), 80);
  assert.equal(catalogSearchScore("nigth", names, aliases), 40);
  assert.equal(catalogSearchScore("svetlla", names, aliases), 40);
  assert.equal(catalogSearchScore("restaurace", names, aliases), 0);
});
