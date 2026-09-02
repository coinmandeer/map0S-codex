import type { ServerCapabilities } from "@mapos/layer-sdk";
import { useMemo, type ReactNode } from "react";
import { allAttribution } from "../layers/attribution";
import { SettingsUiRegistry } from "../settings/registry";
import type { UserPreferences } from "../settings/preferences";
import { getMapStore, type MapStore, type UserSession } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Icon, SettingRow, Sheet, Toggle, type IconName } from "./primitives";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
  label
}: {
  value: T;
  options: { id: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (next: T) => void;
  testId?: string;
  label: string;
}) {
  return (
    <div className="segmented" data-testid={testId} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? "active" : ""}
          disabled={option.disabled}
          title={option.title}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          data-testid={testId ? `${testId}-${option.id}` : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type Attribution = ReturnType<typeof allAttribution>;

interface SettingsContext {
  store: MapStore;
  preferences: UserPreferences;
  session: UserSession | null;
  capabilities: ServerCapabilities | null;
  sources: Attribution;
}

const registry = new SettingsUiRegistry<SettingsContext, ReactNode>()
  .registerSection({
    id: "appearance",
    title: "Vzhled",
    description: "Jak má MapOS působit na tomto zařízení.",
    icon: "sparkles",
    order: 10
  })
  .registerSection({
    id: "map",
    title: "Mapa",
    description: "Jednotky a chování mapy. Podklady a vrstvy mají vlastní panely.",
    icon: "tiles",
    order: 20
  })
  .registerSection({
    id: "account",
    title: "Účet",
    description: "Profil, připojené identity a přenositelnost dat.",
    icon: "user",
    order: 30
  })
  .registerSection({
    id: "ai",
    title: "AI",
    description: "AI je volitelná a nic v mapě nezmění bez potvrzení.",
    icon: "sparkles",
    order: 40
  })
  .registerSection({
    id: "about",
    title: "O aplikaci",
    description: "Verze, zdroje dat a podklady pro tvůrce vrstev.",
    icon: "info",
    order: 50
  })
  .register({
    id: "theme",
    sectionId: "appearance",
    order: 10,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Motiv"
        hint="Systém sleduje vzhled zařízení a přepne i dvojče mapového podkladu."
        testId="settings-theme"
        control={
          <Segmented
            value={preferences.theme}
            options={[
              { id: "system", label: "Systém" },
              { id: "light", label: "Světlý" },
              { id: "dark", label: "Tmavý" }
            ]}
            onChange={(next) => store.setPreference("theme", next)}
            testId="theme-segmented"
            label="Motiv aplikace"
          />
        }
      />
    )
  })
  .register({
    id: "density",
    sectionId: "appearance",
    order: 20,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Hustota"
        hint="Kompaktní režim ukáže více ovládacích prvků bez zmenšení dotykových cílů."
        testId="settings-density"
        control={
          <Segmented
            value={preferences.density}
            options={[
              { id: "comfortable", label: "Komfortní" },
              { id: "compact", label: "Kompaktní" }
            ]}
            onChange={(next) => store.setPreference("density", next)}
            testId="density-segmented"
            label="Hustota rozhraní"
          />
        }
      />
    )
  })
  .register({
    id: "locale",
    sectionId: "appearance",
    order: 30,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Jazyk"
        hint="English je připravené v registru; úplný překlad textů ještě není vydaný."
        testId="settings-locale"
        control={
          <Segmented
            value={preferences.locale}
            options={[
              { id: "cs", label: "Čeština" },
              { id: "en", label: "English", disabled: true, title: "Překlad se připravuje" }
            ]}
            onChange={(next) => store.setPreference("locale", next)}
            testId="locale-segmented"
            label="Jazyk aplikace"
          />
        }
      />
    )
  })
  .register({
    id: "units",
    sectionId: "map",
    order: 10,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Jednotky vzdálenosti"
        hint="Použijí se v hledání, trasách a detailech míst."
        testId="settings-units"
        control={
          <Segmented
            value={preferences.units}
            options={[
              { id: "metric", label: "km" },
              { id: "imperial", label: "mi" }
            ]}
            onChange={(next) => store.setPreference("units", next)}
            testId="units-segmented"
            label="Jednotky vzdálenosti"
          />
        }
      />
    )
  })
  .register({
    id: "fly-animations",
    sectionId: "map",
    order: 20,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Animace přeletů"
        hint="Plynulý přesun při otevření výsledku nebo oblasti."
        testId="settings-fly-animations"
        control={
          <Toggle
            on={preferences.flyAnimations}
            label="Animace přeletů"
            onChange={(next) => store.setPreference("flyAnimations", next)}
            testId="fly-animations-toggle"
          />
        }
      />
    )
  })
  .register({
    id: "search-here",
    sectionId: "map",
    order: 30,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Zobrazovat ‚Hledat v této oblasti‘"
        hint="Po posunu mapy nabídne ruční obnovení dat bez zbytečných dotazů během tažení."
        testId="settings-search-here"
        control={
          <Toggle
            on={preferences.showSearchHere}
            label="Zobrazovat Hledat v této oblasti"
            onChange={(next) => store.setPreference("showSearchHere", next)}
            testId="search-here-toggle"
          />
        }
      />
    )
  })
  .register({
    id: "profile",
    sectionId: "account",
    order: 10,
    render: ({ store, session }) => (
      <SettingRow
        label={session ? session.displayName : "Host"}
        hint={
          session?.isGuest
            ? "Anonymní profil je uložený v tomto prohlížeči. Uložením účtu ho přeneseš i jinam."
            : session
              ? session.email
              : "Postup se ukládá lokálně. Přihlášením ho přeneseš mezi zařízeními."
        }
        control={
          <span className="setting-row-value">
            {session?.isGuest ? "Uložit účet" : session ? "Spravovat" : "Přihlásit"}
          </span>
        }
        onClick={() => store.openSheet("auth")}
        testId="settings-account"
      />
    )
  })
  .register({
    id: "data-rights",
    sectionId: "account",
    order: 20,
    render: ({ store }) => (
      <SettingRow
        label="Export a smazání dat"
        hint="Stáhni přenositelný archiv nebo otevři bezpečné potvrzení smazání účtu."
        control={<span className="setting-row-value">Otevřít</span>}
        onClick={() => store.openSheet("auth")}
        testId="settings-data-rights"
      />
    )
  })
  .register({
    id: "ai-enabled",
    sectionId: "ai",
    order: 10,
    render: ({ store, preferences }) => (
      <SettingRow
        label="AI funkce"
        hint="Vypnutí skryje AI hledání a konverzace; běžná mapa, geokódování i trasy zůstanou."
        testId="settings-ai-enabled"
        control={
          <Toggle
            on={preferences.aiEnabled}
            label="AI funkce"
            onChange={(next) => store.setPreference("aiEnabled", next)}
            testId="ai-enabled-toggle"
          />
        }
      />
    )
  })
  .register({
    id: "ai-auto-summary",
    sectionId: "ai",
    order: 20,
    render: ({ store, preferences }) => (
      <SettingRow
        label="Automatický AI souhrn míst"
        hint="Ve výchozím stavu vypnuto, aby se na mobilních datech nic neposílalo bez vyžádání."
        testId="settings-ai-auto-summary"
        control={
          <Toggle
            on={preferences.aiEnabled && preferences.aiAutoSummary}
            disabled={!preferences.aiEnabled}
            label="Automaticky načítat AI souhrn u míst"
            onChange={(next) => store.setPreference("aiAutoSummary", next)}
            testId="ai-auto-summary-toggle"
          />
        }
      />
    )
  })
  .register({
    id: "ai-provider",
    sectionId: "ai",
    order: 30,
    render: ({ capabilities }) => (
      <SettingRow
        label="Aktivní AI poskytovatel"
        hint="Volí ho server; klíč se nikdy neposílá do prohlížeče."
        testId="settings-ai-provider"
        control={
          <span className="settings-status-chip">
            {capabilities?.cml ? (capabilities.cmlProvider ?? "server") : "deterministický režim"}
          </span>
        }
      />
    )
  })
  .register({
    id: "version",
    sectionId: "about",
    order: 10,
    render: ({ capabilities }) => (
      <SettingRow
        label="MapOS v20"
        hint="Otevřený mapový operační systém · prototyp"
        control={
          <span className={`settings-status-chip ${capabilities ? "is-live" : ""}`}>
            {capabilities ? "server připojen" : "offline"}
          </span>
        }
        testId="settings-version"
      />
    )
  })
  .register({
    id: "active-providers",
    sectionId: "about",
    order: 20,
    render: ({ capabilities }) => (
      <SettingRow
        label="Aktivní poskytovatelé"
        hint="Jen informace; poskytovatele geokódování a tras volí server podle dostupnosti."
        control={
          <span className="setting-row-value">
            {capabilities?.mapy ? "Mapy.com + OSM + OSRM" : "OSM + OSRM"}
          </span>
        }
        testId="settings-active-providers"
      />
    )
  })
  .register({
    id: "attribution",
    sectionId: "about",
    order: 30,
    render: ({ sources }) => (
      <details className="attribution-list settings-attribution" data-testid="attribution-list">
        <summary>
          <span>
            <strong>Zdroje dat a licence</strong>
            <small>{sources.length} zdrojů · licence jsou informace, ne datová brána</small>
          </span>
          <span className="setting-row-value">Rozbalit</span>
        </summary>
        <ul>
          {/* A layer can cite the same provider twice (tiles and terms, say), so the pair of
              names is not unique — only the position in the aggregated list is. */}
          {sources.map((source, index) => (
            <li key={`${index}:${source.usedBy}:${source.label}`}>
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
    )
  })
  .register({
    id: "creator-docs",
    sectionId: "about",
    order: 40,
    render: () => (
      <SettingRow
        label="Dokumentace pro tvůrce vrstev"
        hint="Layer SDK v2, manifesty, příklady a migrační pravidla jsou součástí repozitáře."
        control={<span className="setting-row-value">SDK v2</span>}
        testId="settings-creator-docs"
      />
    )
  });

export function SettingsSheet() {
  const store = getMapStore();
  return (
    <Sheet title="Nastavení" onClose={() => store.closeSheet()} testId="settings-sheet">
      <SettingsContent />
    </Sheet>
  );
}

/** Shared body used by both the compatibility Sheet and the AppShell right utility drawer. */
export function SettingsContent() {
  const store = getMapStore();
  const preferences = useMapStoreSnapshot((state) => state.preferences);
  const session = useMapStoreSnapshot((state) => state.session);
  const capabilities = useMapStoreSnapshot((state) => state.capabilities);
  const sources = useMemo(() => allAttribution(), []);
  const context = useMemo(
    () => ({ store, preferences, session, capabilities, sources }),
    [capabilities, preferences, session, sources, store]
  );

  return (
    <div className="settings-redesign" data-testid="settings-registry">
      <section className="settings-overview" aria-label="Přehled nastavení">
        <span className="settings-overview-icon" aria-hidden="true">
          <Icon name="settings" size={24} />
        </span>
        <div>
          <p className="settings-overview-eyebrow">MapOS podle tebe</p>
          <strong>Jedno místo pro vzhled, mapu, účet a AI</strong>
          <div className="settings-overview-chips" aria-label="Aktivní volby">
            <span>
              {preferences.theme === "system" ? "Motiv zařízení" : `Motiv ${preferences.theme}`}
            </span>
            <span>{preferences.units === "metric" ? "Kilometry" : "Míle"}</span>
            <span>{preferences.aiEnabled ? "AI zapnuto" : "AI vypnuto"}</span>
          </div>
        </div>
      </section>

      {registry.list().map((section) => (
        <section
          className="settings-section-card"
          key={section.id}
          data-settings-section={section.id}
        >
          <header>
            <span className="settings-section-icon" aria-hidden="true">
              <Icon name={section.icon as IconName} size={18} />
            </span>
            <span>
              <strong>{section.title}</strong>
              {section.description && <small>{section.description}</small>}
            </span>
          </header>
          <div className="settings-section-items">
            {section.entries.map((entry) => (
              <div key={entry.id} data-setting-id={entry.id}>
                {entry.render(context)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
