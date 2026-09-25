import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chromeComposition,
  chromeStripWidth,
  LOCATION_LABEL_W,
  SEARCH_GIVE_W,
  topBarLayout,
  TOP_BAR_FULL_W,
  TOP_BAR_LOGO_ONLY_W
} from "./topBarLayout";

describe("topBarLayout", () => {
  it("shows every label when the strip is wide", () => {
    assert.deepEqual(topBarLayout({ available: TOP_BAR_FULL_W + LOCATION_LABEL_W }), {
      brand: "full",
      showLocationLabel: true
    });
  });

  it("drops the location label first", () => {
    const layout = topBarLayout({ available: TOP_BAR_FULL_W });
    assert.equal(layout.brand, "full");
    assert.equal(layout.showLocationLabel, false);
  });

  it("narrows the search field before dropping the wordmark", () => {
    const layout = topBarLayout({ available: TOP_BAR_FULL_W - SEARCH_GIVE_W });
    assert.equal(layout.brand, "full");
  });

  it("drops the wordmark once the search has nothing left to give", () => {
    assert.equal(topBarLayout({ available: TOP_BAR_FULL_W - SEARCH_GIVE_W - 1 }).brand, "logo");
  });

  it("drops the logo too when even that does not fit", () => {
    assert.equal(
      topBarLayout({ available: TOP_BAR_LOGO_ONLY_W - SEARCH_GIVE_W - 1 }).brand,
      "none"
    );
  });
});

describe("chromeStripWidth", () => {
  const rail = 258;
  const inset = 12;

  it("keeps the brand on a 1440 desktop with no panel", () => {
    const available = chromeStripWidth({
      viewport: 1440,
      sidebar: 0,
      drawer: 0,
      rail,
      hamburger: true,
      inset
    });
    assert.equal(available, 1440 - (12 + 40 + 12) - (12 + 258 + 12));
    assert.equal(topBarLayout({ available }).brand, "full");
  });

  it("keeps the brand on a 1440 desktop with the panel open (§7 acceptance)", () => {
    const available = chromeStripWidth({
      viewport: 1440,
      sidebar: 360,
      drawer: 0,
      rail,
      hamburger: false,
      inset
    });
    assert.equal(available, 786);
    // With the modes gone this is comfortable rather than marginal: the whole pill is 498 px.
    assert.equal(topBarLayout({ available }).brand, "full");
    assert.equal(topBarLayout({ available }).showLocationLabel, true);
  });

  it("accounts for an open drawer as well as an open panel", () => {
    assert.equal(
      chromeStripWidth({
        viewport: 1440,
        sidebar: 360,
        drawer: 380,
        rail,
        hamburger: false,
        inset
      }),
      1440 - 360 - 12 - 380 - 12 - 258 - 12
    );
  });

  it("keeps the desktop row when the strip is wide", () => {
    assert.deepEqual(chromeComposition({ strip: 1056, hamburger: false, inset: 12 }), {
      railStacked: false,
      compact: false
    });
  });

  it("stands the rail up rather than sliding the pill under it", () => {
    // 640 px of strip: a 256 px rail beside it would leave 372 px, under the 270 px floor only
    // once the hamburger is also there, so the rail stands up before the pill gives anything up.
    assert.deepEqual(chromeComposition({ strip: 500, hamburger: false, inset: 12 }), {
      railStacked: true,
      compact: false
    });
  });

  it("hands the settings button to the rail when even a stacked rail leaves too little", () => {
    assert.deepEqual(chromeComposition({ strip: 300, hamburger: true, inset: 12 }), {
      railStacked: true,
      compact: true
    });
  });

  it("never returns a negative strip", () => {
    assert.equal(
      chromeStripWidth({
        viewport: 360,
        sidebar: 360,
        drawer: 380,
        rail,
        hamburger: false,
        inset
      }),
      0
    );
  });
});
