import { useEffect, useLayoutEffect, useRef } from "react";
import { QuickLayers } from "../layers/QuickLayers";
import { t } from "../../i18n";
import type { Fix } from "../../lib/geolocation";
import { availableLayerPlugins, getLayerManifestV2 } from "../../layers";
import { isStructuralTileOverlayId } from "../../layers/plugins/tileLayers";

import { getShellStore } from "../../store/shellStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { MapStatus } from "./MapStatus";

import { CommandSearch } from "../CommandSearch";
import { Icon, IconButton, useElementWidth } from "../kit";
import { activeLayerSummary } from "../modeBarPresentation";
import { LAYER_MODES } from "../modes";
import { useIsMobile } from "../useIsMobile";
import { chromeComposition, topBarLayout } from "./topBarLayout";

/** The top bar (§3.1): one floating pill over the map, plus a hamburger on the left and the
 *  Podklady/Vrstvy pair on the right.
 *
 *  The bar holds three things — brand, search, settings. The modes moved to a floating pill at
 *  the bottom (`DesktopModeBar`), which is what took this row from crowded to legible; what is
 *  left is "where am I going" and "how does this look", and those belong at the top.
 *
 *  The pill lives in a slot whose left and right edges follow the open panel, the open drawer
 *  and the utility rail, and is centred inside it. Measuring that slot rather than the window
 *  is why the search field never ends up underneath the Podklady button.
 */
export function TopBar({ onFlyToMe }: { onFlyToMe: () => Promise<Fix | null> }) {
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const rightUtility = useShellStoreSnapshot((state) => state.rightUtility);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const capabilities = useMapStoreSnapshot((state) => state.capabilities);
  const experienceId = useMapStoreSnapshot((state) => state.experienceId);
  const mobile = useIsMobile();
  const slotRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const slotWidth = useElementWidth(slotRef);
  const railWidth = useElementWidth(railRef);
  // The strip is everything the panel and the drawer left over, rail included; the pill's own
  // slot is what remains after the rail, so the composition has to be decided on the strip.
  const stripWidth = useElementWidth(stripRef);
  const { brand, showLocationLabel } = topBarLayout({ available: slotWidth });
  const { railStacked, compact } = chromeComposition({
    strip: stripWidth,
    hamburger: leftContext.type === "closed",
    inset: 12
  });
  const settingsInRail = mobile || compact;

  // The rail's width is the right edge of the pill's slot. Publishing it as a variable keeps the
  // whole geometry in CSS, so the pill slides with the same transition as the panels.
  useLayoutEffect(() => {
    if (mobile) return;
    const root = document.documentElement;
    root.style.setProperty("--chrome-rail-w", `${Math.round(railWidth)}px`);
    return () => {
      root.style.removeProperty("--chrome-rail-w");
    };
  }, [mobile, railWidth]);

  const layerActivity = activeLayerSummary(
    activeLayers,
    availableLayerPlugins(capabilities).map((plugin) => ({
      id: plugin.manifest.id,
      kind: plugin.kind,
      category: getLayerManifestV2(plugin.manifest.id)?.category ?? plugin.manifest.category,
      experienceIds: plugin.manifest.experienceIds
    })),
    experienceId,
    isStructuralTileOverlayId
  );
  const layersStatus = t("layers.status", {
    total: layerActivity.total,
    poi: layerActivity.poi,
    thematic: layerActivity.thematic
  });

  const layersOpen = rightUtility.type === "layers" || rightUtility.type === "basemaps";
  const settingsOpen = rightUtility.type === "settings";

  const toggleUtility = (type: "layers" | "basemaps" | "settings") => {
    if (shell.snapshot.rightUtility.type === type) shell.closeRightUtility();
    else shell.openRightUtility(type);
  };

  // Escape closes the drawer from anywhere in the chrome. Panels and dialogs handle their own,
  // and the browser-history binding handles back.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (shell.snapshot.rightUtility.type !== "closed") shell.closeRightUtility();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shell]);

  const modeLabel = LAYER_MODES.find((item) => item.id === mode)?.label ?? "";

  return (
    <div className="chrome-top" data-testid="mode-bar">
      {leftContext.type === "closed" && (
        <IconButton
          icon="menu"
          label={`${t("topbar.openPanel")}: ${modeLabel}`}
          size="lg"
          className="chrome-hamburger"
          testId="hamburger-btn"
          onClick={() => shell.toggleLeftContext()}
          aria-expanded={false}
          aria-controls="left-context-host"
        />
      )}

      <div className="chrome-bar-slot" ref={slotRef}>
        <div
          className="chrome-bar"
          data-testid="command-center"
          data-compact={compact || undefined}
        >
          <MapStatus compact={mobile || brand !== "full"} />

          <CommandSearch onFlyToMe={onFlyToMe} mode={mode} showLocationLabel={showLocationLabel} />

          {!mobile && !settingsInRail && (
            <>
              <span className="chrome-divider" aria-hidden="true" />
              <IconButton
                icon="settings"
                label={t("topbar.settings")}
                active={settingsOpen}
                aria-expanded={settingsOpen}
                testId="settings-btn"
                onClick={() => toggleUtility("settings")}
              />
            </>
          )}
        </div>
      </div>

      <div className="quick-layers-slot">
        <QuickLayers />
      </div>
      <div className="chrome-utility-slot" ref={stripRef}>
        <div
          className="chrome-utility"
          data-testid="utility-rail"
          data-stacked={!mobile && railStacked ? "" : undefined}
          ref={railRef}
        >
          <button
            type="button"
            className="chrome-utility-btn"
            data-active={layersOpen || undefined}
            data-testid="layers-btn"
            title={`${t("topbar.layers")} · ${layersStatus}`}
            aria-label={`${t("topbar.layers")}, ${layersStatus}`}
            aria-expanded={layersOpen}
            onClick={() => (layersOpen ? shell.closeRightUtility() : toggleUtility("layers"))}
          >
            <Icon name="layers" size={20} />
            <span className="chrome-utility-label">{t("topbar.layers")}</span>
            {layerActivity.total > 0 && (
              <span
                className="chrome-utility-badge"
                data-testid="active-layer-count"
                data-poi-count={layerActivity.poi}
                data-thematic-count={layerActivity.thematic}
                aria-hidden="true"
              >
                {layerActivity.total > 99 ? "99+" : layerActivity.total}
              </span>
            )}
            <span className="visually-hidden" aria-live="polite">
              {layersStatus}
            </span>
          </button>

          {settingsInRail && (
            <button
              type="button"
              className="chrome-utility-btn"
              data-active={settingsOpen || undefined}
              data-testid="settings-btn"
              title={t("topbar.settings")}
              aria-label={t("topbar.settings")}
              aria-expanded={settingsOpen}
              onClick={() => toggleUtility("settings")}
            >
              <Icon name="settings" size={20} filled={settingsOpen} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
