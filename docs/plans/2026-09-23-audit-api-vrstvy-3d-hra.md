# Audit MapOS: API, piny a vrstvy, 3D, panel vrstev a herní mód

Datum: 23. 9. 2026 · Rozsah: `apps/web`, `apps/api` (world, game, dataSources, upstream), dokumenty v `docs/audits` a `docs/plans`, krátký živý test na https://mapos2.promptstudio3000.com.

Způsob ověření:

- **Statická analýza kódu.** Všechna tvrzení mají odkaz na soubor a řádek podle stavu pracovního stromu k 23. 9.
- **Živý test v prohlížeči:** Praha, zoom 14, 17 bodových vrstev naráz přes URL (`?layers=osm-poi,game-quests,commons-photos,inaturalist,webcams,…`). Pak přepnutí do módu Hra. Zaznamenal jsem síťové požadavky i screenshoty.
- **Co jsem neověřoval:** testy jsem nespouštěl (lokální shell nebyl během auditu k dispozici). Pohyb avatara jsem v prohlížeči nedokázal spolehlivě vyvolat, protože syntetické klávesy byly příliš krátké. Je to tedy „neověřeno“, nikoli „rozbité“.

---

## 0. Shrnutí: deset nejdůležitějších věcí

1. **Hra nevyužívá reálnou mapu.** V módu Hra se vypnou všechny vrstvy (`mapStore.ts:1089`). Nepřátelé, esence a zóny se generují hashem na mřížce 0,01° (`gameWorld.ts:153–257` `zoneSpawns`, `381–429` `entities`), bez vazby na ulice, parky, vodu nebo POI. Silnicemi omezený generátor orbů existuje, ale jen jako lokální „practice board“ bez odměn.
2. **Hra je prázdná.** Na buňku 0,01° (~0,8 km²) připadá 8 pevně rozmístěných entit a 7 v zóně, tedy zhruba 15 věcí na km². Při herním zoomu 18,3 na obrazovce typicky není nic. Živý test u Staroměstské radnice ukázal jen avatar a jednu dekoraci.
3. **Souboj je tahová RPG přes REST.** Každý útok znamená `POST /v2/world/action` a čekání na snapshot (`runtime.ts: action`). Chybí okamžitá odezva a zpětná vazba. Snapshot chodí přes WebSocket jednou za sekundu.
4. **Hráč prochází budovami.** V módu Hra jsou vynucené 3D budovy, ale pohyb není omezen na chodníky a Three.js maže depth buffer (`threeScene.ts:1139`). Avatar se kreslí přes zdi i střechy a s terénem 3D „plave“ (výška je vždy z = 0).
5. **Piny splývají.** Každá vrstva má vlastní GeoJSON zdroj, vlastní clustering (nebo žádný) a `icon-allow-overlap: true` (`pinsLayer.ts`, `dataLayer.ts`). Při 17 vrstvách vznikají shluky přes sebe, překrývající se popisky a „Bez názvu“.
6. **Piny končí v obdélníku.** Drahé vrstvy se po posunu nebo změně velikosti okna nenačtou, dokud uživatel neklikne na „Hledat zde“ (`LayerEngine.ts:418–429`). Na mapě pak zůstává ostrá hrana, za kterou nic není (viditelné v živém testu).
7. **Opakované stejné požadavky.** `osm-poi` se při jednom načtení stáhl pětkrát se stejným bbox. `poiFusionService` vrací `retryAfterMs: 2000` a klient pak znovu stahuje celý dotaz včetně stránek (až 8×, `LayerEngine.ts:596–618`). Stránkování v2 běží sériově po 100 prvcích až do 8 000 (`LayerEngine.ts:784, 826`).
8. **Neintegrované a mrtvé vrstvy.** 8 vrstev je dostupných jen jako podřádky jiných řádků. `vanlife` je z katalogu úplně vyřazená (`UnifiedLayers.tsx:126`). `bathymetryLayer.ts` a `funnyMapsLayer.ts` se nikde nepoužívají. Overture, FIRMS, OCM, OpenAQ, eBird a Opencaching nejsou nakonfigurované.
9. **Duplicitní vrstvy a panely.** Kempy jsou třikrát, ovzduší třikrát, biodiverzita čtyřikrát a zprávy na mapě dvakrát (stejná data se kreslí dvakrát a dvakrát se dotazují). Existují dva katalogy vrstev (`LayersDrawer` a `UnifiedLayers`) a dvě herní HUD (`ui/GameHud.tsx` je mrtvý).
10. **3D mapa je poloviční.** Uživatel nemůže naklápět ani rotovat (`MapCore.tsx:98–100`). Náklon se nastaví jen při přepnutí přepínače a po reloadu zmizí. Vypnutí budov srovná kameru, i když terén zůstane zapnutý. Hillshade a terén sdílejí jeden DEM zdroj.

---

## 1. API: inventář a nálezy

### 1.1 Mapa volání (web → API → upstream)

