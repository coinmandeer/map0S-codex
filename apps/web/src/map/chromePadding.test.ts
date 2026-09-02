import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromeMapPadding, type ChromeInsets } from "./chromePadding.js";

const none: ChromeInsets = {
  topBarBottom: 60,
  sidebarWidth: 0,
  drawerWidth: 0,
  sheetHeight: 0,
  bottomNavHeight: 0,
  footerHeight: 0
};

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

describe("chromeMapPadding", () => {
  it("reserves the top bar and a gutter with nothing else open", () => {
    assert.deepEqual(chromeMapPadding(none, desktop), {
      top: 76,
      right: 16,
      bottom: 16,
      left: 16
    });
  });

  it("shifts the centre past an open sidebar and drawer", () => {
    const padding = chromeMapPadding({ ...none, sidebarWidth: 360, drawerWidth: 380 }, desktop);
    assert.equal(padding.left, 376);
    assert.equal(padding.right, 396);
  });

  it("treats the mobile sheet as bottom padding on top of the nav bar", () => {
    const padding = chromeMapPadding({ ...none, sheetHeight: 608, bottomNavHeight: 64 }, phone);
    // 608 + 64 + 16 exceeds 80 % of 844, so it is scaled down rather than rejected by MapLibre.
    assert.ok(padding.bottom <= Math.round(phone.height * 0.8));
    assert.ok(padding.bottom > 500);
  });

  it("takes the taller of sheet and footer rather than stacking them", () => {
    const withFooter = chromeMapPadding({ ...none, footerHeight: 120 }, desktop);
    const withBoth = chromeMapPadding({ ...none, footerHeight: 120, sheetHeight: 90 }, desktop);
    assert.equal(withBoth.bottom, withFooter.bottom);
  });

  it("never leaves the camera without room on either axis", () => {
    const padding = chromeMapPadding(
      {
        topBarBottom: 60,
        sidebarWidth: 900,
        drawerWidth: 900,
        sheetHeight: 800,
        bottomNavHeight: 64,
        footerHeight: 0
      },
      phone
    );
    assert.ok(padding.left + padding.right <= Math.round(phone.width * 0.8) + 1);
    assert.ok(padding.top + padding.bottom <= Math.round(phone.height * 0.8) + 1);
  });
});
