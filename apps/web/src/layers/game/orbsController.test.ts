import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type maplibregl from "maplibre-gl";
import { distanceMeters, type GeoFeature } from "@mapos/layer-sdk";
import {
  generateOrbField,
  orbDayKey,
  orbFieldKey,
  orbSectorCentre,
  ORB_SECTOR_SIZE_M,
  ORB_SPACING_M,
  pickLures
} from "./orbsController";

const origin = { lng: 14.42, lat: 50.08 };
const centre = { lng: 14.44, lat: 50.09 };

function point(name: string, lng: number, lat: number): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id: name, name, layerId: "osm-poi" }
  } as GeoFeature;
}

const emptyMap = { queryRenderedFeatures: () => [] } as unknown as maplibregl.Map;

/** A deterministic neighbourhood street grid covering more than one board. */
const streetMap = {
  queryRenderedFeatures: () => {
    const features: Array<Record<string, unknown>> = [];
    for (let offset = -0.012; offset <= 0.012; offset += 0.001) {
      features.push({
        layer: { id: "road_street" },
        geometry: {
          type: "LineString",
          coordinates: [
            [origin.lng - 0.018, origin.lat + offset],
            [origin.lng + 0.018, origin.lat + offset]
          ]
        }
      });
      features.push({
        layer: { id: "road_path" },
        geometry: {
          type: "LineString",
          coordinates: [
            [origin.lng + offset, origin.lat - 0.018],
            [origin.lng + offset, origin.lat + 0.018]
          ]
        }
      });
    }
    return features;
  }
} as unknown as maplibregl.Map;

function fieldFor(userId: string, lures = pickLures({}, origin, userId, centre)) {
  return generateOrbField({
    userId,
    origin,
    lures,
    collected: new Set<string>(),
    map: streetMap,
    dayKey: "2026-08-28"
  });
}