| Oblast                      | Volání z webu                                                                                                                                                                                | Kdo volá                                                                                    | Poznámka                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start aplikace              | `GET /config`, `POST /auth/guest`, `GET /v2/discover/boundaries`, `GET /v2/themes` (bez bbox) a `GET /v2/themes?bbox…`                                                                       | `App.tsx`, `sessionBootstrap.ts`, `boundaryOverlay.ts`, statistiky                          | `/v2/themes?bbox=…&zoom=4` šel v živém testu **dvakrát se stejnou URL** (požadavky .46 a .60)                                                                         |
| Bodové vrstvy               | `GET /layers/:id/features` (v1), `GET /v2/layers/:id/features` (v2 jen `earthquakes`, `events`), obojí s `cursor` stránkováním                                                               | `LayerEngine.fetchLayerFeatures`                                                            | Surový bbox s 15 desetinnými místy, takže HTTP cache nikdy nezasáhne. Sériové stránkování. Progresivní retry stahuje vše znovu.                                       |
| Dlaždice přes náš origin    | `/weather/radar/…`, `/weather/maptiler/…`, `/street-objects/{point,sign}/…`, `/v2/themes/:id/tiles`, `/v2/tables/:id/tiles`, `/v2/discover/boundaries/…mvt`, `pmtiles:///overture/*.pmtiles` | pluginy                                                                                     | `themeLayers.ts:190` a `tableLayers.ts:113` mají natvrdo `/api/…` místo `API_BASE`, takže se rozbijí při jiném `VITE_API_BASE_URL`                                    |
| Dlaždice přímo z prohlížeče | ČÚZK KN a DMVS, dppcr (záplavy), EMODnet WMS, GBIF density, Waymarked, OpenRailwayMap, OpenSeaMap, OpenSnowMap, CyclOSM, terén z AWS S3                                                      | `tileLayers.ts`, `czechSources.ts`, `europeEnvironmentLayers.ts`, `terrain3d.ts`            | V pořádku, jen bez naší cache nebo circuit breakeru; stav hlídá `BrowserProviderHealth`                                                                               |
| Přímé API z prohlížeče      | `https://api.rainviewer.com/public/weather-maps.json`                                                                                                                                        | `weatherLayer.ts:18, 52`                                                                    | Časová osa přitom bere snímky z `/api/weather/frames` (`GlobalTimeline.tsx:154`). **Dva zdroje seznamu snímků radaru** mohou dát nesoulad časů.                       |
| Počasí a prostředí          | `/weather/grid` (každá z 8 vrstev počasí zvlášť), `/weather/frames`, `/weather/maptiler/catalog`, `/environment/air-quality/grid`, `/environment/drought/edition`                            | vrstvy počasí a prostředí                                                                   | 3 zapnuté veličiny znamenají 3 dotazy na mřížku při každém posunu; stačí jeden dotaz s více proměnnými                                                                |
| Živá doprava                | `/live/aircraft`, `/live/vessels` (polling `cfg.pollMs`, bbox rozdělený přes antimeridián)                                                                                                   | `liveTraffic.ts:299, 397`                                                                   | OK                                                                                                                                                                    |
| Družice                     | `/satellites/elements`                                                                                                                                                                       | `satelliteLayer.ts:386`                                                                     | OK (hodinová cache)                                                                                                                                                   |
| Objevuj a oblast            | `/v2/discover/context`, `/v2/discover/area`, `/discover/guide`, `/discover`, `/info/weather`, `/info/population/area`                                                                        | `context.ts`, `DiscoverPanel.tsx`, `RegionsTab.tsx`, `GuideTab.tsx`                         | Klíč kontextu obsahuje `layers=` (seznam zapnutých vrstev) a surové lng/lat/zoom, takže každé přepnutí vrstvy spustí nový dotaz na kontext oblasti. Podrobnosti v §5. |
| Detail místa                | `/places/:id`, panely `/info/*`, `/info/panorama/panoramax`, `/routing`, `/reviews` + `/comments` + `/follows` (3 paralelní), `/game/quests/near`                                            | `PinDetail.tsx`, `InfoEngine`, `PlaceSocial.tsx`                                            | Panely se mountují líně (dobře); sociální část jsou 3 dotazy, které by šly sloučit do 1                                                                               |
| Hledání                     | `/geocode?provider=auto`, `/geocode/reverse`, `/tags/top`                                                                                                                                    | `CommandSearch.tsx`                                                                         | OK                                                                                                                                                                    |
| Svět a hra (REST)           | `/v2/world/capabilities`, `/session`, `/action`, `/presence`, `/quests`, `/avatar`, `/models/request` (polling 4 s), `/models/default` (polling 4 s, až 36×)                                 | `runtime.ts`, `worldLayer.ts:88`, `WorldHud.tsx`                                            | V živém testu šlo `/models/default` **5× za pár sekund**                                                                                                              |
| Svět (WS)                   | `wss /v2/world/live`: klient posílá pozici 1×/s, server posílá `snapshot` a `social-refresh` 1×/s                                                                                            | `runtime.ts`, `worldRoutes.ts:230–247`                                                      | Viz A6                                                                                                                                                                |
| Svět a sociální část        | `/v2/world/threads/search` (**dva nezávislé pollery**: `socialMap.ts:146` po 15 s + po moveend, `mapNotesLayer.ts:34` po 30 s), `/threads/*`, `/contacts*`, `/dm/*`                          | sociální část                                                                               | Stejná data, dva renderery (DOM markery i symbol vrstva)                                                                                                              |
| Legacy hra                  | `/game/roads`, `/game/zones` (fallback bez session), `/game/staking/*`, `/games/state` (Trail Signals), `/game/ghosts*`, `/game/encounters*`, `/game/orbs/collect`, `/game/progress`         | `worldLayer.ts`, `GameHud.tsx` (mrtvý), `gameLayer.ts` (mrtvý), `trailSignalsGameModule.ts` | Mutace ghost a encounter vrací 410. Klientský kód, který je volá, je mrtvý (§6).                                                                                      |

Serverová strana (`utils/upstream.ts`) je dobře postavená: LRU cache v paměti, sdílení souběžných požadavků, circuit breaker, rozpočty a ochrana proti SSRF. Slabinou je **klíč cache**: `dataSources` (iNaturalist, GBIF, Sensor.Community, webkamery, sdílená mobilita…) posílají upstreamu přesný bbox výřezu, takže každý posun je cache miss. Kvantizaci do buněk má jen OSM POI (`layerService.ts: cellsForBbox`). Druhá architektonická slabina: dvě kompoziční rootové vrstvy `index.ts` (63 kB) a `memory-server.ts` (66 kB) registrují trasy paralelně a jejich rozdíly hlídá jen `routeParity.test.ts`.

### 1.2 Nálezy k API

| ID  | Závažnost | Nález                                                                                                                                                                                                                                                         | Návrh                                                                                                                                                                                                           |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | P0        | **Progresivní retry stahuje vše znovu.** `status: partial` + `retryAfterMs` způsobí nový `refreshLayer` celé vrstvy včetně všech stránek, až 8× (`LayerEngine.ts:596–618`). Živě: `osm-poi` 5× a `vanlife` 3× se stejným bbox.                                | Server vrátí `revision`/`taskId`. Klient se ptá `?since=<revision>` a přijímá jen delta. Případně SSE stream pro progresivní fúzi. Retry nesmí mazat už vykreslené piny.                                        |
| A2  | P0        | **Sériové stránkování po 100.** V2 posílá `limit=100` a cursor smyčku až do 8 000 prvků nebo 8 MB (`LayerEngine.ts:784, 826–849`). V1 jde přes stejnou smyčku.                                                                                                | Limit podle hustoty (300–1 000). U bodových vrstev nad 2 000 prvků přejít na **vektorové dlaždice** (MVT z PostGIS `ST_AsMVT`, stejný vzor jako `/v2/themes/:id/tiles`).                                        |
| A3  | P0        | **Bbox není kvantizovaný.** Klient posílá `14.412176931154988,…` a server ho tak předá upstreamu. Komentář v `LayerEngine.ts:62` tvrdí „rounded bbox“, ale `key()` na ř. 79 nezaokrouhluje.                                                                   | Zavést společnou mřížku: klient zarovná dotaz na dlaždicové buňky (např. z12/z14), server skládá odpověď po buňkách a cachuje je (L1 paměť, L2 Postgres nebo Redis). Tím vzniká i sdílená cache mezi uživateli. |
| A4  | P1        | `FeatureCache.set` volá `JSON.stringify(data)` na každou odpověď jen kvůli odhadu velikosti (`LayerEngine.ts:104`), přestože `fetchLayerFeatures` už zná délku textu.                                                                                         | Předat `bytes` z `fetchLayerFeatures` a stringify zrušit.                                                                                                                                                       |
| A5  | P1        | Duplicitní bootstrap: `/v2/themes?bbox=…` dvakrát a `/models/default` polling v `worldLayer.ts` souběžně s `/models/request` v `runtime.ts`.                                                                                                                  | Jeden store pro model avatara. Dedupe in-flight GET v `apiGet` (mapa `url → promise`).                                                                                                                          |
| A6  | P1        | **WS tick za 1 s na hráče** dělá `snapshot()`: `repository.list("raid_results", limit 10000)` (`gameWorld.ts:437`), plošný dotaz na questy v okruhu 10 km, načtení profilu a presence, a navíc posílá `social-refresh` každou sekundu (`worldRoutes.ts:240`). | `raid_results` držet v paměti jako Set podle módu a dne. Questy cachovat podle buňky. Snapshot posílat jen jako **diff** a při změně. `social-refresh` posílat jen při skutečné nové zprávě nebo kontaktu.      |
| A7  | P1        | Dva pollery na `/v2/world/threads/search` a dva renderery stejných vláken (`socialMap.ts` DOM markery × vrstva `temporary-messages`).                                                                                                                         | Jeden zdroj: vrstva `temporary-messages`. `socialMap` jen otevírá vlákna a kreslí radius. DOM markery zrušit.                                                                                                   |
| A8  | P1        | Radar: seznam snímků se bere přímo z RainViewer v prohlížeči i z `/weather/frames` na serveru.                                                                                                                                                                | Jen `/weather/frames` (server už proxy dlaždice). Klientský `loadLiveRadarPath` smazat.                                                                                                                         |
| A9  | P1        | 8 vrstev počasí dělá 8 samostatných dotazů na `/weather/grid`.                                                                                                                                                                                                | `/weather/grid?variables=a,b,c` a jeden sdílený loader.                                                                                                                                                         |
| A10 | P2        | `refreshTableLayers` dělá N+1 (seznam tabulek a detail každé tabulky, `tableLayers.ts:60–72`).                                                                                                                                                                | `GET /v2/tables?include=breaks`.                                                                                                                                                                                |
| A11 | P2        | Místo `apiGet` se používá 39 přímých `fetch(` volání, bez jednotných chyb, request-id a dedupe (`gameLayer.ts`, `CommandSearch.tsx`, `PinDetail.tsx`, `worldLayer.ts`, `runtime.ts`…).                                                                        | Převést na `api.ts` (případně `@tanstack/react-query`, který je v závislostech a téměř se nepoužívá).                                                                                                           |
| A12 | P2        | `themeLayers.ts:190` a `tableLayers.ts:113` mají natvrdo `/api/`.                                                                                                                                                                                             | Použít `API_BASE`.                                                                                                                                                                                              |
| A13 | P2        | Dvě kompozice API (`index.ts` × `memory-server.ts`).                                                                                                                                                                                                          | Postupně sdílené `register*Routes(app, deps)` a memory jen jako jiná sada závislostí.                                                                                                                           |

