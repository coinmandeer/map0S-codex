# MapOS — sjednocené vrstvy a podklady: stav fází 2–11

Navazuje na `docs/plans/2026-09-14-unified-layers-phase0-transition.md`. Stav k 2026-09-14 na
větvi `ui-redesign-v3`.

## Fáze 2 — společný box, katalog a Podklady

| Požadavek                                                        | Stav   | Kde                                           |
| ---------------------------------------------------------------- | ------ | --------------------------------------------- |
| Jeden panel Vrstvy / Podklady                                    | hotovo | `ui/shell/RightUtilityDrawer.tsx`             |
| Desktop floating box 362 px, odstup 8 px                         | hotovo | `styles/drawers.css:720`                      |
| Přepnutí záložky / sbalení nemění mapu                           | hotovo | panel jen čte store                           |
| Aktivní seznam + souhrn „vybrané · zapnuté“                      | hotovo | `ui/layers/UnifiedLayers.tsx`                 |
| Řádek: ikona → název → barva → nastavení → přepínač (+ odebrání) | hotovo | `UnifiedLayers.tsx`                           |
| Inline nastavení, jeden otevřený editor                          | hotovo | `settings` stav v `UnifiedLayers`             |
| Aktivní seznam podle pořadí přidání                              | hotovo | `layerOrder` v `UnifiedLayers`                |
| Strukturální překryvy přesunuty z Podkladů do Vrstev             | hotovo | `BasemapsDrawer` je už neobsahuje             |
| Duplicitní plovoucí „Filtry vrstev“ odstraněn                    | hotovo | `MapLayerFilters.tsx` smazán                  |
| Preset: výběr + Save                                             | hotovo | `catalog-preset`, `SavePresetDialog`          |
| Uložení plné konfigurace                                         | hotovo | `captureAppearance` → `UserPreset.appearance` |
| Obnovení překryvů po výměně stylu                                | hotovo | `LayerEngine`/`tileLayer` `ensureLayers`      |
| Mobil: spodní panel, zachování stavu                             | hotovo | `useIsMobile`, `--drawer-w 100%`              |

## Fáze 3 — nová struktura detailu

| Požadavek                                                       | Stav         | Kde                                         |
| --------------------------------------------------------------- | ------------ | ------------------------------------------- |
| Fotografie nahoře, přes šířku                                   | hotovo       | `ui/place/PlaceHero.tsx`                    |
| Identita: název + typ + lokalita                                | hotovo       | `PinDetail.tsx` `detail-place-name`         |
| Čtyři akce Trasa / Do plánu / Uložit / Sdílet                   | hotovo       | `PlaceActionRow`                            |
| INFO / MÉDIA / KOMUNITA                                         | hotovo       | `info/InfoEngine.tsx` (`UnifiedInfoEngine`) |
| Šipky přes fotografii mění fotografii                           | **doplněno** | `place-hero-prev/next`                      |
| Bez fotografie nízká neutrální hlavička                         | hotovo       | `place-hero-plain`                          |
| Autor a původ u média                                           | hotovo       | `place-hero-credit`, media figcaption       |
| Přepnutí záložek zachová obsah                                  | hotovo       | `keepMounted` v `Tabs`, `visited`           |
| Změna místa zruší zastaralé požadavky                           | hotovo       | `AbortController` + `key` na pin            |
| INFO v přesném pořadí 1–11                                      | hotovo       | `InfoEngine.tsx` `info` blok                |
| Statistiky a Počasí výchozně rozbalené                          | hotovo       | `DetailDisclosure initialOpen`              |
| Otevřít v: Google/Mapy/Mapillary/Wiki/Geocaching/Komoot/Booking | hotovo       | `detail-open-in`                            |

## Fáze 4 — statistiky mimo levý panel

