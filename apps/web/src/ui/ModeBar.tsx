import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { availableLayerPlugins, getLayerManifestV2 } from "../layers";
import { isStructuralTileOverlayId } from "../layers/plugins/tileLayers";
import { resolveBasemap } from "../map/basemapStyle";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import type { Fix } from "../lib/geolocation";
import { CommandSearch } from "./CommandSearch";
import { AreaControls } from "../discover/AreaControls";
import { LAYER_MODES } from "./modes";
import { useIsMobile } from "./useIsMobile";
import { BrandLogo } from "./BrandLogo";
import { LayersMegaMenu } from "./LayersMegaMenu";
import { activeLayerSummary, compactBasemapLabel } from "./modeBarPresentation";
import { Icon } from "./kit";

export function ModeBar({
  onFlyToMe,
  shellManagedUtilities = false
}: {
  onFlyToMe: () => Promise<Fix | null>;
  /** AppShell owns utility content; the legacy fallback keeps the current local popover. */
  shellManagedUtilities?: boolean;
}) {
  const store = getMapStore();
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const rightUtility = useShellStoreSnapshot((state) => state.rightUtility);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);
  const activeLayers = useMapStoreSnapshot((s) => s.activeLayers);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const basemapId = useMapStoreSnapshot((s) => s.basemapId);
  const theme = useMapStoreSnapshot((s) => s.theme);
  const mobile = useIsMobile();

  const placeCount = Object.values(visibleFeatures).reduce((n, feats) => n + feats.length, 0);
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
  const layersStatus = `${layerActivity.total} aktivní: ${layerActivity.poi} POI, ${layerActivity.thematic} tematické`;
  const currentBasemap = resolveBasemap(basemapId, theme);
  const currentBasemapLabel = compactBasemapLabel(currentBasemap.label);
  const basemapControlLabel = `Mapové podklady: ${currentBasemap.label}`;

  const [legacyLayersOpen, setLegacyLayersOpen] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);

  // Everything positioned below the bar (search-here, toast, mega menu sheet) keys off this,
  // so it has to track the bar's real rendered height rather than a guessed constant.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const apply = () => {
      const bottom = Math.ceil(el.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty("--modebar-h", `${bottom}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [mobile, mode]);

  const layersOpen = shellManagedUtilities ? rightUtility.type === "layers" : legacyLayersOpen;
  const setLayersOpen = (open: boolean | ((current: boolean) => boolean)) => {
    // A layer toggle can re-render this bar while the drawer keeps focus. Read the current shell
    // snapshot at click time so the opener remains a reliable close toggle even in that race.
    const current = shellManagedUtilities
      ? shell.snapshot.rightUtility.type === "layers"
      : legacyLayersOpen;
    const next = typeof open === "function" ? open(current) : open;
    if (shellManagedUtilities) {
      if (next) shell.openRightUtility("layers");
      else if (shell.snapshot.rightUtility.type === "layers") shell.closeRightUtility();
    } else {
      setLegacyLayersOpen(next);
    }
  };
  const closeMenus = () => setLayersOpen(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(".sheet-menu, .sheet-backdrop, .layers-megamenu")
      )
        return;
      if (
        !shellManagedUtilities &&
        layersRef.current &&
        !layersRef.current.contains(target as Node)
      )
        setLegacyLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (shellManagedUtilities && shell.snapshot.rightUtility.type === "layers") {
          shell.closeRightUtility();
        } else {
          setLegacyLayersOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [shell, shellManagedUtilities]);

  const megamenu =
    layersOpen && !shellManagedUtilities ? (
      mobile && typeof document !== "undefined" ? (
        createPortal(<LayersMegaMenu mobile onClose={closeMenus} />, document.body)
      ) : (
        <LayersMegaMenu mobile={false} onClose={closeMenus} />
      )
    ) : null;

  return (
    <div
      className={`topbar-shell${shellManagedUtilities ? " shell-managed" : ""}`}
      data-testid="mode-bar"
      ref={shellRef}
    >
      {leftContext.type === "closed" && (
        <button
          type="button"
          className="places-btn topbar-hamburger"
          data-testid="hamburger-btn"
          onClick={() => shell.toggleLeftContext()}
          aria-label={`Zobrazit panel ${LAYER_MODES.find((item) => item.id === mode)?.label ?? "mapy"}`}
          aria-expanded="false"
          aria-controls="left-context-host"
          title="Zobrazit levý panel"
        >
          <Icon name="menu" size={24} />
          {placeCount > 0 && (
            <span className="places-badge" data-testid="places-badge">
              {placeCount > 99 ? "99+" : placeCount}
            </span>
          )}
        </button>
      )}

      <div className="topbar-command-center" data-testid="command-center">
        <div className="brand-pill" data-testid="brand-pill">
          <BrandLogo size={24} />
          <span className="brand-name">MapOS</span>
        </div>

        <CommandSearch onFlyToMe={onFlyToMe} mode={mode} />
        <AreaControls />

        {!mobile && (
          <nav className="mode-tabs" aria-label="Režim mapy">
            {LAYER_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mode-tab ${mode === item.id ? "active" : ""}`}
                data-testid={item.testId}
                onClick={() => {
                  closeMenus();
                  shell.setMode(item.id);
                }}
              >
                <span className="mode-tab-icon">
                  <Icon name={item.icon} size={20} filled={mode === item.id} />
                </span>
                <span className="mode-tab-label">{item.label}</span>
              </button>
            ))}
          </nav>
        )}

        {!mobile && (
          <button
            className="icon-btn topbar-settings"
            data-testid="settings-btn"
            title="Nastavení"
            aria-label="Nastavení"
            onClick={() => {
              closeMenus();
              if (shellManagedUtilities) shell.openRightUtility("settings");
              else store.openSheet("settings");
            }}
          >
            <Icon name="settings" />
          </button>
        )}
      </div>

      <div className="topbar-utility-rail" data-testid="utility-rail">
        <div className="modebar-overflow" ref={layersRef}>
          <button
            type="button"
            className={`dropdown-btn ${layersOpen ? "open" : ""}${layerActivity.total ? " has-active" : ""}`}
            data-testid="overflow-btn"
            title={`Vrstvy mapy · ${layersStatus}`}
            aria-label={`Vrstvy mapy, ${layersStatus}`}
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((value) => !value)}
          >
            <Icon name="layers" size={20} />
            <span className="dropdown-btn-label">Vrstvy</span>
            {layerActivity.total > 0 && (
              <span
                className="layer-count-badge"
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
          {megamenu}
        </div>

        <button
          type="button"
          className="icon-btn basemap-current-btn"
          data-testid="basemap-btn"
          title={basemapControlLabel}
          aria-label={basemapControlLabel}
          onClick={() => {
            closeMenus();
            if (shellManagedUtilities) shell.openRightUtility("basemaps");
            else store.openSheet("tiles");
          }}
        >
          <Icon name="map" />
          <span className="basemap-current-label" data-testid="basemap-current-label">
            {currentBasemapLabel}
          </span>
        </button>

        {mobile && (
          <button
            className="icon-btn topbar-settings"
            data-testid="settings-btn"
            title="Nastavení"
            aria-label="Nastavení"
            onClick={() => {
              closeMenus();
              if (shellManagedUtilities) shell.openRightUtility("settings");
              else store.openSheet("settings");
            }}
          >
            <Icon name="settings" />
          </button>
        )}
      </div>

      <button
        type="button"
        className="visually-hidden"
        data-testid="usecase-btn"
        onClick={() => setLayersOpen(true)}
      >
        Presety
      </button>
    </div>
  );
}