---

## 2. Piny a vrstvy

### 2.1 Proč se piny nezobrazují dobře

| ID  | Nález                                                                                                                                                                                                                                                 | Důsledek                                                                                           | Oprava                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Každá bodová vrstva má vlastní zdroj a vlastní clustering. `pinsLayer` shlukuje do z11, `dataLayer` shlukuje jen natvrdo vybraných 6 id (`dataLayer.ts:40–47`), ostatní neshlukují vůbec. Všude platí `icon-allow-overlap` + `icon-ignore-placement`. | Na z13–15 vzniká „polévka“: shluky různých vrstev přes sebe a piny přes sebe (screenshot Praha 1). | **Sjednotit bodový renderer:** jeden sdílený GeoJSON zdroj „pins-all“ (nebo 2–3 podle priority) s `layerId` ve vlastnostech, jeden clustering s `clusterProperties` (počty podle vrstev), barevné koláčové shluky, kolize symbolů zapnuté (`icon-allow-overlap: false` od z15 s `symbol-sort-key` podle důležitosti) a „spread“ při kliknutí. |
| P2  | Po posunu nebo resize se drahé vrstvy nenačtou (stav `pending`, `LayerEngine.ts:418–429`). Levné vrstvy se načtou.                                                                                                                                    | Piny končí ostrou hranou v obdélníku. Uživatel neví proč a vypadá to jako chyba.                   | Buňkové načítání (A3), takže se dotahují jen nové buňky a „Hledat zde“ zbude jen pro opravdu drahé zdroje. Viditelný stav „mimo načtenou oblast“: šrafovaná hrana nebo pill s počtem vrstev.                                                                                                                                                  |
| P3  | Popisky od z13 u `pinsLayer` bez kolizí mezi vrstvami. Chybí filtr prázdných jmen, na mapě se objevuje „Bez názvu“.                                                                                                                                   | Nečitelná mapa                                                                                     | Jedna vrstva popisků pro všechny piny, `text-optional`, filtr prázdných jmen a „Bez názvu“, priorita podle `symbol-sort-key`.                                                                                                                                                                                                                 |
| P4  | `setOpacity` v `dataLayer` nemění `text-opacity` popisků. `pinsLayer` nemá `visibility` v layoutu při vytvoření.                                                                                                                                      | Průhlednost vrstvy nechá popisky plné                                                              | Opravit v rámci P1.                                                                                                                                                                                                                                                                                                                           |
| P5  | Dvě implementace ikon (`pinIcons.ts` ensurePinImages pro kategorie, `ensureDataPinImage` pro vrstvy) plus DOM markery ve `socialMap.ts`.                                                                                                              | Nekonzistentní vzhled                                                                              | Jeden atlas ikon (sprite) a jeden styl pinu (tvar podle typu zdroje, barva podle vrstvy, glyf podle kategorie).                                                                                                                                                                                                                               |
| P6  | Po zapnutí 17 vrstev naráz je výsledkem toast „4 vrstev se nepodařilo úplně načíst“ bez uvedení kterých.                                                                                                                                              | Uživatel nemá co opravit                                                                           | Toast s názvy vrstev a přímým odkazem na řádek v katalogu.                                                                                                                                                                                                                                                                                    |
| P7  | Legendy (3 najednou) a panel Událostí po zapnutí vrstev překryjí až 50 % mapy (desktop i mobil). V živém testu se panel Událostí nedal zavřít křížkem (dvakrát jsem zkusil).                                                                          | Mapa, kvůli které uživatel přišel, není vidět                                                      | Legendy sbalené v jednom chipu „Legenda (3)“ jako výchozí stav. Panel Událostí jen na explicitní otevření. Ověřit a opravit zavírací tlačítko (`EventTimelineContribution`).                                                                                                                                                                  |

### 2.2 Neintegrované, nenastavené a mrtvé vrstvy

Stav podle `docs/audits/2026-09-20-layer-inventory.json` (117 položek) a kódu:

