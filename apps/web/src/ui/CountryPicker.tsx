import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCountriesSortedCs,
  getCountryNameCs,
  getCountrySearchIndex,
  normalizeSearchText
} from "../lib/countries";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";

function flagUrl(code: string) {
  if (code === "ALL") return null;
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
}

export function CountryPicker({ compact = false }: { compact?: boolean }) {
  const store = getMapStore();
  const countryCode = useMapStoreSnapshot((s) => s.countryCode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => {
    const all = [{ code: "ALL", name: "Všechny země" }, ...getCountriesSortedCs()];
    const needle = normalizeSearchText(query);
    if (!needle) return all.slice(0, 80);
    return all.filter((c) => getCountrySearchIndex(c.code, c.name).includes(needle)).slice(0, 40);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const label = getCountryNameCs(countryCode);
  const flag = flagUrl(countryCode);

  return (
    <div
      className={`country-picker ${compact ? "compact" : ""}`}
      ref={ref}
      data-testid="country-picker"
    >
      <button
        type="button"
        className="country-picker-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Vybrat zemi"
      >
        {flag ? (
          <img src={flag} alt="" className="country-flag" />
        ) : (
          <span className="country-flag-all">🌍</span>
        )}
        {!compact && <span className="country-label">{label}</span>}
        <span className="country-chevron">▾</span>
      </button>
      {open && (
        <div className="country-picker-menu">
          <input
            className="country-search"
            placeholder="Hledat zemi…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="country-list">
            {countries.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`country-item ${c.code === countryCode ? "active" : ""}`}
                onClick={() => {
                  store.setCountry(c.code);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {c.code === "ALL" ? (
                  <span className="country-flag-all">🌍</span>
                ) : (
                  <img src={flagUrl(c.code)!} alt="" className="country-flag" />
                )}
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
