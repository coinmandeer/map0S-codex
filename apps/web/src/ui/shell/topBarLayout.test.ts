import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chromeComposition,
  chromeStripWidth,
  LOCATION_LABEL_W,
  topBarLayout,
  TOP_BAR_FULL_W,
  TOP_BAR_LOGO_ONLY_W,
  TOP_BAR_NO_BRAND_W
} from "./topBarLayout";

describe("topBarLayout", () => {
  it("shows every label when the strip is wide", () => {
    assert.deepEqual(topBarLayout({ available: TOP_BAR_FULL_W + LOCATION_LABEL_W }), {
      brand: "full",
      showModeLabels: true,
      showLocationLabel: true
    });
  });

  it("drops the location label first", () => {
    const layout = topBarLayout({ available: TOP_BAR_FULL_W });
    assert.equal(layout.brand, "full");
    assert.equal(layout.showModeLabels, true);
    assert.equal(layout.showLocationLabel, false);
  });

  it("drops the wordmark before the mode labels", () => {
    const layout = topBarLayout({ available: TOP_BAR_LOGO_ONLY_W });
    assert.equal(layout.brand, "logo");
    assert.equal(layout.showModeLabels, true);
  });

  it("drops the whole brand before the mode labels", () => {
    const layout = topBarLayout({ available: TOP_BAR_NO_BRAND_W });
    assert.equal(layout.brand, "none");
    assert.equal(layout.showModeLabels, true);
  });

  it("falls back to icon-only modes only when the brand is already gone", () => {
    const layout = topBarLayout({ available: TOP_BAR_NO_BRAND_W - 1 });
    assert.equal(layout.brand, "none");
    assert.equal(layout.showModeLabels, false);
  });
});

describe("chromeStripWidth", () => {
  const rail = 258;
  const inset = 12;

  it("keeps the mode labels on a 1440 desktop with no panel", () => {
    const available = chromeStripWidth({
      viewport: 1440,
      sidebar: 0,
      drawer: 0,
      rail,
      hamburger: true,
      inset
    });
    assert.equal(available, 1440 - (12 + 40 + 12) - (12 + 258 + 12));
    assert.deepEqual(topBarLayout({ available }).brand, "full");
    assert.equal(topBarLayout({ available }).showModeLabels, true);
  });

  it("keeps the mode labels on a 1440 desktop with the panel open (§7 acceptance)", () => {
    const available = chromeStripWidth({
      viewport: 1440,
      sidebar: 360,
      drawer: 0,
      rail,
      hamburger: false,
      inset
    });
    assert.equal(available, 786);
    const layout = topBarLayout({ available });
    assert.equal(layout.brand, "none");
    assert.equal(layout.showModeLabels, true);
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

  it("stands the rail up rather than sliding the pill under it at 900 px", () => {
    // 900 px window, 360 px sidebar open, hamburger hidden: 516 px of strip.
    assert.deepEqual(chromeComposition({ strip: 516, hamburger: false, inset: 12 }), {
      railStacked: true,
      compact: false
    });
  });

  it("hands the settings button to the rail when even a stacked rail leaves too little", () => {
    // 1100 px window with both the panel and the drawer open.
    assert.deepEqual(chromeComposition({ strip: 336, hamburger: true, inset: 12 }), {
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