| Vrstva                                                                                           | Stav dnes                                                                                                                                         | Co s ní                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gbif`, `gbif-density`, `ebird`                                                                  | Jen podřádek pod iNaturalist taxony („Doplňkový zdroj / runtime“)                                                                                 | Sloučit do vrstvy **Příroda a pozorování** se zdrojovým filtrem (iNat / GBIF / eBird). Hustotu GBIF nabídnout jako vizualizační režim „heatmapa“ té samé vrstvy.             |
| `air-quality` (Sensor.Community), `openaq`                                                       | Podřádky pod `cams-air-quality`                                                                                                                   | Jedna vrstva **Ovzduší** s režimy: model (CAMS mřížka) / měření (senzory + OpenAQ stanice).                                                                                  |
| `refuge-restrooms`, `charging-stations`                                                          | Podřádky pod OSM kategoriemi WC a nabíječky                                                                                                       | Fúzovat server-side do `osm-poi` jako další `sources` (jako už `mapy`, `fsq`, `park4night`), s deduplikací.                                                                  |
| `vanlife`                                                                                        | **Vyřazená z katalogu** (`UnifiedLayers.tsx:126`), ale je primární v plánování a jde přes URL                                                     | Smazat. Duplikuje kategorie `camp_site`, `caravan_site`, `dump_station`, `drinking_water` z `osm-poi`. V plánování použít preset „Karavan“ = `osm-poi` s těmito kategoriemi. |
| `park4night`                                                                                     | Experimentální, vyžaduje capability                                                                                                               | Ponechat jako zdroj fúze `osm-poi` (už je v `sources`) a samostatný řádek skrýt.                                                                                             |
| `overture-places`, `overture-buildings`                                                          | `unavailable`: chybí PMTiles výřez                                                                                                                | Buď vygenerovat výřez ČR skriptem a nasadit, nebo řádky skrýt úplně. Budovy navíc použít jako **zdroj 3D budov** (výšky z Overture), viz §3.                                 |
| `active-fires` (FIRMS), `charging-stations` (OCM), `openaq`, `ebird`, geocaching (`opencaching`) | `unavailable`: chybí klíče                                                                                                                        | Doplnit klíče do `.env` na mapos2 (vše zdarma). Dokud nejsou, řádky **skrýt** místo zašedlých. Dnes se zobrazují jako vypnutý switch s hláškou.                              |
| `emodnet-bathymetry` + `layers/environment/bathymetryLayer.ts` + `/environment/bathymetry/grid`  | Vrstva jede přes WMS obrázek. Numerický handle a API route existují, ale **nejsou zapojené** (popis: „Číselné mediány buněk se připravují“)       | Dodělat: tap na moře vrátí hloubku z gridu (stejný vzor jako výběrové plochy počasí). Jinak handle i route smazat.                                                           |
| `funnyMapsLayer.ts` (`registerFunnyMapLayer`)                                                    | **Nikde se nevolá**                                                                                                                               | Buď doplnit manifest s PMTiles archivy do `public/layers`, nebo soubor smazat.                                                                                               |
| `game` (3D svět) v katalogu „Komunita a hra“                                                     | Přepínač vrstvy nemá bez módu Hra smysl                                                                                                           | Z katalogu odstranit, hra se zapíná jen módem.                                                                                                                               |
| „Moje“ extras                                                                                    | Pluginy, které nejsou v katalogu ani v related, padají do skupiny „mine“, která je ve výchozím pohledu „Vše“ **skrytá** (`UnifiedLayers.tsx:184`) | Každý registrovaný plugin musí mít kategorii. Test: „každý plugin je viditelný ve Vše“.                                                                                      |

### 2.3 Vrstvy, které dělají totéž

| Téma             | Duplicity                                                                                                                      | Rozhodnutí                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Kempy a karavany | `osm-poi` (camp_site, caravan_site, dump_station…) × `vanlife` × `park4night`                                                  | Jen `osm-poi` + fúze zdrojů                                                                 |
| Ovzduší          | `cams-air-quality` × `air-quality` × `openaq`                                                                                  | Jedna vrstva, 2 režimy                                                                      |
| Příroda          | `inaturalist` × `gbif` × `gbif-density` × `ebird`                                                                              | Jedna vrstva se zdrojovým filtrem a heatmapou                                               |
| Zprávy na mapě   | `temporary-messages` × DOM markery `socialMap.ts` × `game-quests/osm-notes` („Poznámky v mapě“ je něco jiného, ale název mate) | Jedna vrstva. Přejmenovat „Poznámky v mapě“ na „OSM poznámky k ověření“.                    |
| Sítě             | `openinframap` (power, telecoms, water) × `cz-networks` (DMVS) × `street-objects` (sloupy, vodní objekty)                      | Ponechat (jiný původ), ale seskupit do jedné sekce „Technické sítě“ s podřádky podle zdroje |
| Fotky ulic       | `mapillary` × `panoramax` × panorama v detailu místa                                                                           | Jedna vrstva „Pouliční snímky“ se zdrojovým filtrem                                         |
| Budovy           | 3D budovy z podkladu × `overture-buildings`                                                                                    | Overture jako zdroj výšek pro 3D; samostatnou 2D vrstvu zrušit                              |
| Questy           | `game-quests` (externí) × questy ve World snapshotu (`externalQuests.nearby`) × uživatelské questy × Trail Signals             | Jeden „Quest“ model, viz §7                                                                 |
| „Družice“        | Vrstva `satellites` (objekty na oběžné dráze) × satelitní podklady                                                             | Přejmenovat vrstvu na „Družice na oběžné dráze“                                             |

---

## 3. 3D vrstva

### 3.1 3D mapa (MapLibre: budovy a terén)

| ID  | Nález                                                                                                                                                                    | Oprava                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false` (`MapCore.tsx:98–100`), `NavigationControl` bez kompasu a náklonu. **Ve 3D se nedá rozhlédnout.**     | Když je zapnuté 3D (budovy nebo terén): povolit pravé tlačítko a Ctrl+tažení, dvouprsté gesto, `NavigationControl({ visualizePitch: true, showCompass: true })` a tlačítko „2D/3D“. Ve 2D nechat zamčeno. |
| D2  | Náklon se nastaví jen v event handleru přepínače (`MapCore.tsx:401–425`). Po reloadu je 3D zapnuté, ale kamera zůstane plochá (`initOverlays` 868–871 náklon nenastaví). | Náklon odvodit ze stavu (`buildings3d \|\| terrain3d`) při `load`, ne z eventu.                                                                                                                           |
| D3  | Vypnutí budov nastaví `pitch: 0`, i když terén zůstal zapnutý (a naopak).                                                                                                | Cílový náklon = max(požadavky aktivních 3D funkcí).                                                                                                                                                       |
| D4  | Hillshade i terén čtou stejný `raster-dem` zdroj (`terrain3d.ts:66, 78`). MapLibre doporučuje oddělené zdroje (kvalita i výkon).                                         | Dva zdroje se stejnými dlaždicemi.                                                                                                                                                                        |
| D5  | Budovy: pevná barva `#b9b2a5` bez ohledu na tmavé téma, od z14, bez světla a stínu. Nad rastrovými podklady budovy nejsou vůbec.                                         | Barvy z tokenů podle tématu, `fill-extrusion-vertical-gradient`, `light`. Pro rastrové podklady jako fallback vektorový zdroj budov (OpenFreeMap nebo Overture PMTiles).                                  |
| D6  | Chybí `sky` a fog. Při náklonu 55° a více je horizont prázdný.                                                                                                           | `map.setSky` (MapLibre 5 umí) jen ve 3D.                                                                                                                                                                  |
| D7  | Přepínače 3D jsou v záložce **Podklady**, ne ve Vrstvách. Pro uživatele je 3D „vrstva“.                                                                                  | Plovoucí tlačítko „3D“ vedle zoomu (budovy + terén + náklon), detailní nastavení nechat v Podkladech.                                                                                                     |

### 3.2 3D herní renderer (Three.js custom layer)

