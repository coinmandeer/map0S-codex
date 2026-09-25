import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAYER_SESSION_STORAGE_KEY,
  readLayerSessionState,
  writeLayerSessionState
} from "./layerSessionState";

describe("privacy-bounded layer session state", () => {
  it("round-trips active public UI state without precise or owner data", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    writeLayerSessionState(storage, {
      "osm-poi": {
        visible: true,
        opacity: 0.72,
        filters: {
          categories: ["castle", "viewpoint"],
          center: { lat: 49.7, lng: 13.3 },
          owner_id: "private-user"
        }
      },
      weather: { visible: false, opacity: 1, filters: {} }
    });

    const raw = values.get(LAYER_SESSION_STORAGE_KEY)!;
    assert.equal(raw.includes("49.7"), false);
    assert.equal(raw.includes("private-user"), false);
    assert.deepEqual(readLayerSessionState(storage), {
      "osm-poi": {
        visible: true,
        selected: true,
        opacity: 0.72,
        filters: { categories: ["castle", "viewpoint"] }
      },
      weather: { visible: false, selected: true, opacity: 1, filters: {} }
    });
  });

  it("fails closed on corrupt, oversized or unselected entries", () => {
    const storage = { getItem: () => "{" };
    assert.deepEqual(readLayerSessionState(storage), {});
    assert.deepEqual(
      readLayerSessionState({
        getItem: () => JSON.stringify({ hidden: { visible: false, opacity: 1, filters: {} } })
      }),
      {
        hidden: { visible: false, selected: true, opacity: 1, filters: {} }
      }
    );
    assert.deepEqual(
      readLayerSessionState({
        getItem: () => JSON.stringify({ hidden: { visible: true, opacity: 1, filters: {} } })
      }),
      { hidden: { visible: true, selected: true, opacity: 1, filters: {} } }
    );
  });
});
