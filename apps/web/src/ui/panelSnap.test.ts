import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_STRIP_PX,
  PEEK_HEIGHT_PX,
  defaultSnapFor,
  nearestSnap,
  readSnap,
  snapAt,
  snapHeightPx,
  snapIndex,
  writeSnap
} from "./panelSnap.js";

const phone = { viewportHeight: 844, topBarBottom: 60, bottomNavHeight: 64 };

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  } as Storage;
}

describe("mobile sheet snaps", () => {
  it("leaves a map strip above a full sheet", () => {
    const full = snapHeightPx("full", phone);
    assert.equal(full, 844 - 60 - MAP_STRIP_PX - 64);
    assert.ok(phone.viewportHeight - full - phone.bottomNavHeight >= MAP_STRIP_PX);
  });

  it("shows more content at full height than the sheet it replaces", () => {
    // The 0.62 dvh sheet this replaces gave roughly 520 px on a 390x844 phone; §21.2 asks for 620.
    assert.ok(snapHeightPx("full", phone) >= 600);
  });

  it("halves the viewport for half and never goes under the peek height", () => {
    assert.equal(snapHeightPx("half", phone), 422);
    assert.equal(snapHeightPx("peek", phone), PEEK_HEIGHT_PX);
    assert.equal(
      snapHeightPx("full", { viewportHeight: 240, topBarBottom: 60, bottomNavHeight: 64 }),
      PEEK_HEIGHT_PX
    );
  });

  it("lands a released drag on the closest snap", () => {
    assert.equal(nearestSnap(100, phone), "peek");
    assert.equal(nearestSnap(400, phone), "half");
    assert.equal(nearestSnap(600, phone), "full");
  });

  it("round-trips and clamps the index used by the keyboard handler", () => {
    assert.equal(snapAt(snapIndex("half")), "half");
    assert.equal(snapAt(-4), "peek");
    assert.equal(snapAt(99), "full");
  });

  it("opens lists fully and single records or empty forms at half", () => {
    assert.equal(defaultSnapFor("personal-panel", false), "full");
    assert.equal(defaultSnapFor("discover-panel", false), "full");
    assert.equal(defaultSnapFor("place-detail", true), "half");
    assert.equal(defaultSnapFor("planning-panel", false), "half");
    assert.equal(defaultSnapFor("planning-panel", true), "full");
  });

  it("remembers a snap per panel and ignores junk", () => {
    const storage = memoryStorage();
    assert.equal(readSnap(storage, "personal-panel"), null);
    writeSnap(storage, "personal-panel", "half");
    assert.equal(readSnap(storage, "personal-panel"), "half");
    assert.equal(readSnap(storage, "discover-panel"), null);
    storage.setItem("mapos:panel-snap:personal-panel", "enormous");
    assert.equal(readSnap(storage, "personal-panel"), null);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    } as unknown as Storage;
    assert.equal(readSnap(broken, "personal-panel"), null);
    assert.doesNotThrow(() => writeSnap(broken, "personal-panel", "full"));
  });
});