| ID   | Nález                                                                                                                                                     | Oprava                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3D1 | `renderer.clearDepth()` před renderem (`threeScene.ts:1139`): herní objekty se kreslí vždy přes budovy. Screenshot: prstenec avatara „na střeše“ radnice. | Buď sdílet depth buffer (bez `clearDepth`) a řešit viditelnost avatara x-ray obrysem, nebo (lépe) **v herním módu snížit budovy** (výška × 0,25 nebo průhlednost 0,35) a udržet hráče na chodnících (viz §7). |
| G3D2 | Kotva `MercatorCoordinate.fromLngLat(…, 0)`: bez výšky terénu. S terénem avatar plave nebo je zabořený.                                                   | `map.queryTerrainElevation(lngLat)` pro avatara i entity (throttle) nebo terén v herním módu vypnout.                                                                                                         |
| G3D3 | Follow kamera: `easeTo` po 100 ms s délkou 120 ms (`MapCore.tsx:38, 111–125`). Překrývající se easy znamenají škubání.                                    | Kamera se v každém snímku nastavuje přímo (`jumpTo` s kritickým tlumením v rAF smyčce hry), jedna smyčka pro pohyb, kameru i render.                                                                          |
| G3D4 | Repaint je omezený na 30 (24) fps přes `setTimeout(triggerRepaint)`.                                                                                      | Pro arkádu 60 fps s adaptivním snížením kvality, ne snímků.                                                                                                                                                   |
| G3D5 | Mrtvý kód: `layers/game/gameLayer.ts` (557 ř.), `ui/GameHud.tsx` (565 ř.). `ghostRenderer.ts` je živý jen přes `threeScene`.                              | Smazat (roadmapa z 18. 9. to sama plánuje).                                                                                                                                                                   |

---

## 4. UX: zapínání a vypínání vrstev a celý panel

Nálezy:

1. **Dva katalogy.** `LayersDrawer` (legacy, přes `LayersMegaMenu` → `ModeBar`, jen při `VITE_APP_SHELL_V2=0`) a `UnifiedLayers` (nový shell). Oba mají `data-testid="overflow-menu"`, vlastní hledání, presety a „jen aktivní“. Legacy je třeba smazat, jinak se chyby opravují dvakrát.
2. **Tři stavy řádku** místo dvou: _zapnuto_, _vybráno, ale pozastaveno_ („Pozastaveno“) a _odebráno_ (křížek jen v pohledu Aktivní). Uživatel vypne switch a vrstva mu zůstane v aktivních. Pro mapovou aplikaci je lepší model „switch = na mapě“. Pozastavení dávat jen v kontextu presetu nebo módu (hra, statistika).
3. **Pětkrát o úrovni výš:** hledání + 4 pohledy (Vše, Aktivní, Oblíbené, Moje) + přepínač „Dostupné při tomto přiblížení“ + preset select + tlačítko Zdroje. Než uživatel uvidí první vrstvu, prochází toolbar o 4 řádcích.
4. **Kategorie jsou ve výchozím stavu sbalené** (11 skupin). K zapnutí „Kavárny“ jsou potřeba 3 kliky (otevřít panel, rozbalit Místa, najít řádek).
5. **Rychlé vrstvy v horní liště** mají natvrdo český katastr, sítě a Q100 (`QuickLayers.tsx:41–44`), i v anglickém UI, a `!` assertion na ř. 44 spadne, pokud id v katalogu chybí.
6. **Jazyk:** anglické UI, ale obsah panelů je česky („STŘED MAPY“, „Průvodce“, „Události na 12 měsíců“, „Přidat do plánu“, toast „4 vrstev se…“). Týká se i `LayerEngine` hlášek natvrdo (`LayerEngine.ts:399, 525, 527`).
7. **Otevřený command palette** (klik do hledání) se nezavřel klávesou Escape ani klikem vedle (živý test, dvakrát).
8. **Tlačítka bez přístupného jména:** 6 ikon v top baru a panelech (`read_page` ukázal `button [ref_62…74, 117]` bez jména).
9. **Panel zabírá mapu:** na mobilu zakrývají legendy a timeline spodní polovinu. Vrstvy se otevírají v pravém draweru, který na desktopu posune top bar (`--drawer-w-open`).

Cílový návrh panelu Vrstvy:

```
┌ Vrstvy ──────────────────────── ✕ ┐
│ 🔍 Hledat vrstvy, místa, data…     │
│ [Na mapě 5] [★ Oblíbené] [Vše]     │   ← 3 pohledy, výchozí „Na mapě“, když je něco zapnuté
│ Presety: Výlet · Město · Karavan · Počasí · + │   ← chipy, ne select
├────────────────────────────────────┤
│ NA MAPĚ (5)             Vypnout vše│
│  ● Kavárny, Restaurace  ▬▬ ⚙  ⏻   │   ← jeden řádek na vrstvu, facety jako chipy uvnitř
│  ● Radar                ▬▬ ⚙  ⏻   │     přetažením se mění pořadí vykreslení
├────────────────────────────────────┤
│ ▸ Místa a služby            3/41   │
│ ▸ Příroda a pozorování      0/4    │
│ ▸ Počasí a ovzduší          1/3    │
│ ▸ Doprava a infrastruktura  …      │
│ ▸ Pozemky ČR (jen nad ČR)          │
│ ▸ Moje                             │
└────────────────────────────────────┘
```

Pravidla:

- Vypnutí = zmizí z „Na mapě“.
- Nedostupná vrstva se neukazuje (pokud nejde o hledání).
- Stav načítání a počet prvků u řádku ponechat (to funguje dobře).
- Každý řádek má odkaz „zobrazit na mapě“, který skočí na nejbližší data.

---

## 5. Detail oblastí (jen podklady pro knowledge base)

Nechávám na knowledge base, jen tři technické příčiny pomalosti, které KB sama nevyřeší:

- `/v2/discover/context` má v klíči surové lng/lat/zoom a **seznam zapnutých vrstev** (`context.ts: loadDiscoverContext`). Každý posun nebo přepnutí vrstvy spustí nový drahý dotaz. Klíč by měl být `areaId + revision + lang` a vrstvy řešit na klientu.
- Serverová složka `discoverService.ts` (60 kB) má 21 řádků s `await`/`Promise.all`, z toho jen 3 paralelní (`Promise.all`/`allSettled`). Stojí za to projít, co běží sériově.
- KB by měla vracet předpočítaný „area card“ podle `areaId` (region, průvodce, čísla, počasí zvlášť a líně). Detail pak stojí 1 rychlý dotaz místo několika agregací.

---

## 6. Herní mód: diagnóza

Co dnes je:

- **Autoritativní server** (`gameWorld.ts`): zóny, strážci, esence, mince a truhly na mřížce 0,01°, souboj přes `engage` → `shoot`/`cast` s cooldowny 0,5 s a 4,5 s, HP 60 nebo 600, boss pro 2–8 hráčů, upgrade zbraně, questy (visit, cache, trail), idempotentní `actionId`. Technicky poctivá práce.
- **Klient**: pohyb 4 m/s (sprint 8 m/s) volně přes mapu, WASD, joystick, tap-to-move; HUD s úrovní, XP, mincemi, orby a HP; 3 akční tlačítka.

Proč to nefunguje jako arkáda:

