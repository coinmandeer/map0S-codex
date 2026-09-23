import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchStreetObjectTile,
  isStreetObjectSource,
  streetObjectCategoryIds,
  streetObjectSourceLayer,
  STREET_OBJECT_CATEGORIES,
  StreetObjectsUnavailableError
} from "./streetObjectsService.js";

/**
 * The Mapillary tile sets and the token gate. These are the two things that decide whether the
 * street-objects layer draws anything at all and whether a deployment without a key is honest
 * about it.
 */
describe("street objects", () => {
  it("knows exactly Mapillary's two tile sets and their source layers", () => {
    assert.equal(streetObjectSourceLayer("point"), "point");
    assert.equal(streetObjectSourceLayer("sign"), "traffic_sign");
    assert.ok(isStreetObjectSource("point"));
    assert.ok(isStreetObjectSource("sign"));
    assert.ok(!isStreetObjectSource("images"));
    assert.ok(!isStreetObjectSource(""));
  });

  it("every agreed catalogue class belongs to one of the two tile sets", () => {
    for (const category of STREET_OBJECT_CATEGORIES) {
      assert.ok(
        category.source === "point" || category.source === "sign",
        `${category.id} must name a real tile set`
      );
    }
    // The classes the wireframe's rows map to must exist.
    for (const id of ["signs", "crossings", "cycle", "power", "network", "water", "furniture"]) {
      assert.ok(streetObjectCategoryIds().includes(id as never), `${id} must be a category`);
    }
  });

  it("refuses to fetch without a token rather than asking upstream", async () => {
    // This environment has no MAPILLARY_ACCESS_TOKEN, so the service must fail closed with a
    // typed error the route turns into a truthful 503 — never an empty tile.
    await assert.rejects(
      () => fetchStreetObjectTile("point", 14, 8848, 5550),
      (error: unknown) => error instanceof StreetObjectsUnavailableError
    );
  });
});