describe("orb field", () => {
  it("gives two players different dots in the same place", () => {
    const mine = fieldFor("user-a").map((o) => o.id);
    const yours = fieldFor("user-b").map((o) => o.id);
    assert.ok(mine.length > 0);
    assert.equal(
      mine.some((id) => yours.includes(id)),
      false
    );
  });

  it("puts the same dots back after a reload", () => {
    assert.deepEqual(fieldFor("user-a"), fieldFor("user-a"));
  });

  it("keeps one board while the player moves inside the same kilometre cell", () => {
    const moved = { lng: origin.lng + 0.0005, lat: origin.lat - 0.001 };
    assert.equal(
      orbFieldKey("user-a", moved, "2026-08-28"),
      orbFieldKey("user-a", origin, "2026-08-28")
    );
    assert.deepEqual(
      generateOrbField({
        userId: "user-a",
        origin: moved,
        lures: [],
        collected: new Set<string>(),
        map: streetMap,
        dayKey: "2026-08-28"
      }),
      generateOrbField({
        userId: "user-a",
        origin,
        lures: [],
        collected: new Set<string>(),
        map: streetMap,
        dayKey: "2026-08-28"
      })
    );
  });

  it("creates a new board on the next local calendar day", () => {
    const today = generateOrbField({
      userId: "user-a",
      origin,
      lures: [],
      collected: new Set<string>(),
      map: streetMap,
      dayKey: "2026-08-28"
    });
    const tomorrow = generateOrbField({
      userId: "user-a",
      origin,
      lures: [],
      collected: new Set<string>(),
      map: streetMap,
      dayKey: "2026-08-29"
    });
    assert.notDeepEqual(
      today.map((orb) => orb.id),
      tomorrow.map((orb) => orb.id)
    );
    assert.equal(orbDayKey(new Date(2026, 7, 28, 23, 59)), "2026-08-28");
  });

  it("lays a trail from the player towards the lure, not a ring around them", () => {
    const boardCentre = orbSectorCentre(origin);
    const lure = { name: "Katedrála", lng: 14.43, lat: 50.085 };
    const trail = fieldFor("user-a", [lure]).filter((o) => o.towards === "Katedrála");
    assert.ok(trail.length >= 5, "a 900 m walk should be more than a couple of dots");

    // Each dot is further along the way than the one before it.
    const progress = trail.map((o) => Math.hypot(o.lng - boardCentre.lng, o.lat - boardCentre.lat));
    for (let i = 1; i < progress.length; i++) {
      assert.ok(progress[i]! > progress[i - 1]!, "trail should lead away from the player");
    }
    // The current board is only one kilometre square, so a farther landmark is approached up to
    // the sector edge rather than creating invisible dots kilometres away.
    const last = trail.at(-1)!;
    assert.ok(distanceMeters(boardCentre, last) >= 400);
    assert.ok(distanceMeters(boardCentre, last) < distanceMeters(boardCentre, lure));
  });

  it("does not place dots off-road when the basemap has no street geometry", () => {
    const field = generateOrbField({
      userId: "user-a",
      origin,
      lures: [],
      collected: new Set<string>(),
      map: emptyMap,
      dayKey: "2026-08-28"
    });
    assert.deepEqual(field, []);
  });

  it("fills a kilometre sector at roughly 100 m intervals without spawning underfoot", () => {
    const loose = fieldFor("user-a", []).filter((o) => !o.towards);
    assert.ok(loose.length >= 80, `expected a field rather than a handful, got ${loose.length}`);

    const latSpanM = distanceMeters(
      { lng: origin.lng, lat: Math.min(...loose.map((orb) => orb.lat)) },
      { lng: origin.lng, lat: Math.max(...loose.map((orb) => orb.lat)) }
    );
    const lngSpanM = distanceMeters(
      { lng: Math.min(...loose.map((orb) => orb.lng)), lat: origin.lat },
      { lng: Math.max(...loose.map((orb) => orb.lng)), lat: origin.lat }
    );
    assert.ok(latSpanM > ORB_SECTOR_SIZE_M - ORB_SPACING_M * 2);
    assert.ok(lngSpanM > ORB_SECTOR_SIZE_M - ORB_SPACING_M * 2);
    assert.ok(loose.every((orb) => orb.id.includes(":2026-08-28:")));
  });

  it("skips dots the player already picked up", () => {
    const first = fieldFor("user-a");
    const collected = new Set([first[0]!.id, first[1]!.id]);
    const after = generateOrbField({
      userId: "user-a",
      origin,
      lures: pickLures({}, origin, "user-a", centre),
      collected,
      map: streetMap,
      dayKey: "2026-08-28"
    }).map((o) => o.id);
    assert.equal(after.includes(first[0]!.id), false);
    assert.equal(after.includes(first[1]!.id), false);
  });

  it("keeps the trail a trail when it is snapped onto a road", () => {
    // A straight road is two vertices half a kilometre apart. Snapping to the nearer *vertex*
    // dragged every dot onto the same corner, and a trail of twenty became a trail of one.
    const boardCentre = orbSectorCentre(origin);
    const road = {
      queryRenderedFeatures: () => [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [boardCentre.lng, boardCentre.lat],
              [boardCentre.lng + 0.01, boardCentre.lat + 0.005]
            ]
          }
        }
      ]
    } as unknown as maplibregl.Map;

    const lure = {
      name: "Katedrála",
      lng: boardCentre.lng + 0.008,
      lat: boardCentre.lat + 0.004
    };
    const trail = generateOrbField({
      userId: "user-a",
      origin,
      lures: [lure],
      collected: new Set<string>(),
      map: road
    }).filter((o) => o.towards === "Katedrála");

    assert.ok(trail.length >= 5, `expected a line of dots, got ${trail.length}`);
    const spots = new Set(trail.map((o) => `${o.lng.toFixed(5)},${o.lat.toFixed(5)}`));
    assert.equal(spots.size, trail.length, "dots must not pile up on one spot");
  });

  it("keeps the sector dots on rendered streets when road geometry is available", () => {
    const road = {
      queryRenderedFeatures: () => [
        {
          layer: { id: "road_street" },
          geometry: {
            type: "LineString",
            coordinates: [
              [origin.lng - 0.01, origin.lat],
              [origin.lng + 0.01, origin.lat]
            ]
          }
        },
        {
          layer: { id: "waterway-river" },
          geometry: {
            type: "LineString",
            coordinates: [
              [origin.lng - 0.01, origin.lat + 0.003],
              [origin.lng + 0.01, origin.lat + 0.003]
            ]
          }
        }
      ]
    } as unknown as maplibregl.Map;

    const field = generateOrbField({
      userId: "user-a",
      origin,
      lures: [],
      collected: new Set<string>(),
      map: road
    });
    assert.ok(field.length >= 5);
    assert.ok(field.every((orb) => Math.abs(orb.lat - origin.lat) < 1e-9));
  });
});

