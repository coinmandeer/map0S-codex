import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import {
  isValidCoordinates,
  LatestRequestRunner,
  resolveLocationIntent,
  type LocationIntent
} from "../../search";

interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
}

export interface StopLocationSelection {
  name: string;
  lng: number;
  lat: number;
}

function validHit(hit: GeoHit): boolean {
  return (
    typeof hit.display_name === "string" &&
    hit.display_name.trim().length > 0 &&
    isValidCoordinates({ lat: Number(hit.lat), lng: Number(hit.lon) })
  );
}

type NetworkLocationIntent = LocationIntent & {
  kind: "address" | "locality" | "poi" | "place";
  query: string;
};

function isNetworkIntent(intent: LocationIntent): intent is NetworkLocationIntent {
  return ["address", "locality", "poi", "place"].includes(intent.kind);
}

function intentType(intent: LocationIntent): string | null {
  if (intent.kind === "coordinates") return "GPS souřadnice";
  if (intent.kind === "address") return "Adresa";
  if (intent.kind === "locality") return "Město nebo region";
  if (intent.kind === "poi") return "Místo / POI";
  if (intent.kind === "place") return "Místo";
  if (intent.kind === "ai") return "AI dotaz";
  if (intent.kind === "invalid") return "Neplatný vstup";
  return null;
}

export function StopLocationInput({
  index,
  name,
  provider,
  aiEnabled,
  aiBusy,
  onNameChange,
  onSelect,
  onAiQuery
}: {
  index: number;
  name: string;
  provider: string;
  aiEnabled: boolean;
  aiBusy: boolean;
  onNameChange(value: string): void;
  onSelect(selection: StopLocationSelection): void;
  onAiQuery(query: string): void;
}) {
  const [query, setQuery] = useState(name);
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [settled, setSettled] = useState(false);
  const requestRunner = useRef(new LatestRequestRunner<GeoHit[]>());
  const listId = `planning-stop-${index}-suggestions`;
  const intent = useMemo(() => resolveLocationIntent(query), [query]);

  useEffect(() => {
    if (!focused) setQuery(name);
  }, [focused, name]);

  useEffect(() => {
    const runner = requestRunner.current;
    // React StrictMode runs effect cleanup once during its development remount check.
    // Cancelling is enough here; disposing would leave the stable ref permanently unusable.
    return () => {
      runner.cancel("component-unmounted");
    };
  }, []);

  useEffect(() => {
    const runner = requestRunner.current;
    setSettled(false);
    if (!focused || !isNetworkIntent(intent) || intent.query.length < 2) {
      runner.cancel("intent-changed");
      setSearching(false);
      setHits([]);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void runner
        .run(async (signal) => {
          const response = await fetch(
            `${API_BASE}/geocode?q=${encodeURIComponent(intent.query)}&provider=${encodeURIComponent(provider)}`,
            { signal }
          );
          if (!response.ok) return [];
          const data = (await response.json()) as { results?: GeoHit[] };
          return (data.results ?? []).filter(validHit).slice(0, 5);
        }, setHits)
        .catch(() => {
          if (mounted) setHits([]);
        })
        .finally(() => {
          if (mounted) {
            setSearching(false);
            setSettled(true);
          }
        });
    }, 300);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      runner.cancel("query-changed");
    };
  }, [focused, intent, provider]);

  const commitName = () => {
    const clean = query.trim().replace(/\s+/g, " ");
    if (clean && clean !== name) onNameChange(clean);
  };

  const selectHit = (hit: GeoHit) => {
    const selection = {
      name: hit.display_name.trim(),
      lng: Number(hit.lon),
      lat: Number(hit.lat)
    };
    setQuery(selection.name);
    setHits([]);
    setFocused(false);
    onSelect(selection);
  };

  const executePrimary = () => {
    if (intent.kind === "coordinates") {
      const selection = {
        name: intent.coordinates.normalized,
        lng: intent.coordinates.lng,
        lat: intent.coordinates.lat
      };
      setQuery(selection.name);
      setFocused(false);
      onSelect(selection);
      return;
    }
    if (intent.kind === "ai" && aiEnabled) {
      onAiQuery(intent.query);
      return;
    }
    if (hits[0]) selectHit(hits[0]);
    else commitName();
  };

  const showMenu =
    focused &&
    query.trim().length > 0 &&
    (intentType(intent) !== null || searching || hits.length > 0);

  return (
    <div
      className="planner-stop-search"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        commitName();
        setFocused(false);
      }}
    >
      <div className="planner-stop-search-control">
        <input
          aria-label={`Název zastávky ${index}`}
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls={listId}
          placeholder={aiEnabled ? "Adresa, město, GPS nebo AI dotaz…" : "Adresa, město nebo GPS…"}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFocused(false);
              event.currentTarget.blur();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              executePrimary();
            }
          }}
        />
        {searching && <span className="spinner" aria-label="Hledám zastávku" />}
        {/* An open question gets its own button in the field, so the AI route is one click and
            not a menu item to find (§4.5). */}
        {intent.kind === "ai" && aiEnabled && (
          <button
            type="button"
            className="planner-stop-ai-button"
            data-testid={`stop-ai-inline-${index}`}
            aria-label={`Zeptat se AI na zastávku ${index}`}
            disabled={aiBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAiQuery(intent.query)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              auto_awesome
            </span>
            <span className="planner-stop-ai-button-label">AI</span>
          </button>
        )}
        {query && (
          <button
            type="button"
            className="planner-stop-clear"
            aria-label={`Vymazat zastávku ${index}`}
            onClick={() => {
              setQuery("");
              setHits([]);
            }}
          >
            ×
          </button>
        )}
      </div>

      {showMenu && (
        <div className="planner-stop-suggestions" id={listId} role="listbox">
          {intent.kind === "coordinates" && (
            <button type="button" role="option" onClick={executePrimary}>
              <strong>Použít GPS</strong>
              <span>{intent.coordinates.normalized}</span>
              <small>Souřadnice · přímo, bez síťového hledání</small>
            </button>
          )}
          {intent.kind === "ai" && aiEnabled && (
            <button
              type="button"
              role="option"
              className="planner-stop-ai-action"
              data-testid={`stop-ai-${index}`}
              disabled={aiBusy}
              onClick={() => onAiQuery(intent.query)}
            >
              <strong>{aiBusy ? "AI hledá…" : "AI hledání"}</strong>
              <span>{intent.query}</span>
              <small>Návrh se nejdřív otevře na mapě a nic nezmění bez potvrzení</small>
            </button>
          )}
          {intent.kind === "ai" && !aiEnabled && (
            <div className="planner-stop-intent">
              <strong>AI je vypnutá</strong>
              <span>Zapnout ji můžeš v Nastavení › AI</span>
            </div>
          )}
          {isNetworkIntent(intent) && (
            <div className="planner-stop-intent">
              <strong>{intentType(intent)}</strong>
              <span>MapOS geokodér</span>
            </div>
          )}
          {hits.map((hit) => (
            <button
              type="button"
              role="option"
              key={`${hit.lat}:${hit.lon}:${hit.display_name}`}
              onClick={() => selectHit(hit)}
            >
              <strong>{hit.display_name}</strong>
              <small>Ověřená poloha · MapOS geokodér</small>
            </button>
          ))}
          {isNetworkIntent(intent) && settled && !searching && hits.length === 0 && (
            <div className="planner-stop-empty" role="status">
              Nic jsme nenašli. Upřesni název, zadej GPS nebo použij výběr na mapě.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
