import {
  DATA_PROVIDERS,
  PLACE_SOURCES,
  type DataProvider,
  type PlaceSourceId
} from "@mapos/layer-sdk";
import { useMemo } from "react";
import { getMapStore } from "../store/mapStore";
import { allAttribution } from "../layers/attribution";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Sheet, SheetSection, SettingRow, Toggle } from "./primitives";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId
}: {
  value: T;
  options: { id: T; label: string; disabled?: boolean }[];
  onChange: (next: T) => void;
  testId?: string;
}) {
  return (
    <div className="segmented" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? "active" : ""}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          data-testid={testId ? `${testId}-${option.id}` : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSheet() {
  const store = getMapStore();
  const theme = useMapStoreSnapshot((s) => s.theme);
  const session = useMapStoreSnapshot((s) => s.session);
  const provider = useMapStoreSnapshot((s) => s.dataProvider);
  const poiSources = useMapStoreSnapshot((s) => s.poiSources);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const tracking = useMapStoreSnapshot((s) => s.gameTrackingMode);
  const camera = useMapStoreSnapshot((s) => s.gameCameraMode);
  const avatar = useMapStoreSnapshot((s) => s.avatarStyle);
  // Read once per open: the registry is filled at import time and does not change while running.
  const sources = useMemo(() => allAttribution(), []);

  const providerAvailable = (id: DataProvider) => id === "osm" || capabilities?.mapy !== false;

  const sourceUnavailable = (id: PlaceSourceId, needsKey: boolean) => {
    if (!needsKey) return false;
    if (id === "mapy") return capabilities?.mapy === false;
    if (id === "fsq") return capabilities?.fsq === false;
    return false;
  };

  return (
    <Sheet title="Nastavení" onClose={() => store.closeSheet()} testId="settings-sheet">
      <SheetSection title="Vzhled">
        <SettingRow
          label="Motiv"
          hint="Přepne i podklad mapy"
          control={
            <Segmented
              value={theme}
              options={[
                { id: "light" as const, label: "Světlý" },
                { id: "dark" as const, label: "Tmavý" }
              ]}
              onChange={(next) => store.setTheme(next)}
              testId="theme-segmented"
            />
          }
        />
      </SheetSection>

      <SheetSection
        title="Datový zdroj"
        description="Určuje dlaždice mapy, vyhledávání adres a plánování tras."
      >
        {DATA_PROVIDERS.map((option) => (
          <SettingRow
            key={option.id}
            label={option.label}
            hint={providerAvailable(option.id) ? option.hint : "Server nemá nastavený klíč"}
            control={
              <Toggle
                on={provider === option.id}
                disabled={!providerAvailable(option.id)}
                label={`Zdroj ${option.label}`}
                onChange={() => store.setDataProvider(option.id)}
                testId={`provider-${option.id}`}
              />
            }
          />
        ))}
      </SheetSection>

      <SheetSection
        title="Zdroje míst"
        description="Výsledky se slučují — stejné místo z více zdrojů se zobrazí jednou."
      >
        {PLACE_SOURCES.map((source) => {
          const unavailable = sourceUnavailable(source.id, source.needsKey);
          return (
            <SettingRow
              key={source.id}
              label={source.label}
              hint={unavailable ? "Server nemá nastavený klíč" : source.hint}
              control={
                <Toggle
                  on={Boolean(poiSources[source.id]) && !unavailable}
                  disabled={unavailable}
                  label={`Zdroj ${source.label}`}
                  onChange={(next) => store.setPoiSource(source.id, next)}
                  testId={`poi-source-${source.id}`}
                />
              }
            />
          );
        })}
      </SheetSection>

      <SheetSection title="Hra">
        <SettingRow
          label="Pohyb"
          hint={tracking === "gps" ? "Sleduje reálnou polohu" : "Ovládání klávesami WASD / šipkami"}
          control={
            <Segmented
              value={tracking}
              options={[
                { id: "simulation" as const, label: "Simulace" },
                { id: "gps" as const, label: "GPS" }
              ]}
              onChange={(next) => store.setGameTrackingMode(next)}
              testId="tracking-segmented"
            />
          }
        />
        <SettingRow
          label="Kamera"
          control={
            <Segmented
              value={camera}
              options={[
                { id: "follow" as const, label: "Za hráčem" },
                { id: "top" as const, label: "Shora" }
              ]}
              onChange={(next) => store.setGameCameraMode(next)}
              testId="camera-segmented"
            />
          }
        />
        <SettingRow
          label="Avatar"
          control={
            <Segmented
              value={avatar}
              options={[
                { id: "cube" as const, label: "Kostka" },
                { id: "aavegotchi" as const, label: "Aavegotchi" }
              ]}
              onChange={(next) => store.setAvatarStyle(next)}
              testId="avatar-segmented"
            />
          }
        />
      </SheetSection>

      <SheetSection title="Účet">
        <SettingRow
          label={session ? session.displayName : "Host"}
          hint={
            session
              ? session.email
              : "Postup se ukládá lokálně. Přihlášením ho přeneseš mezi zařízeními."
          }
          control={<span className="setting-row-value">{session ? "Odhlásit" : "Přihlásit"}</span>}
          onClick={() => store.openSheet("auth")}
          testId="settings-account"
        />
      </SheetSection>

      <SheetSection title="O aplikaci">
        <p className="meta">MapOS v3 — mapový operační systém.</p>
        <details className="attribution-list" data-testid="attribution-list">
          <summary>Zdroje dat a licence ({sources.length})</summary>
          <ul>
            {sources.map((source) => (
              <li key={`${source.usedBy}:${source.label}`}>
                <span className="attribution-used-by">{source.usedBy}</span>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}
                {source.license && <span className="attribution-license">{source.license}</span>}
              </li>
            ))}
          </ul>
        </details>
        {capabilities && (
          <p className="meta">
            AI/CML:{" "}
            {capabilities.cml
              ? `zapnuto (${capabilities.cmlProvider})`
              : "vypnuto — použijí se nouzové popisky"}
          </p>
        )}
      </SheetSection>
    </Sheet>
  );
}
