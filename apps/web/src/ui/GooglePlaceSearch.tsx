import { useEffect, useRef, useState } from "react";
import { googleSelectionCoordinates, loadGooglePlaces } from "../search/googlePlaces";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";

export function GooglePlaceSearch({
  query,
  onSelect
}: {
  query: string;
  onSelect: (point: { lng: number; lat: number }) => void;
}) {
  const capabilities = useMapStoreSnapshot((state) => state.capabilities);
  const [requested, setRequested] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const target = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const key =
    capabilities?.googlePlacesUi === true && typeof capabilities.googlePlacesPublicKey === "string"
      ? capabilities.googlePlacesPublicKey
      : "";
  useEffect(() => {
    if (!requested || !key || !target.current) return;
    const container = target.current;
    let cancelled = false;
    setStatus("Načítám Google…");
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus("Google hledání neodpovědělo včas. Použijte běžné hledání.");
    }, 30000);
    void loadGooglePlaces(key)
      .then(() => {
        if (cancelled) return;
        const element = document.createElement("gmp-place-search");
        element.setAttribute("selectable", "");
        const request = document.createElement("gmp-place-text-search-request") as HTMLElement & {
          textQuery: string;
        };
        request.setAttribute("max-result-count", "5");
        // Preserve the official component, including all attribution and links.
        element.append(document.createElement("gmp-place-all-content"), request);
        element.addEventListener("gmp-select", (event) => {
          if (cancelled) return;
          const point = googleSelectionCoordinates(event);
          if (point) select.current(point);
        });
        element.addEventListener("gmp-load", () => {
          clearTimeout(timeout);
          if (!cancelled) setStatus("");
        });
        element.addEventListener("gmp-error", () => {
          clearTimeout(timeout);
          if (!cancelled) setStatus("Google hledání není dostupné. Použijte běžné hledání.");
        });
        container.replaceChildren(element);
        request.textQuery = requested;
      })
      .catch(() => {
        clearTimeout(timeout);
        if (!cancelled) setStatus("Google se nepodařilo načíst. Použijte běžné hledání.");
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      container.replaceChildren();
    };
  }, [requested, key]);
  if (!key || !query.trim()) return null;
  return (
    <section className="command-search-section" aria-label="Google místa">
      <button
        type="button"
        className="search-hit"
        aria-disabled={requested === query.trim()}
        onClick={() => setRequested(query.trim())}
      >
        Dohledat přes Google
      </button>
      {status && <p role="status">{status}</p>}
      <div ref={target} />
    </section>
  );
}
