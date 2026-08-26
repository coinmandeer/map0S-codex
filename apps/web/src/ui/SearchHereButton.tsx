import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";

/** Floating CTA when the map moved away from the last OSM fetch — avoids hammering Overpass
 * on every pan while still letting the user pull dense foreign-city POIs on demand. */
export function SearchHereButton() {
  const store = getMapStore();
  const pending = useMapStoreSnapshot((s) => s.searchHerePending);
  const loading = useMapStoreSnapshot((s) => s.loadingLayers);
  if (!pending) return null;

  return (
    <button
      className="search-here-btn"
      data-testid="search-here"
      disabled={Boolean(loading["osm-poi"])}
      onClick={() => {
        store.setSearchHerePending(false);
        window.dispatchEvent(new Event("mapos:search-here"));
      }}
    >
      {loading["osm-poi"] ? <span className="spinner" /> : null}
      Hledat v této oblasti
    </button>
  );
}
