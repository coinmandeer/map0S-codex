import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMapStore } from "../store/mapStore";
import { emit } from "../lib/events";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { geolocation, type Fix } from "../lib/geolocation";
import { CountryPicker } from "./CountryPicker";
import { LAYER_MODES } from "./modes";
import { useIsMobile } from "./useIsMobile";
import { BrandLogo } from "./BrandLogo";
import { LayersMegaMenu } from "./LayersMegaMenu";
import { Icon } from "./primitives";

interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
}

interface TagHit {
  tag: string;
  count: number;
}

export function ModeBar({ onFlyToMe }: { onFlyToMe: () => Promise<Fix | null> }) {
  const store = getMapStore();
  const activeTag = useMapStoreSnapshot((s) => s.activeTag);
  const mode = useMapStoreSnapshot((s) => s.mode);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);
  const mobile = useIsMobile();

  const placeCount = Object.values(visibleFeatures).reduce((n, feats) => n + feats.length, 0);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [tagHits, setTagHits] = useState<TagHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");

  // Read up front so a blocked button can say so in its tooltip instead of only failing once
  // the user has clicked and waited.
  useEffect(() => {
    let cancelled = false;
    void geolocation.permission().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const locationState = locating ? "locating" : permission === "denied" ? "denied" : "idle";

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

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setHits([]);
      setTagHits([]);
      return;
    }
    if (trimmed.startsWith("#")) {
      const t = setTimeout(() => {
        setSearching(true);
        fetch(`${API_BASE}/tags/top?q=${encodeURIComponent(trimmed.slice(1))}`)
          .then((r) => (r.ok ? r.json() : { tags: [] }))
          .then((data: { tags?: TagHit[] }) => setTagHits(data.tags ?? []))
          .catch(() => setTagHits([]))
          .finally(() => setSearching(false));
      }, 200);
      setHits([]);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`${API_BASE}/geocode?q=${encodeURIComponent(trimmed)}&provider=${store.dataProvider}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results?: GeoHit[] }) => setHits(data.results ?? []))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 280);
    setTagHits([]);
    return () => clearTimeout(t);
  }, [query, store]);

  const closeMenus = () => setLayersOpen(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(".sheet-menu, .sheet-backdrop, .layers-megamenu")
      )
        return;
      if (layersRef.current && !layersRef.current.contains(target as Node)) setLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenus();
        setHits([]);
        setTagHits([]);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const pickHit = (hit: GeoHit) => {
    const lng = Number(hit.lon);
    const lat = Number(hit.lat);
    emit("fly-to", { lng, lat, zoom: 14 });
    store.setView({ lng, lat, zoom: 14 });
    setQuery("");
    setHits([]);
    setTagHits([]);
    emit("search-here");
  };

  const pickTag = (tag: string) => {
    store.setActiveTag(tag);
    setQuery("");
    setTagHits([]);
    store.showToast(`Filtr #${tag}`);
  };

  const flyToMe = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const fix = await onFlyToMe();
      if (!fix || mode !== "discover") return;
      // Reuses the fix rather than asking the device again, which is what made one click
      // fire two competing geolocation requests.
      const res = await fetch(`${API_BASE}/geocode/reverse?lat=${fix.lat}&lng=${fix.lng}`);
      if (!res.ok) return;
      const data = (await res.json()) as { country?: string } | null;
      if (data?.country) store.setCountry(data.country);
    } catch {
      /* onFlyToMe already reported why; a failed country lookup changes nothing. */
    } finally {
      setLocating(false);
      // The click may have been the prompt itself, so the answer is only known now.
      setPermission(await geolocation.permission());
    }
  };

  const hasSearchResults = hits.length > 0 || tagHits.length > 0;

  const megamenu = layersOpen ? (
    mobile && typeof document !== "undefined" ? (
      createPortal(<LayersMegaMenu mobile onClose={closeMenus} />, document.body)
    ) : (
      <LayersMegaMenu mobile={false} onClose={closeMenus} />
    )
  ) : null;

  return (
    <div className="topbar-shell" data-testid="mode-bar" ref={shellRef}>
      <div className="topbar-row topbar-row-nav">
        <button
          className="places-btn"
          data-testid="hamburger-btn"
          onClick={() => store.togglePanel()}
          aria-label="Seznam míst"
          title="Seznam míst"
        >
          <Icon name="list" />
          {placeCount > 0 && (
            <span className="places-badge" data-testid="places-badge">
              {placeCount > 99 ? "99+" : placeCount}
            </span>
          )}
        </button>

        <div className="brand-pill" data-testid="brand-pill">
          <BrandLogo size={24} />
          <span className="brand-name">MapOS</span>
        </div>

        {mode === "discover" && mobile && <CountryPicker compact />}

        <div className="topbar-search">
          <Icon name="search" size={16} />
          <input
            data-testid="place-search"
            placeholder="Hledat místo nebo #tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && <span className="spinner" />}
          {activeTag && (
            <button className="tag-chip" onClick={() => store.setActiveTag(null)} type="button">
              #{activeTag} ✕
            </button>
          )}
          <button
            type="button"
            className="search-locate-btn"
            data-testid="location-btn"
            data-state={locationState}
            title={locationState === "denied" ? "Poloha je zakázaná v prohlížeči" : "Moje poloha"}
            aria-label="Moje poloha"
            aria-busy={locating}
            disabled={locating}
            onClick={flyToMe}
          >
            {locating ? <span className="spinner" /> : <Icon name="crosshair" size={16} />}
          </button>
          {hasSearchResults && (
            <div className="search-hits">
              {tagHits.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  className="search-hit"
                  onClick={() => pickTag(t.tag)}
                >
                  #{t.tag} <span className="meta">({t.count})</span>
                </button>
              ))}
              {hits.map((h) => (
                <button
                  key={`${h.lat},${h.lon},${h.display_name}`}
                  type="button"
                  className="search-hit"
                  onClick={() => pickHit(h)}
                >
                  {h.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="icon-btn"
          data-testid="settings-btn"
          title="Nastavení"
          aria-label="Nastavení"
          onClick={() => {
            closeMenus();
            store.openSheet("settings");
          }}
        >
          <Icon name="settings" />
        </button>
      </div>

      <div className="topbar-row topbar-row-tools">
        {mode === "discover" && !mobile && <CountryPicker compact={false} />}

        {!mobile && (
          <nav className="mode-tabs" aria-label="Režim mapy">
            {LAYER_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mode-tab ${mode === m.id ? "active" : ""}`}
                data-testid={m.testId}
                onClick={() => {
                  closeMenus();
                  store.setMode(m.id);
                }}
              >
                <span className="mode-tab-icon">
                  <Icon name={m.icon} size={16} />
                </span>
                <span className="mode-tab-label">{m.label}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="topbar-dropdowns">
          <div className="modebar-overflow" ref={layersRef}>
            <button
              type="button"
              className={`dropdown-btn ${layersOpen ? "open" : ""}`}
              data-testid="overflow-btn"
              title="Vrstvy mapy"
              onClick={() => setLayersOpen((v) => !v)}
            >
              <Icon name="layers" size={16} />
              <span className="dropdown-btn-label">Vrstvy</span>
            </button>
            <button
              type="button"
              className="visually-hidden"
              data-testid="usecase-btn"
              onClick={() => setLayersOpen(true)}
            >
              Presety
            </button>
            {megamenu}
          </div>
        </div>
      </div>
    </div>
  );
}
