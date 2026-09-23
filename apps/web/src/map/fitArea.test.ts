import assert from "node:assert/strict";
import { it, mock } from "node:test";
import type { Map } from "maplibre-gl";
import { fitArea } from "./fitArea.js";
import { chromeMapPadding } from "./chromePadding.js";

for (const mobile of [false, true]) {
  it(`fits a country without counting ${mobile ? "mobile sheet" : "desktop panels"} twice`, () => {
    const size = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const insets = {
      topBarBottom: 60,
      sidebarWidth: mobile ? 0 : 360,
      drawerWidth: 0,
      sheetHeight: mobile ? 608 : 0,
      bottomNavHeight: mobile ? 64 : 0,
      footerHeight: 0
    };
    const current = chromeMapPadding(insets, size);
    const values: Record<string, number> = {
      "--chrome-top": 60,
      "--sidebar-w-open": insets.sidebarWidth,
      "--sheet-h": insets.sheetHeight,
      "--bottom-nav-h": insets.bottomNavHeight
    };
    const originals = Object.getOwnPropertyDescriptors(globalThis);
    Object.assign(globalThis, {
      document: { documentElement: {}, querySelector: () => null },
      getComputedStyle: () => ({ getPropertyValue: (key: string) => String(values[key] ?? 0) }),
      matchMedia: () => ({ matches: true })
    });
    try {
      const fitBounds = mock.fn();
      fitArea(
        {
          getContainer: () => ({ clientWidth: size.width, clientHeight: size.height }),
          getPadding: () => current,
          fitBounds
        } as unknown as Map,
        [12.09, 48.55, 18.86, 51.06]
      );
      const options = fitBounds.mock.calls[0]!.arguments[1];
      const extra = options.padding;
      assert.ok(extra.left < 100 && extra.bottom < 100, "fit adds context, not another panel");
      assert.ok(size.width - current.left - current.right - extra.left - extra.right > 100);
      assert.ok(size.height - current.top - current.bottom - extra.top - extra.bottom > 100);
      assert.equal(options.duration, 0, "reduced motion is preserved");
    } finally {
      for (const key of ["document", "getComputedStyle", "matchMedia"]) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]!);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