1. **Mapa je jen kulisa.** Level design je hash, ne svět. Ulice, parky, řeka, náměstí a památky na hru nemají vliv. Všechny datové vrstvy se v Hře vypnou.
2. **Hustota a tempo.** Nejbližší akce bývá 100–500 m daleko, tedy 30–120 s držení klávesy bez jediné události. Arkáda potřebuje něco zajímavého každé 2–5 s.
3. **Latence v souboji.** Každý zásah znamená round-trip a toast „+XP · odměna potvrzena“. Chybí hit-feedback, knockback, čísla poškození, zvuk a combo. Nepřátelé se nehýbou (útočí tikem serveru každých 2–2,5 s).
4. **Chybí důvod jít někam.** Obsah není navázaný na reálná místa a zóny leží na náhodných bodech mřížky, takže procházení mapy nic nepřináší.
5. **Příliš mnoho měn:** XP, mince (Zlomek GHST), orby (lokální, bez odměny), 4 barvy esencí, Úlomek strážce, Klíč portálu, Relikvie portálu. HUD ukazuje 5 čísel, z nichž „Orby“ jsou v živém režimu vždy 0.
6. **Aavegotchi je jen skin.** Traity `numericTraits[0..3]` (NRG, AGG, SPK, BRN) se používají jen na oči (`gotchi.ts:175`). Vlastní gotchi nedává herní identitu, a přitom to je hlavní důvod, proč by hráč Aavegotchi chtěl hrát.
7. **HUD zakrývá hru:** na mobilu horních ~45 % obrazovky. Přepínač „Aavegotchi / Trail Signals“, select pohybu a 4 ikony jsou v herní ploše.
8. **Chůze skrz budovy, avatar na střechách** (G3D1–2) a škubavá kamera (G3D3).
9. **Tři paralelní systémy obsahu:** practice board (klient), World entity (server), externí a uživatelské questy, Trail Signals a mrtvé ghosty.

---

## 7. Nový design: Aavegotchi svět ve stylu Pokémon GO (upřesněno 23. 9.)

Rozhodnutí produktu: **žádná kola ani runy.** Hra je otevřený, trvalý svět nad reálnou mapou jako Pokémon GO, ale se světem Aavegotchi. Časový odpočet mají jen **zóny**: ukazují, za jak dlouho začnou a za jak dlouho skončí. Uvnitř aktivní zóny padají lepší předměty.

### 7.1 Princip: reálná mapa určuje, co kde je

Server z dat, která už má (pěší síť přes `gameRoadService`, `osm_pois` buňky v PostGIS, Overpass pro parky a vodu), odvozuje pro každou buňku ~500 m **deterministický obsah dne**. Dva hráči na stejném místě vidí totéž.

| Prvek z mapy                                          | Herní význam                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pěší síť (footway, residential, path…)                | Spawny sedí na chodnících a cestách, nikdy v budově nebo ve vodě. Avatar se v simulaci drží cest (snap s měkkým vybočením ~6 m). |
| Parky, lesy, louky                                    | Biom „divočina“: častější esence a přírodní varianty nepřátel                                                                    |
| Voda, nábřeží                                         | Vodní varianty (jen na břehu), mosty jako úzká místa                                                                             |
| Náměstí, pěší zóny                                    | Přirozená místa pro **zóny** a raidy                                                                                             |
| POI z `osm-poi` (hrad, vyhlídka, muzeum, kavárna…)    | **Gotchi portály** (obdoba PokéStopů): sběr předmětů s cooldownem na hráče, kotva questů                                         |
| Externí questy (keš, OSM poznámka, památka bez fotky) | Vedlejší úkoly s bonusem                                                                                                         |
| Počasí (Open-Meteo, už v API)                         | Modifikátor dne: déšť = vodní varianty a víc esencí, noc = svítící mince, vítr = rychlejší duchové                               |

### 7.2 Herní smyčka (otevřený svět)

1. **Procházím mapu** (GPS venku, WASD/joystick doma). Kolem hráče se průběžně objevují entity v okruhu ~60–150 m podle hustoty cest: esence, mince, truhly, Lickquidatoři.
2. **Setkání je krátká akce** (5–15 s), ne tahová bitva: sběr průchodem, souboj s okamžitou odezvou na klientu (klient animuje hned, server potvrdí výsledek), chycení nebo poražení.
3. **Gotchi portály** u reálných míst: jednou za N minut dají náhodný loot. Poblíž je nabídka questů.
4. **Zóny s odpočtem** (jediné časované prvky):
   - Stav **Plánovaná**: na mapě je prstenec a odpočet „začíná za 12:30“. Je vidět z dálky, aby se k ní dalo dojít.
   - Stav **Aktivní**: odpočet „končí za 38:10“. Uvnitř je vyšší šance na vzácné předměty (např. rarity × 2–3), strážce zóny a boss pro 2–8 hráčů v posledních 25 % času.
   - Stav **Končí**: posledních 10 % času zóna bliká a ukazuje už následující plánovanou zónu.
   - Zóny se umisťují na náměstí, do parků a k významným POI, ne na náhodný bod mřížky.
5. **Meta:** XP → level gotchiho, esence a předměty → výbava a upgrady. Měny se sjednotí na **XP + esence + předměty** (dnešní „Orby“ zmizí).

### 7.3 Aavegotchi: traity jako statistiky

| Trait            | Vliv (návrh; hodnoty 0–99, 50 = neutrál)                |
| ---------------- | ------------------------------------------------------- |
| NRG (Energy)     | Rychlost pohybu v simulaci, rychlejší obnova schopností |
| AGG (Aggression) | Poškození v setkáních                                   |
| SPK (Spookiness) | Šance na kritický zásah; nepřátelé „utíkají“ pomaleji   |
| BRN (Brain size) | Dosah sběru (magnet), cooldown portálů                  |
| Rarity / kinship | Kosmetika a denní bonus (nesmí být pay-to-win)          |
| Wearables        | Jedna aktivní schopnost podle slotu ruky                |

Bez gotchiho se hraje neutrálním duchem se statistikami 50. Zůstává ADR 0007: GPS odměny nikdy virtuálnímu avatarovi, profily GPS a explore oddělené.

### 7.4 Síť a autorita

- Server zůstává autoritou nad odměnami (dnešní `actionId` idempotence, ledger odměn).
- Klient hraje okamžitě (optimistická animace sběru a zásahu) a server výsledek potvrdí nebo vrátí. Dnes se čeká na každý úder.
- WebSocket posílá **diffy** snapshotu jen při změně, ne celý snapshot každou sekundu (viz A6).
- Zóny a jejich časy jsou deterministické podle buňky a okna, klient odpočet počítá sám z `serverTime`.

### 7.5 Pocit ze hry (povinný seznam)

- Jedna rAF smyčka pro pohyb, kameru a Three.js, 60 fps, follow kamera s tlumením místo `easeTo` každých 100 ms.
- Okamžitá zpětná vazba: čísla poškození, záblesk, krátký hit-stop, rozpad nepřítele na esence, zvuk sběru.
- V herním módu snížené a zprůhledněné budovy, zvýrazněné cesty, zóny jako světelné prstence viditelné z dálky, šipka k nejbližší zóně nebo portálu na okraji obrazovky.
- HUD: HP a XP, nejbližší zóna s odpočtem, mini-radar a akční tlačítka. Vše ostatní v menu. Na mobilu nejvýš 20 % plochy.

---

## 8. Implementační plán

Odhady jsou hrubé (1 vývojář nebo agent, včetně testů).

### Fáze 0: Úklid a rychlé opravy (2–3 dny)

