import { useEffect, useState, useSyncExternalStore } from "react";
import { emit } from "../lib/events";
import { t } from "../i18n";
import { areaQuery } from "../search/areaQuery";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Icon } from "./kit";

/**
 * "Search this area", floating over the map.
 *
 * Short pans refresh on their own; this appears only when the view is out of date in a way the
 * map will not fix by itself — layers left waiting after a long move (or after any move of the
 * reader's with the manual-refresh preference), or the assistant's last place search once the
 * reader has moved elsewhere. One press brings the layers up to date for the current view and
 * asks that search again here. It used to live only inside the Map status popover, so after a
 * long pan the pins seemed not to load at all.
 */
export function SearchHereButton() {
  const pending = useMapStoreSnapshot((s) => s.searchHerePending);
  const loading = useMapStoreSnapshot((s) => s.loadingLayers);
  const game = useMapStoreSnapshot((s) => s.mode === "game");
  useSyncExternalStore(areaQuery.subscribe, areaQuery.revision, areaQuery.revision);
  const query = areaQuery.moved() ? areaQuery.get() : null;
  const [searching, setSearching] = useState(false);
  const busy = Object.values(loading).some(Boolean);

  useEffect(() => {
    if (!searching || busy || pending) return;
    // A short hold, so an answer served from cache does not blink the chip in and out.
    const timer = window.setTimeout(() => setSearching(false), 300);
    return () => window.clearTimeout(timer);
  }, [searching, busy, pending]);

  if (game || (!searching && !pending && !query)) return null;

  const label = searching ? t("search.searchingHere") : t("search.searchHere");
  return (
    <button
      type="button"
      className="search-here-btn"
      data-testid="search-here"
      aria-busy={searching}
      disabled={searching}
      title={query && !searching ? t("search.searchHere.again", { query: query.label }) : label}
      onClick={() => {
        setSearching(true);
        emit("search-here");
        query?.rerun();
      }}
    >
      {searching ? <span className="spinner" aria-hidden="true" /> : <Icon name="search" />}
      {label}
    </button>
  );
}
