import type { ServerCapabilities } from "@mapos/layer-sdk";
import { useMemo, type ReactNode } from "react";
import { t } from "../i18n/cs";
import { allAttribution } from "../layers/attribution";
import { createRecentSearchRepository } from "../search/recentSearches";
import { SettingsUiRegistry } from "../settings/registry";
import type { UserPreferences } from "../settings/preferences";
import { getMapStore, type MapStore, type UserSession } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Accordion, Button, Chip, InfoTip, SegmentedButton, Switch } from "./kit";
import { Sheet } from "./primitives";

/** One settings row: label, optional InfoTip, control.
 *
 *  The hint used to be a grey paragraph under every row, which is exactly the clutter §21.1
 *  removes — three sentences of explanation for a two-state switch. The explanation now lives
 *  behind the info icon, so the row is one line and the drawer scans as a list.
 */
function Row({
  label,
  info,
  control,
  onClick,
  value,
  testId
}: {
  label: string;
  info?: ReactNode;
  control?: ReactNode;
  onClick?: () => void;
  /** Right-aligned text. With `onClick` it becomes the label of the row's action button,
   *  otherwise it is a read-only value. */
  value?: string;
  testId?: string;
}) {
  return (
    <div className="settings-row" data-testid={onClick ? undefined : testId}>
      <span className="settings-row-label">{label}</span>
      {/* The InfoTip is a button, so the row itself must not be one — a nested button is
          invalid HTML and browsers resolve it by dropping the inner control. */}
      {info && <InfoTip title={label}>{info}</InfoTip>}
      {onClick ? (
        <Button variant="text" size="sm" onClick={onClick} testId={testId}>
          {value ?? t("action.open")}
        </Button>
      ) : (
        <>
          {value && <span className="settings-row-value">{value}</span>}
          {control}
        </>
      )}
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
    title: t("settings.appearance"),
    icon: "light_mode",
    order: 10
  })
  .registerSection({ id: "map", title: "Mapa", icon: "map", order: 20 })
  .registerSection({ id: "account", title: t("settings.account"), icon: "person", order: 30 })
  .registerSection({ id: "ai", title: t("ai.title"), icon: "auto_awesome", order: 40 })
  .registerSection({ id: "about", title: t("settings.about"), icon: "info", order: 50 })
  .register({
    id: "theme",
    sectionId: "appearance",
    order: 10,
    render: ({ store, preferences }) => (
      <Row
        label="Motiv"
        info="Podle systému sleduje vzhled zařízení a přepne i tmavé dvojče mapového podkladu."
        testId="settings-theme"
        control={
          <SegmentedButton
            value={preferences.theme}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "light", label: t("settings.theme.light") },
              { value: "dark", label: t("settings.theme.dark") }
            ]}
            onChange={(next) => store.setPreference("theme", next)}
            size="sm"
            ariaLabel="Motiv aplikace"
            testId="theme-segmented"
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
      <Row
        label="Hustota"
        info="Kompaktní režim ukáže více ovládacích prvků, dotykové cíle zůstanou stejně velké."
        testId="settings-density"
        control={
          <SegmentedButton
            value={preferences.density}
            options={[
              { value: "comfortable", label: "Komfortní" },
              { value: "compact", label: "Kompaktní" }
            ]}
            onChange={(next) => store.setPreference("density", next)}
            size="sm"
            ariaLabel="Hustota rozhraní"
            testId="density-segmented"
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
      <Row
        label="Jazyk"
        info="English je připravené v registru textů; úplný překlad ještě není vydaný."
        testId="settings-locale"
        control={
          <SegmentedButton
            value={preferences.locale}
            options={[
              { value: "cs", label: "Čeština" },
              { value: "en", label: "English", disabled: true }
            ]}
            onChange={(next) => store.setPreference("locale", next)}
            size="sm"
            ariaLabel="Jazyk aplikace"
            testId="locale-segmented"
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
      <Row
        label={t("settings.units")}
        testId="settings-units"
        control={
          <SegmentedButton
            value={preferences.units}
            options={[
              { value: "metric", label: "Kilometry" },
              { value: "imperial", label: "Míle" }
            ]}
            onChange={(next) => store.setPreference("units", next)}
            size="sm"
            ariaLabel="Jednotky vzdálenosti"
            testId="units-segmented"
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
      <Row
        label="Animace přeletů"
        testId="settings-fly-animations"
        control={
          <Switch
            checked={preferences.flyAnimations}
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
      <Row
        label={t("search.searchHere")}
        info="Po posunu mapy nabídne ruční obnovení dat, aby se během tažení neposílaly dotazy."
        testId="settings-search-here"
        control={
          <Switch
            checked={preferences.showSearchHere}
            label={t("search.searchHere")}
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
      <Row
        label={session ? session.displayName : t("personal.guest")}
        info={
          session?.isGuest
            ? "Anonymní profil je uložený v tomto prohlížeči. Uložením účtu ho přeneseš i jinam."
            : session
              ? session.email
              : "Postup se ukládá lokálně. Přihlášením ho přeneseš mezi zařízeními."
        }
        value={session?.isGuest ? "Uložit účet" : session ? "Spravovat" : t("personal.signIn")}
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
      <Row
        label="Export a smazání dat"
        info="Stáhne přenositelný archiv tvých míst, plánů a vrstev, nebo otevře potvrzení smazání účtu."
        value={t("action.open")}
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
      <Row
        label="AI funkce"
        info="Vypnutí skryje AI hledání a konverzace. Mapa, geokódování i trasy fungují dál."
        testId="settings-ai-enabled"
        control={
          <Switch
            checked={preferences.aiEnabled}
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
      <Row
        label="Automatický souhrn u míst"
        info="Výchozí stav je vypnuto, aby se na mobilních datech nic neposílalo bez vyžádání."
        testId="settings-ai-auto-summary"
        control={
          <Switch
            checked={preferences.aiEnabled && preferences.aiAutoSummary}
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
    id: "ai-history",
    sectionId: "ai",
    order: 30,
    render: ({ store }) => (
      <Row
        label="Historie dotazů na AI"
        info="Uložené dotazy zůstávají jen v tomto prohlížeči. Smazání je okamžité a nevratné."
        testId="settings-ai-history"
        control={
          <Button
            variant="text"
            size="sm"
            testId="ai-history-clear"
            onClick={() => {
              if (typeof window !== "undefined") {
                createRecentSearchRepository(window.localStorage).clear();
              }
              store.showToast("Historie dotazů smazaná");
            }}
          >
            {t("action.delete")}
          </Button>
        }
      />
    )
  })
  .register({
    id: "ai-provider",
    sectionId: "ai",
    order: 40,
    render: ({ capabilities }) => (
      <Row
        label="Kde AI běží"
        info="Model volí server podle dostupných klíčů a zátěže. Klíč se nikdy neposílá do prohlížeče."
        testId="settings-ai-provider"
        control={
          <Chip
            label={
              capabilities?.cml
                ? "Ollama Cloud · rychlý a silný model přes server"
                : "deterministický režim bez modelu"
            }
          />
        }
      />
    )
  })
  .register({
    id: "version",
    sectionId: "about",
    order: 10,
    render: ({ capabilities }) => (
      <Row
        label="MapOS v20 · otevřený mapový operační systém"
        testId="settings-version"
        control={<Chip label={capabilities ? "server připojen" : "offline"} />}
      />
    )
  })
  .register({
    id: "active-providers",
    sectionId: "about",
    order: 20,
    render: ({ capabilities }) => (
      <Row
        label="Aktivní poskytovatelé"
        info="Poskytovatele geokódování a tras volí server podle dostupných klíčů. Tady je jen vidíš."
        value={capabilities?.mapy ? "Mapy.com + OSM + OSRM" : "OSM + OSRM"}
        testId="settings-active-providers"
      />
    )
  })
  .register({
    id: "ai-shared-data",
    sectionId: "about",
    order: 30,
    render: () => (
      <Row
        label={t("legal.dataShared")}
        info={t("ai.consent.body")}
        value="AI"
        testId="settings-ai-shared"
      />
    )
  })
  .register({
    id: "attribution",
    sectionId: "about",
    order: 40,
    render: ({ sources }) => (
      <Accordion
        testId="attribution-list"
        sections={[
          {
            id: "sources",
            title: "Zdroje dat a licence",
            count: sources.length,
            children: (
              <ul className="settings-attribution">
                {/* A layer can cite the same provider twice (tiles and terms, say), so the pair
                    of names is not unique — only the position in the aggregated list is. */}
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
                    {source.license && (
                      <span className="attribution-license">{source.license}</span>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        ]}
      />
    )
  })
  .register({
    id: "creator-docs",
    sectionId: "about",
    order: 50,
    render: () => (
      <Row
        label="Dokumentace pro tvůrce vrstev"
        info="Layer SDK v2, manifesty, příklady a migrační pravidla jsou součástí repozitáře."
        value="SDK v2"
        testId="settings-creator-docs"
      />
    )
  });

/** Compatibility shell for `VITE_APP_SHELL_V2=0`; removed with the legacy shell (§6). */
export function SettingsSheet() {
  const store = getMapStore();
  return (
    <Sheet title={t("settings.title")} onClose={() => store.closeSheet()} testId="settings-sheet">
      <SettingsContent />
    </Sheet>
  );
}

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
    <div className="settings-drawer" data-testid="settings-registry">
      {registry.list().map((section) => (
        <section
          className="settings-section"
          key={section.id}
          data-settings-section={section.id}
          aria-label={section.title}
        >
          <h3 className="settings-section-title">
            <span className="kit-eyebrow">{section.title}</span>
          </h3>
          {section.entries.map((entry) => (
            <div key={entry.id} data-setting-id={entry.id}>
              {entry.render(context)}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