| #   | Úkol                                                                                                                                                                                                                                               | Soubory                                                                               | Akceptace                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0.1 | Smazat mrtvý kód: `layers/game/gameLayer.ts`, `ui/GameHud.tsx`, `LayersDrawer` + `LayersMegaMenu` + legacy větev `ModeBar` (po rozhodnutí o `VITE_APP_SHELL_V2`), `funnyMapsLayer.ts` (nebo zapojit), klientské volání `/game/ghosts`/`encounters` | viz §6, §3.2                                                                          | `knip`/`ts-prune` bez nových nálezů, e2e zelené                                              |
| 0.2 | Radar jen přes `/weather/frames`                                                                                                                                                                                                                   | `weatherLayer.ts`, `GlobalTimeline.tsx`                                               | V síti žádný požadavek na `api.rainviewer.com`                                               |
| 0.3 | `API_BASE` v tile šablonách                                                                                                                                                                                                                        | `themeLayers.ts:190`, `tableLayers.ts:113`                                            | Unit test s jiným `VITE_API_BASE_URL`                                                        |
| 0.4 | 3D kamera: náklon ze stavu, povolit rotaci a náklon ve 3D, kompas, oddělené DEM zdroje, barvy budov podle tématu, sky                                                                                                                              | `MapCore.tsx`, `terrain3d.ts`, `buildings3d.ts`                                       | Reload se zapnutým 3D = nakloněná kamera. Vypnutí budov při zapnutém terénu nesrovná kameru. |
| 0.5 | Sjednotit zprávy na mapě (zrušit DOM markery a druhý poller)                                                                                                                                                                                       | `socialMap.ts`, `mapNotesLayer.ts`                                                    | 1 poller `/threads/search`, žádné `.world-map-beacon` v DOM                                  |
| 0.6 | Dedupe in-flight GET v `apiGet`, jeden store pro model avatara                                                                                                                                                                                     | `lib/api.ts`, `worldLayer.ts`, `runtime.ts`                                           | Na startu 1× `/v2/themes?bbox`, `/models/default` max. 1× za 30 s                            |
| 0.7 | Opravy UX: zavírání Escape/klik mimo u command palette, zavírací tlačítko panelu Událostí, přístupná jména ikon, `QuickLayers` bez `!` a lokalizované                                                                                              | `CommandSearch.tsx`, `EventTimelineContribution.tsx`, `TopBar.tsx`, `QuickLayers.tsx` | Playwright scénáře, axe bez „button-name“                                                    |

### Fáze 1: API a načítání vrstev (5–7 dní)

| #   | Úkol                                                                                                                                                                                                                                  | Akceptace                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1.1 | **Buňková mřížka pro všechny bodové zdroje**: `DataSource.load` dostane buňku (z12 nebo z14 podle zdroje), server skládá výřez z buněk, L1 LRU + L2 Postgres tabulka `feature_cells(source, cell, filters_hash, payload, fetched_at)` | Posun o půl obrazovky = jen nové buňky; opakovaný výřez = 0 upstream požadavků  |
| 1.2 | Klient: dotazy po buňkách, piny se doplňují, žádná obdélníková hrana; „Hledat zde“ jen pro zdroje s `viewportCost: expensive` a nekvantizovatelné                                                                                     | Po resize nebo posunu se piny dotáhnou bez akce uživatele                       |
| 1.3 | Progresivní fúze: delta místo znovustažení (`since=revision`) nebo SSE                                                                                                                                                                | `osm-poi` max. 1 požadavek na stránku a buňku                                   |
| 1.4 | Limit stránky podle hustoty; `osm-poi` a `user-layers` nad 2 000 prvků jako MVT                                                                                                                                                       | Praha z13: `osm-poi` do 1 s, max. 3 požadavky                                   |
| 1.5 | `FeatureCache` bez `JSON.stringify`                                                                                                                                                                                                   | Profil: žádné stringify v hot path                                              |
| 1.6 | `/weather/grid?variables=…` a sdílený loader                                                                                                                                                                                          | 3 veličiny = 1 dotaz                                                            |
| 1.7 | World WS: snapshot diffy, `raid_results` v paměti, `social-refresh` jen při změně                                                                                                                                                     | DB dotazy na hráče za minutu klesnou o >90 % (metrika v `operationalTelemetry`) |
| 1.8 | Převést přímé `fetch` na `api.ts` (případně react-query pro detail a sociální část)                                                                                                                                                   | `grep "fetch(" apps/web/src` = jen `api.ts` a tile/WS výjimky                   |

### Fáze 2: Piny a konsolidace vrstev (5–6 dní)

| #   | Úkol                                                                                                                                                                                                  | Akceptace                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 2.1 | **Jednotný bodový renderer** (sdílený zdroj, `clusterProperties` podle vrstvy, koláčové shluky, `symbol-sort-key`, kolize od z15, 1 vrstva popisků, filtr prázdných jmen)                             | 17 vrstev v Praze z14: žádné překryté shluky, popisky bez kolizí, klik na shluk ukáže seznam podle vrstev |
| 2.2 | Jeden sprite atlas a jeden styl pinu                                                                                                                                                                  | Vizuální snapshot test pinů všech vrstev                                                                  |
| 2.3 | Sloučení vrstev podle §2.3 (Příroda, Ovzduší, Pouliční snímky, kempy → `osm-poi`, toalety a nabíječky jako zdroje fúze), migrace uložených stavů, URL a presetů (`migrateStructuralOverlays` má vzor) | Staré URL `?layers=vanlife,gbif,…` se namapují na nové vrstvy a facety                                    |
| 2.4 | Nekonfigurované vrstvy skrýt, doplnit klíče na mapos2 (FIRMS, OCM, OpenAQ, eBird, OKAPI), Overture výřez vyrobit, nebo skrýt                                                                          | Inventář: 0 × `unavailable` viditelných v katalogu                                                        |
| 2.5 | Batymetrie: zapojit grid a tap na hodnotu, nebo smazat                                                                                                                                                | Rozhodnutí zapsané, kód odpovídá                                                                          |
| 2.6 | Test „každý registrovaný plugin má kategorii a je vidět ve Vše“                                                                                                                                       | Unit test v `catalogModel.test.ts`                                                                        |
| 2.7 | Toast chyb s názvy vrstev a odkazem                                                                                                                                                                   | Playwright                                                                                                |

### Fáze 3: Panel vrstev (3–4 dny)

- 3.1 Model stavů: zapnuto nebo vypnuto (pozastavení jen interně pro mód Hra a Statistiky).
- 3.2 Nový layout podle §4: pohledy Na mapě / Oblíbené / Vše, presety jako chipy, sekce „Na mapě“ s přetahováním pořadí.
- 3.3 Legendy jako jeden chip, panel Událostí jen na vyžádání, mobilní bottom-sheet se 3 výškami.
- 3.4 Plovoucí tlačítko 3D (§3.1 D7).
- 3.5 Lokalizace: odstranit české texty natvrdo v engine a v panelech Objevuj (klíče v `i18n/cs.ts` a `en.ts`).

Akceptace: zapnout „Kavárny“ z úvodního stavu na 2 kliky, na mobilu mapa viditelná alespoň z 60 % s otevřenou legendou, axe bez chyb.

### Fáze 4: Herní jádro, otevřený svět (10–15 dní)