describe("lure choice", () => {
  it("finishes when every candidate is in one dense city-centre cluster", () => {
    const clustered = Array.from({ length: 12 }, (_, index) =>
      point(
        `Bod ${index}`,
        origin.lng + 0.002 + index * 0.00002,
        origin.lat + 0.001 + index * 0.00001
      )
    );
    const lures = pickLures({ "osm-poi": clustered }, origin, "user-a", centre);
    assert.equal(lures.length, 1, "nearby destinations should collapse to one trail");
    assert.deepEqual(lures, pickLures({ "osm-poi": clustered }, origin, "user-a", centre));
  });

  it("walks you to a named landmark that is a walk away", () => {
    const lures = pickLures(
      {
        "osm-poi": [
          point("Katedrála", 14.428, 50.084),
          // Underfoot: no trail worth laying.
          point("Lavička", 14.4201, 50.0801),
          // Another town over.
          point("Hrad Karlštejn", 14.19, 49.94)
        ]
      },
      origin,
      "user-a",
      centre
    );
    assert.deepEqual(
      lures.map((l) => l.name),
      ["Katedrála"]
    );
  });

  it("points at the nearest far place rather than giving up", () => {
    // Walk out of town and everything is out of comfortable range; a long trail beats none.
    const lures = pickLures(
      { "osm-poi": [point("Hrad Karlštejn", 14.19, 49.94), point("Sněžka", 15.74, 50.73)] },
      origin,
      "user-a",
      centre
    );
    assert.deepEqual(
      lures.map((l) => l.name),
      ["Hrad Karlštejn"]
    );
  });

  it("ignores pins with no name — a dot leading to nothing sayable is just a dot", () => {
    const unnamed = point("", 14.428, 50.084);
    const lures = pickLures({ "osm-poi": [unnamed] }, origin, "user-a", centre);
    assert.deepEqual(
      lures.map((l) => l.name),
      ["Střed mapy"]
    );
  });

  it("heads for the middle of the view before any places have loaded", () => {
    assert.deepEqual(pickLures({}, origin, "user-a", centre), [
      { name: "Střed mapy", lng: centre.lng, lat: centre.lat }
    ]);
  });

  it("picks the same lures for the same player and place", () => {
    const features = {
      "osm-poi": [
        point("Katedrála", 14.428, 50.084),
        point("Muzeum", 14.425, 50.086),
        point("Most", 14.427, 50.079)
      ]
    };
    assert.deepEqual(
      pickLures(features, origin, "user-a", centre),
      pickLures(features, origin, "user-a", centre)
    );
  });

  it("does not query a raster-only style for impossible road geometry", () => {
    let queried = false;
    const rasterMap = {
      getStyle: () => ({ layers: [{ id: "basemap-raster", type: "raster" }] }),
      queryRenderedFeatures: () => {
        queried = true;
        throw new Error("raster viewport must not be queried for roads");
      }
    } as unknown as maplibregl.Map;
    const field = generateOrbField({
      userId: "user-a",
      origin,
      lures: [],
      collected: new Set<string>(),
      map: rasterMap
    });
    assert.deepEqual(field, []);
    assert.equal(queried, false);
  });
});