| Požadavek                                    | Stav         | Kde                                       |
| -------------------------------------------- | ------------ | ----------------------------------------- |
| Explorer je samostatný dialog                | hotovo       | `statistics/StatisticsDialog.tsx`         |
| Vlastní stav mimo levý panel                 | hotovo       | `statistics/explorerStore.ts`             |
| Klik na hodnotu/ukazatel otevře dialog       | hotovo       | `ThemeValueCard`, `PlaceDetailSections`   |
| Zapnutí vrstvy nepřepíše levý panel ani mapu | hotovo       | `activateStatistic` nechává `leftContext` |
| Období, rozlišení, zdroje, tabulka, export   | hotovo       | `StatisticsExplorer.tsx`                  |
| Odstraněn duplicitní import exploreru        | **doplněno** | `DiscoverPanel.tsx`                       |

## Fáze 5 — datový základ a poskytovatelé

| Požadavek                                           | Stav         | Kde                                         |
| --------------------------------------------------- | ------------ | ------------------------------------------- |
| MapTiler veřejná konfigurace klientovi              | hotovo       | `config.ts` capabilities, `basemapStyle.ts` |
| MapTiler přímo klientem, bez serverové cache obsahu | hotovo       | `tilesFor` staví `api.maptiler.com` URL     |
| Mapillary token jen na serveru                      | hotovo       | `panoramaService`, `keyed.ts`               |
| Token se neobjevuje v URL záznamech                 | **doplněno** | token v `Authorization` hlavičce            |
| Stavy dostupnosti (chybí klíč / limit / chyba)      | hotovo       | `requiresCapability` + `sourceStatus`       |
| Bez klíčů funkční otevřený základ                   | hotovo       | keyless vrstvy a podklady                   |

## Fáze 6 — Mapillary

| Požadavek                                            | Stav         | Kde                                                    |
| ---------------------------------------------------- | ------------ | ------------------------------------------------------ |
| Identita vrstvy Snímky ulic                          | hotovo       | `dataLayers.ts` `mapillary`                            |
| Pokrytí a jednotlivé fotografie                      | hotovo       | `keyed.ts`                                             |
| Datum a filtr 360°                                   | **doplněno** | `pano` facet + `is_pano` v `keyed.ts`                  |
| Sekvence                                             | **doplněno** | `sequence` v `panoramaService`                         |
| Prohlížeč podporuje sekvenci                         | **doplněno** | `panorama-sequence` v `embedPanels.tsx`                |
| Značky/objekty (`mapillary-signs/traffic/furniture`) | chybí        | řádky katalogu hlásí „zdroj zatím není“                |
| Panoramax                                            | hotovo       | vrstva `panoramax` + panel `panoramax` (STAC, keyless) |

## Fáze 7 — MapTiler a počasí

| Požadavek                   | Stav   | Kde                                   |
| --------------------------- | ------ | ------------------------------------- |
| Jedna vrstva Počasí         | hotovo | `weather`                             |
| Radar, veličiny, časová osa | hotovo | `layers/weather/*`, `WeatherTimeline` |
| Zdroj Automaticky / model   | hotovo | `weather/controls.ts` modely          |
| MapTiler plošné počasí      | chybí  | vyžaduje MapTiler Weather klíč        |

## Družice (Fáze 9) — implementace

- **Zdroj:** CelesTrak GP jako moderní OMM JSON (`gp.php?GROUP=…&FORMAT=json`), nikdy
  pětimístná TLE čísla. Id je skutečné NORAD číslo.
- **Propagace:** `satellite.js` 6.0.2 (čisté JS; verze 7.x je WASM a rozbíjí browser build),
  `json2satrec` + `propagate` + `eciToGeodetic` v prohlížeči.
- **Reflexe na mapě:** jednosekundový lokální tik přepočítá pozice. Vykreslí se
  **ground track** (skutečná budoucí dráha) a na ní **aktuální poloha**; track se láme na
  antimeridiánu, aby nepřekreslil celou mapu.
- **Filtrování:** facet `categories` s 25 kategoriemi (Stanice, Starlink, OneWeb, Navigace GPS/
  GLONASS/Galileo/BeiDou/GNSS, Geostacionární, Počasí, Snímkování Země, Planet, Iridium,
  Globalstar, Komunikační, Věda, Vojenské, Záchranná služba, Relé, Amatérské, Viditelné okem,
  CubeSaty, Technologické, Výukové, Radarové), výchozí `stations`.