| #   | Úkol                                                                                                                                                                | Akceptace                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 4.1 | **Generátor obsahu buňky (API)**: pěší graf, biomy (parky, voda, náměstí), POI jako portály, deterministické spawny podle dne a buňky na cestách. Cache v Postgres. | Žádná entita v budově ani ve vodě; stejná buňka a den dávají stejný obsah                                |
| 4.2 | **Zóny s odpočtem** umístěné podle mapy (náměstí, parky, významná POI), stavy plánovaná / aktivní / končí, lepší loot uvnitř, boss v posledních 25 %                | HUD i mapa ukazují „začíná za / končí za“; vzácné předměty padají častěji jen v aktivní zóně (unit test) |
| 4.3 | **Gotchi portály** u POI: loot s cooldownem na hráče, kotva questů                                                                                                  | Portál nejde vybrat dřív než po cooldownu (server)                                                       |
| 4.4 | Setkání s okamžitou odezvou: optimistická animace, potvrzení serverem, rollback při zamítnutí                                                                       | Zásah je vidět < 50 ms po stisku, odměna až po potvrzení                                                 |
| 4.5 | Gotchi traity → statistiky (§7.3), neutrální duch 50/50/50/50                                                                                                       | Dva gotchi s různými traity se měřitelně liší                                                            |
| 4.6 | Kamera a render: jedna rAF smyčka, 60 fps, snížené budovy v herním módu, výška terénu, bez artefaktů `clearDepth`                                                   | p95 snímku < 16,7 ms na desktopu                                                                         |
| 4.7 | Nový HUD a sjednocení měn (XP + esence + předměty)                                                                                                                  | Na mobilu HUD < 20 % plochy                                                                              |
| 4.8 | WS diffy, `raid_results` v paměti, `social-refresh` jen při změně (A6)                                                                                              | Výrazně méně DB dotazů na hráče za minutu                                                                |

### Fáze 5: Meta a sociální část (5–8 dní)

- Výbava a upgrady z esencí a předmětů (navázat na dnešní `weaponLevel`).
- Modifikátor počasí a volitelné eventy (zemětřesení, letadla).
- Questy: jeden model (externí, uživatelský, denní). Trail Signals přepsat jako druh questu, nebo odstranit.
- GPS mód se stejným světem, vyhlazením polohy a odděleným profilem (ADR 0007).

### Doporučené pořadí

Nejdřív Fáze 0 a 1.1–1.3 (největší zisk v rychlosti a v počtu správně zobrazených pinů), potom 2.1 a 2.3. Hru (Fáze 4) lze začít úlohou 4.1 (generátor obsahu buňky), protože sdílí buňkovou mřížku s 1.1.

---

## 9. Otevřená rozhodnutí

1. Smí se legacy shell (`VITE_APP_SHELL_V2=0`) úplně odstranit? Podmiňuje to smazání `LayersDrawer`.
2. Hra: jen desktop a simulace, nebo GPS jako rovnocenný mód? Ovlivňuje dosah spawnu a validaci.
3. Aavegotchi traity jako statistiky: je v pořádku ekonomicky zvýhodnit vlastníky gotchi (kosmetika vs. síla)?
4. Overture: vyrobit PMTiles výřez (a jak velký), nebo vrstvy zrušit?
5. Úložiště cache buněk: Postgres (už je) vs. Redis (nový provozní díl na malém VPS, kde je disk na 98 %).

---

## Příloha: rychlé reference

- Engine vrstev: `apps/web/src/engine/LayerEngine.ts` (cache 62–134, dotaz 208–249, refresh 386–444, retry 596–618, fetch a stránkování 770–851)
- Katalog: `apps/web/src/ui/layers/catalogModel.ts`, `UnifiedLayers.tsx` (extras 121–178, skrytí „mine“ 184)
- Piny: `apps/web/src/layers/pinsLayer.ts`, `dataLayer.ts` (clustering jen pro 6 id ř. 40–47)
- 3D: `apps/web/src/map/MapCore.tsx` (98–100, 401–425, 862–871), `terrain3d.ts`, `buildings3d.ts`
- Hra klient: `apps/web/src/world/worldLayer.ts`, `runtime.ts`, `GameHudOverlay.tsx`, `layers/game/threeScene.ts` (1139), `characterController.ts`
- Hra server: `apps/api/src/world/gameWorld.ts` (zóny 153–257, entity 381–429, snapshot 431–578, akce 579–799, tick 801–826), `routes/worldRoutes.ts` (WS 190–250)
- Inventář vrstev: `docs/audits/2026-09-20-layer-inventory.json`

---

## 10. Stav implementace (23. 9., první etapa: API, piny, vrstvy, 3D)

Hotovo v pracovním stromu (bez commitu), typy a unit testy web 572/572 a API 757/757 zelené:

- **Načítání pinů:** výřez se zarovnává na celé dlaždice aktuálního zoomu (`snapBboxToTileGrid`), takže malé posuny a změna velikosti okna nevyvolají nový dotaz a piny nekončí ostrou hranou. Mapa po resize obnoví data. Stránky v1 mají 500 místo 100 prvků (server: `normalizeLegacyPageLimit`). Progresivní opakování má backoff (max. 6×). Cache nedělá `JSON.stringify` každé odpovědi.
- **API:** souběžné stejné GETy sdílí jeden požadavek (`apiGet`). Kontext oblasti v cache nezávisí na zapnutých vrstvách (jen u AI modelu). Tile šablony témat a tabulek používají `API_BASE`. Archiv radaru používá stejnou paletu jako živý radar.
- **Piny:** shlukují se všechny datové vrstvy kromě těch, kde velikost nese informaci (zemětřesení…). Piny rezervují místo, takže popisky jiných vrstev je nepřekrývají. Popisky „Bez názvu“ se nekreslí. Průhlednost se týká i popisků. Zprávy na mapě se kreslí jen jednou (vrstva) a klik otevře vlákno.
- **Vrstvy:** `vanlife` zrušena (duplikát kategorií `osm-poi`). Staré odkazy, sezení a presety se převedou na `osm-poi` (`store/layerAliases.ts`). GBIF, heatmapa GBIF, eBird, Sensor.Community, OpenAQ, OpenChargeMap a Refuge Restrooms mají vlastní řádky v katalogu. Nenastavené vrstvy jsou v sekci „Vyžaduje nastavení“ s názvem proměnné a odkazem na registraci. Herní 3D svět není v katalogu. Smazán nepoužívaný `funnyMapsLayer.ts` a `bathymetryLayer.ts`.
- **3D:** náklon se odvozuje ze stavu (i po reloadu), vypnutí budov nesrovná kameru při zapnutém terénu, ve 3D jde rotovat a naklánět (kompas a ukazatel náklonu). Přibylo tlačítko „3D“ u zoomu. Terén a hillshade mají oddělené DEM zdroje. Budovy mají barvy podle tématu a nebe ve 3D.
- **UX:** alert chyb vrstev jen při skutečné chybě a s názvy vrstev, command palette se zavírá Escapem i klikem mimo, `QuickLayers` nespadne na chybějící vrstvě, hlášky enginu jsou lokalizované.

Zbývá z fází 0–3: jednotný bodový renderer se společným clusteringem napříč vrstvami (2.1), buňková cache na serveru (1.1), `/weather/grid` pro více veličin (1.6), sloučení mapillary/panoramax, odstranění legacy shellu (čeká na rozhodnutí), nový layout panelu (3.2).