- **Výkon:** track se přepočítá jen při změně filtrů a pak každou minutu; každou sekundu se
  aktualizují pouze tečky (jedna SGP4 evaluace na družici). Strop 120/kategorie a 600 celkem.
- **Poctivost:** poloha je označená jako **vypočtená** (SGP4) s epochou prvků; API vrací prvky,
  ne pozice. Nedostupná kategorie je `unavailable`, ne prázdná.
- **Servery:** `GET /satellites/elements` a `/satellites/categories` na obou serverech (keyless).
- **Testy:** reálná SGP4 propagace ISS, lámání tracku, parser OMM, nedostupnost kategorie.

## Overture (Fáze 9) — implementace

- **Proč ne globální dlaždice:** veřejné Overture PMTiles jsou pro inspekci dat, ne pro mapovou
  kartografii — jediná dlaždice z14 nad centrem Prahy má ~8,5 MB a přes 10 000 míst. Živé
  vykreslování by zaseklo mapu, proto se nepoužívají.
- **Řešení dle plánu („vlastní omezený import"):** `scripts/import-overture.mjs` přečte přes
  DuckDB jen zvolený bounding box z globálního GeoParquet (`spatial` + `httpfs`, predikát se
  pushuje do scanu) a `tippecanoe` z něj vytvoří malý PMTiles archiv. Ověřeno: Praha
  14.40–14.45 × 50.06–50.10 → **0,21 MB**.
- **Vrstvy:** `overture-places` a `overture-buildings` čtou `pmtiles:///overture/*.pmtiles`
  z vlastního originu, ne z Overture. Barvy odpovídají skutečným hodnotám taxonomie
  (`food_and_drink`, `shopping`, `services_and_business`, …).
- **Bezpečnost vůči zbytku aplikace:** obě vrstvy jsou gated na `requiresCapability: "overture"`,
  takže se v katalogu **vůbec neobjeví**, dokud import neexistuje a `OVERTURE_ENABLED=1`.
  Nic se nenačítá, dokud vrstvu nezapnete, a nic se neposílá na cizí host.

## Fáze 8 — populace a osídlení

**Číselná část hotová:** `GET /info/population/area` (SDK `populationAreaService.ts`) počítá součet
populace pro nakreslenou oblast přes otevřené WorldPop REST API (`wpgppop`, keyless). Vrací
`people` za polygon, rok, rozlišení a citaci; asynchronní úloha je poctivě `ready`/`pending`/
`unavailable`, nikdy nula. Lokální statistika v detailu zobrazuje kartu
„Populace v okolí (součet rastru)" odděleně od administrativních průměrů.

**Rastrová část chybí:** GHSL (GHS-POP/SMOD/BUILT) nemá ověřený keyless tile/WMS endpoint — jen
hromadné ke stažení, což je samostatný import. Vektorový choropleth (`theme-population`) zůstává;
samostatná rastrová vrstva se nepředstírá a řádek neexistuje.

## Fáze 9 — nové řádky

| Řádek                      | Stav            | Poznámka                                                       |
| -------------------------- | --------------- | -------------------------------------------------------------- |
| Golf                       | **doplněno**    | nová POI kategorie `golf` (`leisure=golf_course`)              |
| Letecká infrastruktura     | **doplněno**    | POI `airport`, `helipad` pod jedním řádkem                     |
| Sněhová pokrývka           | **doplněno**    | NASA GIBS MODIS Terra Snow Cover, datovaný                     |
| Snímky ulic / Panoramax    | hotovo          | Mapillary aj samostatná vrstva Panoramax (STAC, keyless)       |
| Silnice a dálnice          | hotovo          | `roads` — OpenMapTiles `transportation` z OpenFreeMap, keyless |
| Družice (CelesTrak/SGP4)   | hotovo          | `satellites` — CelesTrak OMM + SGP4 v prohlížeči, kategorie    |
| Povodně (modelový průtok)  | chybí           | existují jen EONET záznamy                                     |
| Hloubka vody               | hotovo          | `emodnet-bathymetry` (jen mořská batymetrie)                   |
| Overture places/buildings  | hotovo (import) | vlastní omezený PMTiles výřez; `scripts/import-overture.mjs`   |
| WorldCover krajinný pokryv | hotovo          | `land-cover` — NASA GIBS MODIS IGBP, roční, keyless            |
| Marine/pobřežní            | částečně        | `openseamap` je; chybí vlnobití/proudy                         |

## Fáze 10 — datové doplnění detailu

| Požadavek                               | Stav         | Kde                                               |
| --------------------------------------- | ------------ | ------------------------------------------------- |
| Panorama a média z podporovaných zdrojů | hotovo       | `InfoEngine`, `embedPanels`, Panoramax panel      |
| Měsíční teploty 1991–2020               | **doplněno** | `api/services/climateService.ts` (ERA5)           |
| Klimatické agregace per modelová buňka  | hotovo       | cache na 30 dní v `fetchJson`                     |
| Lokální statistika na oblast            | hotovo       | `LocalStatistics`                                 |
| Nadcházející události                   | hotovo       | `NearbyMapPlaces events`                          |
| Seznam míst                             | hotovo       | `NearbyMapPlaces`                                 |
| Questy na místo/oblast v detailu        | **doplněno** | `GET /game/quests/near` + sekce Questy v KOMUNITĚ |
| Recenze/komentáře                       | hotovo       | `PlaceSocial`                                     |

## Detail místa — dotažení podle wireframů (vlna 2)

| Prvek wireframu                             | Stav         | Kde                                          |
| ------------------------------------------- | ------------ | -------------------------------------------- |
| Hodnocení / Recenze / Questy nahoře         | **doplněno** | `PlaceSocial` `.place-social-stats`          |
| Dvě akce Přidat recenzi / Přidat quest      | **doplněno** | `.place-social-actions`                      |
| Samostatné Recenze / Questy / Diskuze       | **doplněno** | tři `.place-social-section`                  |
| Nula recenzí = „Zatím bez hodnocení“        | **doplněno** | `polish.noRating`                            |
| Přihlášení až u akce, která ho potřebuje    | **doplněno** | `requireSession()` v `PlaceSocial`           |
| Quest navázaný na místo (stabilní identita) | **doplněno** | `emit("open-world-quest")` → `QuestComposer` |
| MÉDIA dvousloupcová galerie                 | **doplněno** | `detail-media-grid` `repeat(2, …)`           |
| Skutečné poměry stran média                 | **doplněno** | `object-fit: contain`, `height: auto`        |
| Video se nespustí automaticky               | hotovo       | `preload="metadata"`                         |
| Soubory ke stažení                          | **doplněno** | `DetailDownloads`                            |
| Panorama stejná data v INFO i MÉDIÍCH       | hotovo       | `embedPanels`                                |

## Fáze 11 — integrace a ověření

- **Typy:** `@mapos/layer-sdk`, `@mapos/api`, `@mapos/web` procházejí.
- **Testy:** layer-sdk 105/105; API 757/759 (2 přeskočené), 0 selhání — route-parity inventář
  navýšen o sdílené `/game/quests/near`, `/info/panorama/panoramax`, `/info/population/area`,
  `/satellites/elements` a `/satellites/categories`; web má 7 předexistujících selhání z WIP
  větve (netýkají se tohoto plánu).
- **Práva zdrojů:** `npm run audit:source-rights` 7/7 — doplněny chybějící záznamy
  (`nasa-eonet`, `open-data-hub`, `digitraffic`, `booking`, `panoramax`, `api.maptiler.com`)
  a SVG/XML namespace `www.w3.org` označen jako nesíťový.
- **Architektura:** `check-architecture-boundaries` prochází.
- **Tajemství:** `check-secrets` prochází; Mapillary token není v URL.
- **Build:** produkční build webu prochází.
- **CSS tokeny:** 4 předexistující nálezy (`--surface-raised`, `--text-primary`) mimo tento plán.

### Vědomé hranice

- Nové řádky bez skutečného keyless zdroje **zůstávají nedostupné** s poctivým popiskem, místo
  aby předstíraly pokrytí. To je v souladu s „nevydávat maketu za funkci“.
- Placené tarify se nezavádějí; MapTiler weather, GHSL rastry, satelitní propagace a Overture
  import jsou další samostatné datové práce.
