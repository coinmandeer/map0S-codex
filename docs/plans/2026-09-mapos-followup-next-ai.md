# MapOS — stav převzetí implementace a navazující práce

Aktuální vydání: **`20260905-area-status-polish`**, nasazené a veřejně ověřené. Nový autoritativní stav oblastí, měření a zbývajících úkolů je v [předání interaktivních oblastí](2026-09-05-area-implementation.md). Níže uvedené starší průběžné stavy jsou historie; municipality 34 zemí a vazba výběru na polygon ID už nejsou neimplementované.

Původní pořadí práce a akceptace: [plán dokončení po převzetí](2026-09-05-takeover-execution.md).

Průběžný stav, nikoli potvrzení dokončení nebo nasazení. Autoritativní zadání je
[schválený výkonnostní plán](2026-09-04-performance-approved.md). Starší UI roadmapa je
historický kontext. Poslední požadavek uživatele zachovává všechny fáze plánu.

## Co bylo při převzetí skutečně špatně

- Engine omezoval zápisy, ale reálné datové factory zapisovaly odpověď ještě před jeho kontrolou.
  Mockované testy tuto chybu nezachytily.
- `Hledat zde` používalo společný stav posledního dotazu a hustotu bodů jako důkaz pokrytí.
- Výraz pro zvětšení pinu používal `feature-state` v layout `icon-size`, kde není podporovaný.
- Lazy handle hlásil úspěch před dokončením importu a přehrával starý update bez AbortSignal.
- Discover hover listenery se přidávaly při každém obnovení stylu.
- Galerie nebyla portálový dialog; mohla být oříznutá panelem a neměla správu fokusu.
- Počasí pro každou změnu nejprve stáhlo hrubou a pak jemnou mřížku, pokaždé s vícedenní řadou.
- OSM viewport čekal na celou sadu Overpass dotazů. Identita nezahrnovala typ OSM objektu.
- Předchozí pokus o nasazení skončil před stagingem na oprávnění kořenového adresáře VPS.

## Aktuální změny a síla důkazů

| Fáze                   | Stav             | Implementace / zbývající důkaz                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — měření             | Částečně ověřeno | Opakovatelný browser scénář 6/12 vrstev, 50 posunů, 10 přepnutí a 10 změn stylu v `e2e/performanceMap.spec.ts`. Měří main-thread JS heap po GC, DOM/listenery, mapové zdroje a fixture bajty. Worker/GPU RAM a reální provideři vyžadují samostatné měření.                                                                                                                                                                                                                              |
| 1 — jádro              | Implementováno   | Jeden accepted commit, globální fronta a samostatný tile attach, stale/abort guard, správný lazy lifecycle, hover cleanup. Integrační a browser důkazy níže.                                                                                                                                                                                                                                                                                                                             |
| 2 — viewport           | Implementováno   | Pokrytí a query stav po vrstvách; „Hledat zde“ zůstává dostupné při pohybu i partial/error, lokální posun obnovuje data.                                                                                                                                                                                                                                                                                                                                                                 |
| 3 — data/RAM           | Částečně         | Omezené feature/tile/detail cache, HTTP TTL/no-store, serverové indexy a SQL bbox před limitem, kompaktní OSM přehled a lazy detail, background ingest. V1 i V2 stránkování bez zahození přebývajících záznamů. Low Data je implementován pro média detailu a tile cache (16 místo 32 MiB); zbývá rozšíření na ostatní média/terrain, summary projekce dalších zdrojů a workery/GPU měření. Serverová cache má společný 32 MiB rozpočet serializovaných dat; nejde o limit celého heapu. |
| 4 — rychlé UX          | Částečně         | Portálová galerie/fokus/Escape, cluster expansion, route feature-state a odstranění zdvojené spojnice, skrytá trip timeline se zachovaným odjezdem. Nový minimalizovatelný mapový panel používá stejné filtry jako drawer. Velký redesign/hra zůstávají dle uživatele na později.                                                                                                                                                                                                        |
| 5 — Discover Evropa    | Částečně         | MVT oddělené od průvodce, lokální hover, zoomová hysteréze a fallback, atomický import/rollback. Opraveno chybné sloučení podle shapeISO. Produkce: 91 ADM datasetů, 873 ADM1 + 11 175 ADM2, 240 zemí/území. Neměnné URL edic a automatická obnova manifestu jsou nyní implementované a nasazené. Chybí municipality celé Evropy a přímá vazba detailu na polygon ID.                                                                                                                    |
| 6 — počasí             | Částečně         | Šestihodinové cacheované okno, jediný grid request, jemnější interpolované sektory bez plošných děr. Výběr automatického modelu, ICON a ALADIN je implementován a ověřen v browseru i živým guarded testem. Chybí přesný původ a pokrytí jednotlivých vzorků; seamless volba není záruka 1 km v celé Evropě.                                                                                                                                                                             |
| 7 — adaptéry/data      | Částečně         | WMTS pro podporované WebMercator XYZ matice a ArcGIS FeatureServer jednotlivé vrstvy jsou ověřené fixture i živým smoke. Změna importovaného manifestu obnoví jen příslušný plugin/cache. Základ WMS-T (diskrétní data a pevné intervaly, max. 256 voleb včetně defaultu) je implementován a lokálně ověřen; pokročilé časové domény/legendy zůstávají. Zbývají další matice, ArcGIS paging/fields/polygon fill a skutečné P1 integrační průchody. Katalog není hotový adaptér.          |
| 8 — plánování          | Částečně         | Existující segmentové varianty, výběr na mapě, dlouhé plány a zachování odjezdu testovány v browseru. Zbývají smíšené úseky, prostorové filtry, porovnání sestav a praktické „Kdy vyrazit“.                                                                                                                                                                                                                                                                                              |
| 9 — průvodce/AI/questy | Částečně         | Rozšiřovat existující rozhraní až nad stabilním jádrem, mapa nesmí čekat na AI. Neprohlašovat navržený herní systém za implementovaný.                                                                                                                                                                                                                                                                                                                                                   |
| Nasazení               | Provedeno        | Aktuální release `20260905-wms-migration-recovery`, předchozí `20260905-lazy-pin-lines`. Záloha/obnova/migrace/kompatibilita a HTTP gate prošly, public smoke 7/7. Obsahuje základ WMS-T a opravu migrační historie s novou 0022. Celý produktový plán tím není dokončen.                                                                                                                                                                                                                |

## Další doložené podklady

- `output/performance/viewport-postgis-drill.txt`: prostorový index uživatelských bodů/tras a OSM index ověřeny nad 50 000 záznamy v izolovaném PostGIS. Nejde o univerzální produkční p95.
- `output/performance/boundary-final-drill.jsonl`: skutečná databázová zkouška atomické publikace, rollbacku, MVT fallbacku a odmítnutí kolize poskytovatelů.
- `output/performance/boundary-fixed-identities.jsonl`: konečný stagingový import 91 evropských ADM datasetů bez duplicit.
- [Pokrytí po zemích](2026-09-discover-coverage.md): skutečné počty správních celků a explicitní mezery, nikoli úplné municipalitní pokrytí.
- `e2e/mapFilters.spec.ts`: společný stav drawer/mapový panel v obou směrech, minimalizace a mobilní rozměry.
- `e2e/placeDetail.spec.ts`, `e2e/discoverBoundaries.spec.ts`, `e2e/viewportRefresh.spec.ts`, `e2e/planning.spec.ts`: uživatelské scénáře.

## Převzetí 2026-09-05 — další potvrzené chyby

- `shapeISO` je u některých geoBoundaries souborů společný kód země. Španělsko ADM1 se proto sloučilo do jednoho útvaru. Používáme `shapeID`; chybějící identita a duplicity správních objektů blokují publikaci. Opakovaný import 91 datasetů nemá duplicitní identity.
- Publikace různých providerů sdílí namespace úroveň/kód. Přidán zámek úrovně a kontrola kolizí před náhradou dat, aby se cizí zdroj nepřepsal.
- Cache detailu ignorovala `max-age` kratší než pět minut. TTL nyní respektuje server a má regresní test.
- V2 provider budget ořízl odpověď na 100 řádků, ale mohl přeskočit zbytek původní stránky. Server nyní drží omezený snapshot, klient projde stránky a provede jeden commit. Nativní cursor se použije až po vyčerpání lokální stránky.
- Testy očekávaly starý počet migrací a cest. Aktualizována explicitní očekávání 0017/0018 a parita dvou nových boundary endpointů.
- Port 5173 byl obsazen jiným projektem; browser konfigurace nyní dovoluje samostatný port bez vypnutí cizí aplikace.

### Návazné zadání pro další model (po release, pořadí podle dopadu)

1. Dokončit datové kontrakty ostatních POI zdrojů: povinné summary pole a verze, lazy detail, test přenosu před/po. Zachovat zdrojová ID uložených míst.
2. Doplnit worker/GPU měření a reálný provider benchmark. Fixture výsledky nesmí být vydávány za zrychlení veřejných služeb. Low Data režim musí měnit skutečnou náročnost požadavků/médií, nikoli jen název nastavení.
3. Discover: validace hranic/ostrovů/úplnosti, municipalitní pipeline po zemích, detail přes ID polygonu a plynulejší předání mezi úrovněmi. Neměnné snapshot URL a automatická obnova manifestu jsou již hotové; zachovat je. Nevydávat ADM2 za obec.
4. Počasí: ověřené modelové coverage, prostorově stabilní vzorky, ALADIN/DWD adaptéry, zobrazená modelová/časová metadata. Interpolace sama nezvyšuje přesnost předpovědi.
5. Dokončit P1 adaptéry po jednom: fixture → guarded upstream → transformace → vrstva → čas/legenda → selhání/429 → skutečný smoke/licence. Registraci/API klíče vyžádat až pro konkrétní schválený zdroj.
6. Plánování: smíšené profily po úsecích, „Kdy vyrazit“ z počasí a otevírací doby, uložené sestavy/porovnání. Přepočítávat jen změněné úseky.
7. Brand pinů, animace a herní/QuestLayer návrh dokončit podle odloženého produktového zadání. Přístupnost, reduced-motion a datový budget jsou součástí akceptace.

Každou položku uzavřít konkrétním výsledkem, relevantním testem a naměřeným dopadem. Tento dokument není tvrzením, že všechny fáze původního plánu jsou dokončené.

## Ověřený výkon a release gate 2026-09-05

Chromium 151.0.7922.34, 1440×900, 400 fixture POI na datovou vrstvu + dvě skutečné rasterové lifecycle vrstvy. Každý scénář: 50 posunů, 10 vypnutí/zapnutí a 10 změn podkladu. Měření po explicitním GC.

| Vrstev | Feature requesty | Fixture payload MiB | Heap před MiB | Heap po MiB | Rozdíl MiB | Zdroje/listenery |
| ------ | ---------------- | ------------------- | ------------- | ----------- | ---------- | ---------------- |
| 6      | 76               | 5.01                | 18.94         | 26.48       | 7.54       | stabilní         |
| 12     | 180              | 11.85               | 20.12         | 30.49       | 10.37      | stabilní         |

Oba scénáře splnily limit větší z 15 % / 25 MiB. Nejde o celou RAM prohlížeče: workery/GPU nejsou změřeny, ani reálná odezva providerů. Důkazy: `output/performance/map-6-layers.json`, `map-12-layers.json`.

- Kompletní npm test: SDK 104, adapter SDK 53, runtime 3, API 599 prošlo / 1 skip, web 457 prošlo / 7 skip. Žádné selhání.
- Build všech workspace prošel. Vite upozorňuje na velký MapLibre chunk; to samo není důkaz runtime úniku.
- 17 posledních browser scénářů Discover/galerie/viewport/filtry prošlo; po úpravě mobilního odstupu další 2 filter scénáře prošly.
- Plánovací sada: všech 15 scénářů prošlo během prvního průchodu nebo samostatného opakování jednoho scénáře po restartu dev API; neoznačovat celý první průchod za čistý.
- PostGIS drill ověřil staging/atomickou publikaci/empty rejection/rollback a nově odmítnutí kolize cizího providera.
- Aktuální dry-run balík má 1,89 MB bez lokálních buildů, modelů a secrets. Nasazeno jako `20260905T013214Z-mapos-optimization`; veřejný smoke viz `output/performance/production-smoke.json`.

## Produkční kontrola prvního release a následná oprava průvodce

- Veřejná aplikace: https://mapos.promptstudio3000.com/
- Release: `20260905T013214Z-mapos-optimization`. Předchozí release zůstal dostupný pro rollback; ověřená záloha: `/opt/ps3000/apps/mapos-v3/backups/20260905T013214Z-mapos-optimization`.
- Všech 92 vydání hranic úspěšně publikováno z lokálního stagingu bez dalšího stahování od providerů. Důkaz: `output/performance/boundary-production-publication.jsonl`.
- Veřejná mapa vykresluje skutečné správní hranice, konzole bez chyb při smoke kontrole. Manifest má licence u všech 329 řádků pokrytí.
- Nové konkrétní P1 pro průvodce: při zobrazení Prague, Czechia byl v panelu text „Czechoslovakia was a country in Europe…“ s Wikivoyage attribution. Prověřit region identity → jazykové aliasy → výběr článku → fallback; nevracet širší/historický článek jako potvrzený obsah města. Dodat fixture reprodukující Prague/Czechia/Czechoslovakia a odlišit lokální text, širší kontext a nedostupný zdroj. V prvním release nebyl opraven; následující release jej opravuje podle důkazů níže.

## Druhý release: identita průvodce a neměnné hranice

Nasazeno `20260905T020050Z-mapos-boundary-editions` se zálohou, zkouškou obnovy, migrací 0019 a ověřením kompatibility starého image.

- Průvodce vybírá článek podle Wikidata sitelinku, nebo přesného názvu/explicitního přesměrování. Známou oblast nenahrazuje nejbližším geografickým článkem. Disambiguace a chybějící článek nejsou průvodce. Transport dostává AbortSignal, jazykový fallback se neopakuje.
- Prague/Q1085: živý smoke vrací český článek Praha; produkční Discover v anglickém UI vrací správný článek Prague včetně obsahu města. Důkazy: `guide-prague-live-smoke.json`, `production-boundary-editions-smoke.json` v `output/performance`.
- `geo_boundary_manifests` uchovává neměnnou sadu ID publikovaných vydání. Hash této sady je v URL; serverová coverage i geometrie čtou stejný snapshot. Publikovanou geometrii nelze upravit přes staging helper.
- Staré dlaždice zůstávají byte-for-byte stejné po nové publikaci. Rollback obnoví původní hash. Pro verzované dlaždice se vrací `public,max-age=31536000,immutable`; legacy URL zůstává kompatibilní s krátkou cache. Přidán prostorový index verzovaných geometrií.
- Prohlížeč obnovuje manifest jednou za minutu v aktivním Discoveru; při chybě ponechá poslední vydání. Test ověřil automatickou změnu adresy i zachování všech 25 oblastí.
- DB drill: `output/performance/boundary-manifest-drill.jsonl`; route testy 2/2; průvodce+Discover cíleně 24/24; browser 1/1 včetně celé minuty čekání na refresh.
- Kompletní sada: SDK 104 + adapter SDK 53 + runtime 3 + API 603 + web 457 = 1 220 prošlo, 8 skip, 0 selhání. Build všech workspace prošel.
- Produkční verifikace: 329 řádků coverage, vybraná dlaždice ADM2 obsahuje 134 oblastí / 93 519 bytů; immutable cache header ověřen skutečným HTTP požadavkem.

Další implementační blok: doplnit skutečný feature-source průchod (ArcGIS) a WMTS/WMS-T, spolu s omezeným čekáním na pomalé veřejné POI zdroje. Celý původní plán zůstává aktivní; tento release jej neuzavírá.

## Navazující implementace: WMTS (lokálně, čeká na release)

- Doplněn skutečný WMTS adaptér: capabilities → volba vrstvy → uložený rasterový manifest → existující tile renderer. Podporuje REST i KVP GetTile, deklarované pořadí row/column, prefixy matrix ID, výchozí styl a výchozí hodnoty dimenzí. Výběr jedné vrstvy v dialogu odpovídá protokolu.
- Přijímá pouze ověřené souvislé Web Mercator XYZ mřížky 256 px se správným počátkem, měřítkem a velikostí. Lokální/4326 mřížky, matrix limits a dimenze bez defaultu zůstávají nepodporované. Nejde o úplnou podporu všech WMTS služeb.
- Test odkryl chybu sdíleného XML parseru: samouzavírací značky bez atributů se ztrácely. Opraveno s regresním testem, aby se například nepřehlédly TileMatrixSetLimits.
- Živý NASA GIBS průchod přes **stejný guarded transport jako produkční wizard**: 1 316 katalogových položek, 1 163 kompatibilních; serializovaný probe 496 268 B. Vybraný produkt vrací HTTP 200 / JPEG. `output/performance/wmts-nasa-guarded-smoke.json`, opakovatelné `scripts/wmts-source-smoke.mjs`. Ověřuje transport/formát, nikoli úplnost obrazového pokrytí či licence každého produktu.
- Primární dokumentace: [NASA GIBS access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/), [OGC WMTS](https://www.ogc.org/standards/wmts/).
- Čas se zatím fixuje na default z capabilities při přidání; časový přepínač/automatická aktualizace produktu, WMS-T a ArcGIS FeatureServer viewport průchod stále zbývají. Nepovažovat tuto změnu za dokončení fáze 7.

### Ověření a souběžná práce (05. 09., další WMTS blok)

- Adapter SDK 64/64; cílený průchod XML/registry/WMTS/sourceService 30/30. Browser `e2e/addSource.spec.ts`: **4/4**, skutečné parsování XML na offline serveru, uložení manifestu a následné požadavky mapy na dlaždice; WMS regrese rovněž prošla.
- E2E API nyní běží bez file watcheru. Předchozí běh se přerušil, když sestavení balíčků vyvolalo restart API; nová konfigurace odstranila tuto příčinu nestability.
- Ve stejné složce současně aktivně implementuje úkol **„Přidej datový explorer vrstev“** (`01a06f49-18f7-7bb1-bc25-9912dcd4b9b9`). Jeho statistické soubory, katalog a migrace 0020 nebyly v tomto WMTS bloku upravovány ani vraceny zpět.
- Kompletní test v tomto měnícím se stavu skončil třemi chybami v `statSeriesImport.test.ts` / `themeService.test.ts` (nové dimenze importu, nový přesnější název kriminality, chybějící ikona generovaného tématu). Nejde o čistý celoprojektový výsledek a nesmí se přepsat dřívějšími úspěšnými počty. Opravu a společný release koordinovat nad dokončenou implementací statistik.
- **WMTS zatím není nasazeno**. Produkce zůstává na `20260905T020050Z-mapos-boundary-editions`; další release nesmí přibalit rozpracované statistiky bez ověření. Nevyžaduje nové povolení od uživatele, vyžaduje dokončení kontrol.
- Kompletní build všech workspace po WMTS úpravách prošel. Vite nadále hlásí velikost MapLibre chunku; celkový release gate zůstává otevřený kvůli uvedeným testům/statistické implementaci.

## Navazující implementace: ArcGIS FeatureServer (lokálně)

- Odstraněno tiché přeskočení `server-adapter` manifestů na klientovi. Zdroj nyní používá existující clusterovaný renderer pinů a oddělený renderer linií; polygonové zdroje se zatím zobrazují jako obrysy (omezení současného V1 kontraktu).
- Nový společný endpoint `GET /v2/sources/layers/:id/features` načte pouze manifest vlastněný přihlášeným uživatelem. URL ani SQL dotaz nelze nahradit parametrem požadavku. Vstupní bbox validuje souřadnice a velikost; odpověď je `private, no-store`.
- Transport používá existující DNS pinning/SSRF ochranu, timeout, velikostní limit a provider cache. Zrušení požadavku se předává upstreamu. Klient vrátí data enginu a nesmí zapisovat před jeho kontrolou aktuálního výřezu.
- Jeden importovaný FeatureServer přepínač odpovídá jedné zvolené podvrstvě. Identita bodu obsahuje ID uloženého zdroje. Dotaz žádá maximálně 1 000 záznamů / šest desetinných míst; překročení rozpočtu či upstream transfer limit vrací explicitní partial/notice. Multipart rozpad má samostatný limit 4 000 renderovaných částí. Detailnější zoom je zatím cesta k úplnějším datům, nikoli neomezené stahování služby.
- Živý guarded smoke proti oficiálnímu **editovatelnému příkladu Esri** vrátil 169 prvků / 65 067 bytů v konkrétním malém výřezu. Nejde o přidaný produkční dataset požárů ani obecnou garanci úplnosti. Důkaz `output/performance/arcgis-guarded-smoke.json`, opakovatelné `scripts/arcgis-source-smoke.mjs`.
- Relevantní primární zdroj: https://sampleserver6.arcgisonline.com/arcgis/rest/services/Wildfire/FeatureServer . Význam limitu a geometrie ověřovat pro konkrétní produkční službu.
- Cílené testy služba/route/registry/ArcGIS: 19/19; browser source wizard 5/5 včetně nového dotazu po posunu mapy. Parita aktuálních cest 2/2 (160 produkčních / 155 memory / 154 společných, zahrnuje i novou společnou statistickou cestu ze souběžného úkolu).
- Dál zbývá selektivní projekce polí a lazy feature detail, typované filtry z metadat služby, navazující stránky nad omezeným snapshotem a přímé polygonové výplně přes V2. Neprohlašovat aktuální import za plnou podporu všech ArcGIS funkcí.
- Silnější dodatečný browser důkaz: `queryRenderedFeatures` obsahuje současně fixture bod „ArcGIS místo“ i linii „ArcGIS trasa“; poté posun mapy mění bbox požadavku. Samostatný scénář 1/1.
- API typecheck prošel. Web typecheck po opravě vlastního použití contextu vykazuje pouze tři právě rozpracované chyby ve statistickém `ThemesSection.tsx` / `AppShell.tsx`; tyto soubory zde nebyly přepisovány.
- Aktuální celá sada (během souběžných úprav statistického exploreru): SDK 105/105, adapter SDK 64/64, runtime 3/3; API 594 pass / 14 fail / 1 skip. Selhání se týkají nového migračního očekávání, logování statistického importeru, dimenzí/importu a tematických fixture/metadata. Web sada se po API selhání nespustila. Nejde o úspěšný release gate. Log `/tmp/mapos-arcgis-full-tests.log`.
- WMTS i nový ArcGIS průchod čekají na společné ověřené nasazení. Další nezávislý výkonnostní blok: odstranit čekání všech POI zdrojů na nejpomalejší odpověď (`poiFusionService`), zachovat bounded cache a jednoznačný partial/loading stav.

## Průběžné slučování veřejných POI (lokálně)

- Interaktivní `osm-poi` a `vanlife` fusion čeká nejvýše 750 ms na aktuálně rozpracované zdroje, poté vrátí dostupná místa a `loading` metadata chybějících zdrojů. `partial` odpověď nese `retryAfterMs: 2000` a `cacheTtlMs: 0`; engine ji doplňuje existujícím omezeným pollingem.
- Stejný bbox / kategorie / sada zdrojů sdílí jeden rozpracovaný snapshot. Změna pořadí kategorií či zdrojů nespouští duplicitu. Deduplikace dostává kopii, aby nesměla měnit snapshot používaný dalším pollem.
- Lokální OSM/community čtení má samostatné dvě pozice, vzdálené zdroje čtyři. Fronta je omezená na 64 čekajících úloh, nejvýše 24 snapshotů a 8 MiB payloadů (+ pevně omezená chybová metadata). Při tlaku se nejdřív odstraní dokončené snapshoty opuštěných výřezů. Po doručení úplného výsledku snapshot zaniká; nejde o novou TTL cache nad pravidly providerů.
- Neinteraktivní interní klienti (brief, vyhledání trasy, AI) si zachovávají dosavadní čekání na požadované zdroje. Průběžný režim se zapíná výslovně pouze v mapových providerech, kteří už mají polling kontrakt.
- UI zachová stav zdroje `loading`; čekání na doplnění označuje „Další výsledky se načítají…“, nikoli jako dokončené hledání.
- Cílené coordinator/fusion testy 7/7, mapStore 14/14, existující engine testy prošly v kombinované sadě. První běh nové store zkoušky měl chybný testovací getter; opravený běh 14/14. API typecheck prošel.
- Kontrolovaný benchmark `output/performance/progressive-places-smoke.json`: první 400 míst 773,9 ms; všech 800 míst 2 054,3 ms při umělém zpoždění 2 000 ms. Po dokončení nula snapshotů/payloadů/fronty. Nejde o měření reálných providerů ani celkové browser RAM.
- E2E dovoluje také `MAPOS_E2E_API_PORT`; Vite proxy dostává odpovídající `MAPOS_DEV_API_PORT`. Důvod: port 4033 během testu obsadil souběžný úkol; cizí proces nebyl ukončen. Aktuální profil zde používá API 4035 a web 5178.
- Zbývá provozní ověření reálné latence a zátěže; serverové interní neinteraktivní volání a plné propagování zrušení přes všechny poskytovatele řešit samostatně. Nová část zatím čeká na společný release.
- Browser `e2e/viewportRefresh.spec.ts` 3/3: malý posun, vzdálený skok s „Hledat zde“ a skutečné vykreslení prvního místa před doplněním druhého bez pohybu mapy.
- Závěrečný web typecheck také prošel (souběžný explorer mezitím opravil dřívější typové chyby). Celou sadu/release gate zopakovat nad stabilním společným stavem; tento dílčí úspěch neřeší dřívější statistická selhání automaticky.

## Úsporný režim — rozpracovaný ověřovací blok

- Přidána persistovaná preference `lowData` (výchozí false, starší nastavení zůstává kompatibilní) a přepínač v mapových nastaveních, česky i anglicky.
- `App` propojuje volbu se skutečným tile cache budgetem 16/32 MiB. Neznamená to automaticky méně přenosů dlaždic při návratu do dřívější oblasti; jde o limit RAM.
- Detail místa v úsporném režimu nepředává fotografie do hero/info galerie a nevyhledává doplňkovou Wikidata fotografii, dokud uživatel nestiskne „Načíst fotografie a média“. Souhlas platí pro identitu otevřeného místa. Metadata detailu se nadále načítají; tento krok není plošná projekce všech POI polí ani omezení médií celé hry.
- Jednotkové preference/cache testy 11/11. Nové browser scénáře mají ověřit nulový přenos fixture obrázku před kliknutím, načtení po kliknutí, 16MiB runtime limit a perzistenci přepínače.
- **Browser ověření ještě neprošlo:** oba pokusy skončily při startu webServer (60 s a 120 s), před spuštěním scénářů. Nejde o důkaz funkčnosti ani o potvrzenou chybu UI. Samostatné porty API 4035 / web 5178; cizí procesy nebyly ukončeny.
- Web typecheck spuštěný touto prací byl při poslední kontrole stále živý, session **56926**, log `/tmp/mapos-low-data-types.log`. Nejprve znovu ověřit tento handle; nespouštět další kopii jen kvůli uplynulému času. Poslední browser log `/tmp/mapos-low-data-browser-recheck.log`, terminal timeout.
- Úpravy zůstávají lokální, nenasazené. Dokončit ověření tohoto bloku před dalším release. Celý plán stále není dokončen.

### Ověření úsporného režimu — navázání

- Původní typecheck session 56926 skutečně skončila s exit 0; nebyla spuštěna náhradní kopie.
- První dokončený browser běh: nový Low Data scénář **prošel**. Ověřil nulu fixture obrazových přenosů před kliknutím, obrázek po kliknutí a skutečný 16 MiB limit. Dva ostatní scénáře doběhly do limitu při načítání panelu: Settings snapshot explicitně obsahuje progressbar „Loading“. Nejde o čistý průchod celé sady.
- Pro studený start dev chunků mají nyní tyto browser scénáře větší limit. Běží opakování `/tmp/mapos-low-data-browser-verified.log` (session 96001); nejdříve ověřit jeho skutečný stav, nespouštět duplicitní server.
- Doplňková konkrétní chyba: `getPlaceDetail` zahazoval `description` získaný resolverem. Pole se nyní předává do panelu; `placeDetailService.test.ts` 11/11, včetně regresní zkoušky úplného textu až při otevření detailu.
- Načtení Wikidata fotografie má vlastní efekt; ruční povolení médií už neopakuje dotaz na textová metadata ani jejich loading reset.

### Nový nález při společném ověření a rozpočet upstream cache

- Opakovaný browser běh `/tmp/mapos-low-data-browser-verified.log` narazil na konkrétní chybu Vite: `App.tsx` importuje dosud neexistující `./world/world.css`. Nejde o další důkaz pomalého panelu; aplikace v tomto stavu nemůže správně startovat. Vedle statistik ve stejné složce aktivně implementuje úkol **„Navrhni herní a sociální vrstvu“** (`01a06f64-870c-7ae3-9bde-97bf3fed31f3`). Import i soubory `world` pocházejí z jeho právě probíhající implementace. Nebyly odstraněny ani nahrazeny prázdným CSS pouze kvůli testům.
- Sdílená serverová upstream cache měla pouze limit 500 odpovědí; při velkých odpovědích neomezovala celkový objem. Doplněn rozpočet **32 MiB zakódovaných payloadů včetně klíčů**, zachován limit položek, odstraňování expirovaných odpovědí a vytěsňování podle posledního použití. Velikost využívá již načtené byty, ne opakovanou serializaci JSON.
- Jde o rozpočet uchovávaných vstupních dat, **nikoli přesný limit JS heapu**; dekódované objekty, současně rozpracované požadavky a GPU mají další náklady. Tato oprava sama neřeší browser RAM.
- `upstream.test.ts` **10/10**, včetně pěti odpovědí po 7 MiB: často používaná zůstane v cache, nejdéle nepoužívaná se znovu stáhne. Log `/tmp/mapos-upstream-budget-tests.log`. API typecheck běží samostatně v `/tmp/mapos-upstream-budget-types.log` (session 13401); před dalším spuštěním ověřit dokončení.
- Celkový plán ani společný release nejsou dokončené. Nové lokální změny nebyly nasazeny přes rozpracovanou herní/statistickou implementaci.
- Uvedené procesy už skutečně skončily: browser session 96001 **exit 1 / 3 failed**, všechny scénáře čekají na prvky aplikace, která v logu nedokáže přeložit chybějící world CSS. API typecheck rovněž **exit 2**, nová world integrace v `index.ts` odkazuje na nedostupné `db/users/eq` a memory integrace na neexistující `MemoryUser.avatarUrl`. Nejde o čistý typecheck. Další opravy a opakování celkového ověření provést nad dokončeným společným stavem; tyto již ukončené procesy neobnovovat.

### Čerstvost importovaných prvků a striktní cache politika

- Viewport ArcGIS používá samostatný guarded JSON transport: 30 s místo desetiminutové capabilities cache, rozpočet odpovědi 4 MiB, vlastní stabilní provider ID `user-source-features`. Zachovává validaci adres, DNS pinning, timeout i signál zrušení. Výsledná query předává také 30s platnost klientské cache.
- Dvě úrovně cache mohou mít dohromady až přibližně 60 s stáří dat při novém použití. Nejde o push/realtime stream; stojící mapa se neobnovuje sama jen vypršením TTL. Při ručním obnovení engine překročí vlastní cache, server může ještě použít svou krátkou kopii.
- Upstream klíč nyní zahrnuje také TTL, maximální velikost a přijímané typy. Dříve mohl požadavek `ttlMs: 0` převzít deset minut starou cache a menší velikostní limit se na cache hitu neuplatnil. Nové klíče oddělují také souběžné požadavky s rozdílnou politikou; celkový byte/entry budget zůstává společný.
- Cílená sada upstream/sourceFeatures/sourceService **25/25**, log `/tmp/mapos-source-cache-policy-verified.log`. Po doplnění klientské TTL assertion následný sourceFeatures **5/5**, `/tmp/mapos-feature-freshness-final.log`. První testovací fixture neposkytovala `displayFieldName`, takže se kontrolovalo nezměněné náhradní jméno; fixture opravena na skutečný ArcGIS kontrakt, opakování prošlo.
- Nový API typecheck `/tmp/mapos-source-cache-policy-types.log`, session **47346**, byl při poslední kontrole živý. Ověřit jeho terminální výsledek před náhradním spuštěním. Žádný nový release dosud neproběhl.

### Aktualizace importovaných zdrojů a identita cache

- API typecheck session 47346 už skončil **exit 2**: stejné chybějící `db/users/eq` a `MemoryUser.avatarUrl` v rozpracované world integraci. Nová source/upstream část v jeho výpisu nemá typovou chybu; nejde však o čistý celoprojektový výsledek.
- `syncSourceLayers` dříve navždy přeskočil existující ID. Nyní porovnává uložený vstup (název, barvu, manifest) s konkrétním registrovaným pluginem. Změna nahradí jen tento plugin, nezměněný zůstává totožný. Odstraněná ID jsou rovněž vrácena volajícímu, aby `layers-changed` skutečně odpojilo jejich renderer.
- V2 registrace má výslovnou volbu `replace`; validace a převod proběhnou před odebráním původní registrace. Neplatná aktualizace proto zachová poslední funkční vrstvu. Běžná registrace nadále odmítá duplicitní ID.
- Engine při výměně aktivního pluginu odstraní cache příslušné vrstvy. Klíče navíc obsahují revizi identity pluginu, takže ani změna během vypnutí nemůže znovu použít body starého zdroje. Opětovné zapnutí nezměněného pluginu jeho cache zachová. Revize a podpisy používají WeakMap; staré odpovědi zůstávají pod společným omezeným budgetem.
- Cílená finální sada sourceLayers + LayerEngine **20/20**, `/tmp/mapos-source-settings-final.log`: změna manifestu, nedotčený sousední plugin, opakovaný vstup, neplatná aktualizace, odebrání a výměna pin zdroje zapnutého i dočasně vypnutého. Předchozí průchody 18/18 a 19/19 byly rozšířeny o nově odhalené případy cache.
- Web typecheck `/tmp/mapos-source-settings-types.log` (session **54485**) zatím běží. Při poslední fyzické kontrole už `apps/web/src/world/world.css` existoval; dřívější browser chyba proto musí být ověřena znovu, nelze ji bez dalšího označovat za stále aktuální. Společné nasazení a zbývající fáze plánu jsou nadále otevřené.
- Nové browser ověření skutečně spuštěno: session **29711**, `/tmp/mapos-low-data-world-recheck.log`, API 4035 / web 5178, tři scénáře photo/low-data/persistent preferences. Nejprve sledovat tento proces, nespouštět další kopii při pouhém čekání na startup.

### Počasí: volba modelu (nová lokální implementace)

- Browser session 29711 skončila **exit 1**, tentokrát timeoutem startu webServer 120 s před scénáři; původní chyba chybějícího CSS už nebyla reprodukovaná. Web typecheck 54485 nadále potvrzen živý, jeho výsledek ještě nelze prohlásit za úspěch.
- Do numerického počasí přidán výběr `best_match`, `icon_seamless`, `chmi_aladin_seamless` v panelu vrstev. Radar zůstává samostatným zdrojem. Filtr putuje existujícím rendererem do `/weather/grid`, server ho validuje a posílá jako `models` Open-Meteo. Grid vrací požadovaný model; šestihodinová cache zahrnuje model do klíče. Offline fixture stejnou volbu validuje.
- Český a anglický popis rozlišuje automatický výběr, DWD ICON a ČHMÚ ALADIN. Menší sektory nejsou vydávané za vyšší rozlišení modelu. Seamless je kombinace domén/časů, nikoli důkaz konkrétního nativního modelu každé buňky; přesné prostorové pokrytí a modelový původ jednotlivého vzorku zbývá doplnit.
- Aktuální primární zdroje: [Open-Meteo CHMI API](https://open-meteo.com/en/docs/chmi-api), [DWD API](https://open-meteo.com/en/docs/dwd-api). CHMI dokumentace uvádí 1 km českou / 2,3 km středoevropskou doménu a třídenní horizont, po něm kombinování s ECMWF. Živý ukázkový odkaz z dokumentace pro `models=chmi_aladin_seamless` skutečně vrátil pražskou hodinovou předpověď; není to ještě guarded integrační průchod přes API MapOS.
- První cílená sada počasí **13/13** (`/tmp/mapos-weather-model-tests.log`). Po přidání testu normalizace modelu a offline validace běží rozšířené ověření `/tmp/mapos-weather-model-final.log`. UI browser přepínání, guarded live smoke obou modelů a celkový typecheck/build jsou stále povinné před označením tohoto bloku za hotový a před nasazením.
- Rozšířený běh skutečně dokončen (session 4255, exit 0): **18/18**. Web typecheck session 54485 zůstává živý; nejdříve ověřit tento handle. Nejde o povolení přeskočit zbývající integrační kontroly.

### Živý průchod počasí a společný stav

- Web typecheck 54485 potvrzen **exit 0**. Nový aktuální API typecheck 12640 skončil **exit 2**, tentokrát jen implicitním `any` callbacku v `worldRoutes.test.ts`; následná fyzická kontrola již ukázala doplněný typ od souběžného herního úkolu. Je třeba nový společný build, nelze starou chybu dále vydávat za aktuální.
- Nový opakovatelný `scripts/weather-model-smoke.mjs` používá přímo `fetchWeatherGrid` a guarded transport. **Všechny tři modely prošly**, každý 4 číselné vzorky v malém pražském výřezu: automatický 2 005 ms / 289 B, ICON 143 ms / 292 B, ALADIN 240 ms / 313 B. Byty jsou výsledný grid, nikoli celá upstream odpověď. Důkaz `output/performance/weather-model-guarded-smoke.json`; neprokazuje Evropu ani celkové browser zatížení.
- Nový browser scénář v `e2e/weatherAdaptive.spec.ts` skutečně prošel změnou výběru a dotazy pro oba modely. První běh selhal až na očekávaném českém zápisu `2,3 km` v anglickém prostředí (`2.3 km`). Assertion opravena pro oba jazyky, opakování **session 13609**, log `/tmp/mapos-weather-model-browser-verified.log`, ještě bez závěrečného výsledku. Ověřuje také zachování stejné instance mapy.
- Route/fixture ověření **5/5**, `/tmp/mapos-weather-model-routes.log`: neznámý model odmítnut před transportem, platný ALADIN skutečně v upstream URL i výsledném gridu, offline modelové odpovědi ve shodném kontraktu.
- Úkol **„Přidej datový explorer vrstev“** již dokončil svůj aktuální běh (109 cílených testů podle jeho výstupu, širší plán přiznaně neúplný); **„Navrhni herní a sociální vrstvu“** je stále aktivní. Tyto počty nejsou náhradou za nový společný test/build a release gate v tomto úkolu.

### Obnova podkladu: pouze schválená data

- Browser počasí session 13609 dokončena **exit 0 / 1 passed** (2,1 min včetně studeného startu). Ověřuje přepnutí obou modelů a zachování stejné instance mapy. `/tmp/mapos-weather-model-browser-verified.log`.
- Společný build skutečně spuštěn a potvrzen živý: **session 14997**, `/tmp/mapos-optimization-integrated-build.log`, aktuálně API kompilace po sestavení sdílených balíčků. Neopakovat, dokud tento proces neskončí.
- Další audit odhalil porušení principu jednoho schváleného zápisu v `MapLibreDataLayerLifecycle`: `update()` si ukládal odpověď ještě před stale-response guardem enginu. Při `style.load` pak mohl obnovit odpověď, kterou engine správně odmítl. Nyní snapshot pro obnovu zapisuje pouze `setData()`, tedy skutečný commit od vlastníka.
- Cílený runtime test **2/2**: schválená data se obnoví, opožděná neschválená odpověď je nepřepíše. `/tmp/mapos-lifecycle-accepted-data-tests.log`. Runtime starter už používá explicitní `setData`, jeho tok nebyl změněn.
- **Pozor na build výsledek:** fyzická kontrola `packages/map-runtime/dist/maplibreLifecycle.js` ukázala, že rozběhnutý společný build sestavil tento balíček před poslední opravou. Po dokončení 14997 je nutné znovu sestavit map-runtime a navazující web/runtime-starter (případně celý build). Ani případný zelený výsledek tohoto prvního běhu proto ještě není ověřeným finálním releasem.

### Společný build a integrační testy

- Build 14997 dokončen **exit 0**, následně znovu sestaven map-runtime, web a runtime-starter s opravou schválených dat (session 5453, **exit 0**). Architektonické a CSS kontroly rovněž prošly. Build upozorňuje na statický import WorldHud, který ruší jeho lazy chunk; nutné řešit s dokončenou herní integrací, nikoli ignorovat jako splněnou optimalizaci.
- Kompletní web sada: **467 pass / 7 skip / 0 fail**, `/tmp/mapos-integrated-web-tests.log`. Kompletní API: **626 pass / 1 skip / 6 fail**, `/tmp/mapos-integrated-api-tests.log`. Nejde o čistý společný release gate.
- Opraveny dva migrační testy: skutečný runner obsahuje ověřené aditivní 0020 `stat_releases` a 0021 `aavegotchi_social_world`, očekávání stále končilo 0019. Nejde o PostgreSQL integrační drill; ten zůstává součástí nasazení.
- Statistické CLI už nevypisuje syrový text providerové chyby, používá `safeErrorLogFields`. Cílená sada migrace/transport/AI routes **21/22**; zbývá přímý fetch a viem transport v aktivně upravovaném `world/gotchi.ts`. Je nutné opravit transport, nikoli přidat výjimku do kontroly.
- Náhodné selhání AI orchestrace identifikováno: `nanoid()` může vytvořit uživatele s počátečním `-` nebo `_`, validátor konverzace ho odmítal. Nyní obě hodnoty přijímá, zachovává omezení délky a znaků. Testuje se vytvoření, append a oddělení vlastníků, odmítnutí cest/mezer; conversation + AI routes **19/19**, `/tmp/mapos-ai-nanoid-tests.log`.
- Zbývá také obnovit úplnou inventuru rout: statický verifier nyní počítá 161 proti uloženým 160; world registruje část endpointů dynamicky, takže samotné navýšení čísel nemusí prokázat úplnost. Poslední dvě API úpravy (logování, identifikátory) vznikly po buildu a vyžadují nové sestavení před releasem. Všechny zde uvedené procesy už jsou terminální, žádný z těchto handle není třeba dále pollovat.

### Sjednocení transportu a inventury API

- `world/gotchi.ts` nyní používá guarded fetchJson/fetchBytes a viem custom RPC přes tentýž transport. Indexer, renderer, modely a RPC mají samostatné stabilní provider ID, timeouty, datové limity a TTL 0. Vlastnictví se ověřuje vždy znovu; modelové soubory stále používají stávající diskovou cache. Nepřidána žádná výjimka do transportové kontroly.
- Guarded testy **4/4**, API typecheck **exit 0** (`/tmp/mapos-gotchi-guarded-types.log`). Test prokazuje opakovaný RPC dotaz bez stale ownership cache, odmítnutí jiného vlastníka a blokaci privátní DNS adresy před síťovým requestem. Živý end-to-end výběr konkrétního NFT nad novým transportem ještě nebyl znovu proveden.
- Statická inventura rozumí konstantním prefixům, jejich spojování a místním obalovým funkcím jako `post(path, handler)`. Kontrola explicitně vyžaduje reprezentativní world HTTP/WS endpointy v obou kompozicích. Počet nově **193 production / 188 memory / 187 shared**; rozdílové množiny stále přesně odpovídají dokumentovaným výjimkám. Dynamické routy sestavované libovolným runtime kódem nejsou obecně vyhodnocovány; skutečná registrace world zůstává kryta jeho integračními testy.
- Cílený společný recheck routeParity/providerTransport/migrations/gotchi **15/15**, `/tmp/mapos-integration-gates-recheck.log`. Znovu spuštěna kompletní API sada `/tmp/mapos-integrated-api-verified.log`; výsledek zatím čeká. Nové API změny a verifier vyžadují finální build před releasem.

### Zelená integrace a další skutečný nález před releasem

- Kompletní API session 54107 dokončena **635 pass / 1 skip / 0 fail**, `/tmp/mapos-integrated-api-verified.log`. Nový celý build session 29715 **exit 0**, `/tmp/mapos-final-integration-build.log`, zahrnuje poslední transport i opravy konverzací a runtime.
- Odstraněn statický import WorldHud/WorldSocial z hlavního App. Nová lehká `WorldUiBoundary` načte ActionBar jen v herním režimu a sociální panel při prvním otevření; již otevřený panel zůstává připojený kvůli cleanupu filtru a zachování záložek. WorldBridge/transport zůstává samostatný. Build má samostatné WorldHud/WorldSocial chunky; hlavní JS 2 136,26 → 2 101,51 kB, gzip 610,46 → 600,04 kB. Je to dílčí úspora, nikoli vyřešení celého hlavního balíčku.
- Browser galerie/Low Data/preferences **3/3** (`/tmp/mapos-low-data-final-browser.log`, 40,2 s). Nový browser `worldUiLoading.spec.ts` **1/1**, potvrzuje nulové WorldHud/WorldSocial requesty při běžném Discover startu a načtení/otevření/zavření sociálního panelu až na vyžádání. `/tmp/mapos-world-ui-loading-browser.log`.
- Oba souběžné úkoly jsou nyní neaktivní. Herní úkol skončil limitem účtu, nikoli finálním potvrzením hotové hry; dokončení jeho browser/produkčních kontrol se musí převzít zde. Nečekat dál na jeho autonomní pokračování.
- Sdílené SDK/adapter/runtime testy dokončeny exit 0 (adapter 74/74, runtime 4/4). Dry-run nasazení úspěšný, 1 981 130 B, `/tmp/mapos-integration-deploy-dryrun.log`; **žádná síťová změna ani nasazení neproběhly**.
- Explicitní advisory audit zdrojů nyní **5 pass / 2 fail**, `/tmp/mapos-current-source-rights.log`. Chybí inventurní metadata nově přidaných basemapů a odkazů/hostů: OSM France/HOT, memomaps, geoBoundaries/NaturalEarth, Opencaching/heritage/Turf, OpenInfraMap, EEA, Eurostat, AWS terrain a fixture mapos.app. Některé jsou jen atribuce, jiné skutečné požadavky; před opravou je rozlišit. Neoslabovat test ani nevymýšlet licence. Audit je v prototype režimu poradní, ale chybějící evidence je skutečná dokumentační práce.
- Všechny procesy spuštěné v tomto bloku už terminální; žádný živý test/build handle nezůstává.

### Doplněná poradní inventura zdrojů

- Doplněny konkrétní hosty a rozlišení tile/API/outbound-link pro OSM France/HOT, ÖPNVKarte, geoBoundaries, Natural Earth, Opencaching, Wikimedia Heritage, Turf, OpenInfraMap, EEA, Eurostat a Tilezen. U neověřených podrobných práv je výslovně uvedeno datasetové či zdrojové ověření; přítomnost v inventuře není blanket schválení jakéhokoli obsahu hostu.
- Ověřené primární podklady: [OSM France usage](https://www.openstreetmap.fr/usage/), [ÖPNVKarte](https://www.xn--pnvkarte-m4a.de/), [geoBoundaries API](https://www.geoboundaries.org/api.html), [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/), [AWS terrain registry](https://registry.opendata.aws/terrain-tiles/). ÖPNVKarte odlišuje volný obsah od serverové kapacity; Tilezen odkazuje na licence jednotlivých elevací. Inventura S3 se vztahuje pouze na použitý elevation-tiles-prod bucket.
- HOT basemap nyní kredituje také OSM France jako hostitele dlaždic a uvádí jeho provozní podmínky. KitGallery používá dokumentační `mapos.example` místo skutečné domény `mapos.app`; nebyla přidána široká výjimka pro reálné hosty.
- Explicitní audit **7/7**, `/tmp/mapos-source-inventory-final.log`, session 3696 exit 0. První opakování správně odhalilo chybějící označení podmínek u nového atribučního řádku; doplněno a celé ověření znovu prošlo. Nejde o důkaz úplné licenční kontroly každého nového datasetu.
- Změna atribuce SDK a webové inventury vznikla po posledním buildu; před nasazením znovu sestavit artefakty. Žádný živý proces z tohoto bloku nezůstává a žádný nový release nebyl proveden.

### Další převzetí: skutečný stav a pozdní aktivace světového transportu

- Ověřen poslední lokální release build `/tmp/mapos-release-candidate-build.log`, exit 0. Předchozí společné API 635 pass / 1 skip a web 467 pass / 7 skip nejsou důkazem dokončení všech produktových fází.
- Nový nález v `apps/web/src/world/runtime.ts`: po zavření sociálního panelu, opuštění hry, změně účtu nebo skrytí tabu mohl dokončit starý capability/session request a zapnout GPS/WebSocket. Po každém await se nyní znovu ověřuje aktuální poptávka, účet, režim, viditelnost a generace; zastaralé chyby také nemění nový stav.
- Browser regresní scénáře v `e2e/worldUiLoading.spec.ts` pokrývají zpožděné capabilities i session a zachovávají test lazy UI. Finální browser sada 3/3 (`/tmp/mapos-world-startup-final.log`), web typecheck a web build exit 0. Tato oprava vznikla až po zabalení integračního vydání a potřebuje samostatný následný release.
- Horní přehled opraven: Low Data, model selector a základ WMTS/FeatureServer již nejsou označeny za zcela chybějící. Historické zápisy níže/ výše jsou chronologie, nikoli aktuální seznam závad.

### Konkrétní další implementace smíšených úseků (fáze 8)

1. `packages/layer-sdk/src/v2/plan.ts` a JSON schema: volitelná politika úseku, validace a jednoznačné dědění globální politiky. Zachovat načtení starých dokumentů. Nepoužívat výstupní `segment.profile` jako vstupní politiku.
2. `planCommands.ts`: příkaz nastavit/vymazat politiku úseku, undo/revision, hash efektivní politiky po dvojici zastávek. Reorder musí zachovat nezměněné dvojice včetně override; změna globálního profilu nesmí zbytečně invalidovat plně přepsané úseky.
3. `apps/api/src/services/segmentRoutingService.ts`: fingerprint, plánování fronty, provider request, alternativy a warnings musí používat tutéž efektivní politiku úseku. Nyní všechny používají globální politiku.
4. Zkontrolovat `adventureRoutingService.ts` a vstupní gate v `planV2Routes.ts`, které nyní také předpokládají jedinou globální preference. Vozidlová omezení nepřenášet slepě do pěších/cyklo úseků.
5. Editor mezi zastávkami, jasné zděděné/vlastní nastavení, jediný přepočet změněného úseku. `planItinerary.ts` uvést profil po úsecích. `externalHandoff.ts` nesmí exportovat smíšený plán jako jediný globální mód: nabídnout jednotlivý úsek nebo poctivě nepodporovaný export.
6. Testy: starý dokument, změna jedné nohy = jediný provider call, návrat k dědění, reorder a undo, neplatný profil, zastaralá odpověď, uložit/načíst a export. Až pak browser a release.

### Produkční kontrola a nově zjištěná priorita

- Integrační release `20260905-optimization-integration` dokončen, exit 0. Prošly povinné build/backup/restore/migration/HTTP/rollback-compatibility gates. Veřejný health OK, boundary manifest zachoval revizi `382f12c61e14a4408f7918228276864cf409be8ec9fe08366291788df4ef728e` a 329 coverage skupin.
- Skutečný produkční browser načetl mapu a Discover, konzole 0 errors / 0 warnings. Screenshot `output/playwright/optimization-production.png`. To není důkaz správnosti všech dat: nadpis Prague, populace 22 967 a popis Prahy 1 jsou vzájemně neslučitelné.
- **Priorita před dalšími funkcemi:** `normalizeNominatimRegion` v `apps/api/src/services/discoverService.ts` bere název z vybrané položky adresní hierarchie, ale OSM ID, Wikidata, populaci a geometrii vždy z celého reverse výsledku. Pokud reverse vrátí městskou část a UI zvolí rodičovské město, metadata se přisoudí jinému území. Doplnit důkaz identity objektu pro vybranou úroveň, jinak její metadata nepřenášet; případně dohledat přesný rodičovský objekt. Test musí obsahovat Praha/Praha 1 a kraj/město, různé preferované úrovně a fallback. Dosavadní fixture bez objektového name tento nesoulad neodhalí. Neřešit hardcoded populačním číslem ani přejmenováním pouze nadpisu.
- Screenshot také ukazuje příliš husté překrývající se clustery při zoomu 8. V navazující UX práci měřit screen-space hustotu a překryvy; nezvětšovat plošně všechny kruhy. Oddělit rozměr grafiky od dotykové plochy a při malém zoomu omezit hustotu agregací.
- Přidán bounded PerformanceObserver do `e2e/performanceMap.spec.ts`: count/total/max/p95 dlouhých úloh (max. 10 000 vzorků), společně s původním heap/DOM/listener scénářem. Je to měření celého fixture scénáře včetně startupu, nikoli p95 interakce ani worker/GPU RAM.

### Finální stav tohoto ověřovacího bloku

- `20260905-world-startup-guard` nasazen, proces exit 0, všechny služby healthy. Public smoke 7/7 (`/tmp/mapos-final-public-smoke.log`), zahrnuje veřejný web/health a existující bezpečnostní kontroly. Žádný rozpracovaný rollout nezůstává.
- Browser startup guard 3/3, web typecheck/build exit 0. Výkonnostní scénář 2/2 (`/tmp/mapos-performance-longtasks.log`, 3,5 min).
- 6 vrstev: heap delta po GC **7,95 MiB**, 68 long tasks, p95 jejich délky **228 ms**, max **497 ms**, součet **12 423 ms**.
- 12 vrstev: heap delta po GC **10,59 MiB**, 251 long tasks, p95 jejich délky **748 ms**, max **1 003 ms**, součet **51 919 ms**. Počet sources/layers/listenerů se vrátil na výchozí stav.
- Výsledky jsou z lokálního fixture/dev scénáře. Long-task p95 je percentil pouze úloh nad 50 ms, nikoli všech interakcí; součet obsahuje startup a všechny kroky. Worker/GPU RAM není změřena. **Paměťový gate prošel, plynulost není prokázána.** Příští výkonový krok: produkční build pod stejnými fixtures, trace s attribution dlouhých úloh, rozdělit čas React/GeoJSON/MapLibre a opravit hlavní příčinu. Neoptimalizovat naslepo podle velikosti cache.
- Aktuální bezprostřední pořadí: (1) vazba identity Discover Praha/Praha 1, (2) diagnostika a odstranění dlouhých úloh, (3) další dosud otevřené fáze podle schváleného plánu. Rozsáhlejší herní a brand návrh nemá nahrazovat tyto závady.

### Oprava identity Discover — navazující implementace

- `normalizeNominatimRegion` již nepřebírá OSM ID, Wikidata, populaci, NUTS ani geometrii potomka pro nadřazenou adresní položku. Shodu musí doložit objektové name/namedetails a addresstype. Neidentifikovaný rodič má stabilní ID odvozené z celé hierarchie a země, nikoli ID jiného objektu.
- `resolveDiscoverRegion` při takovém výsledku provede jedno omezené, 24 hodin cacheované dohledání rodiče. Přijme pouze jedinou shodu názvu, úrovně, země, rodičovské hierarchie a bbox obsahujícího původní bod. Nejednoznačnost či chyba ponechá poctivý výsledek bez cizích metadat. Signal se přenáší do obou providerových požadavků. Není to dotaz při hoveru ani náhrada za plánovaný přímý lookup polygon ID.
- Živý guarded průchod pro původní produkční bod 14.42/50.08, zoom 8, en nyní vrací `nominatim:relation:435514`, Wikidata `Q1085`, skutečnou polygonovou hranici Prahy, populační seed 1 397 880 pro rok 2025 a průvodce `https://en.wikivoyage.org/wiki/Prague`. Důkaz `output/performance/discover-parent-identity-smoke.json`.
- Cílené testy **18/18**, API build exit 0. Testují oddělení rodiče/potomka, přeložené názvy, jinou úroveň stejného názvu, chybějící důkaz, ambiguitu a cizí bbox. První plná sada 637 pass / 1 fail / 1 skip odhalila chybný zoom testu (žádal admin2, nikoli locality); fixture scénář opraven na zoom 12 a cíleně znovu prošel. Nová úplná sada právě běží v `/tmp/mapos-discover-parent-api-verified.log`; její výsledek nepředjímat.
- Primární kontrakt ověřen v [Nominatim output](https://nominatim.org/release-docs/latest/api/Output/) a [reverse](https://nominatim.org/release-docs/latest/api/Reverse/): extratags/geometry patří vrácenému objektu, nikoli všem adresním rodičům.
- Tato nová oprava je zatím **lokální**, produkce nadále `20260905-world-startup-guard`. Před označením za nasazenou dokončit test a další standardní rollout. Následně zopakovat veřejný Discover screenshot.

### Oprava důkazů výkonu: režie automatizace

- Úplná API sada nové identity **638 pass / 1 skip / 0 fail** (`/tmp/mapos-discover-parent-api-verified.log`). Standardní rollout `20260905-discover-parent-identity` běží; aktuální výsledek ještě nepředjímat.
- Nový volitelný CPU sampler `MAPOS_PERF_CPU_PROFILE=1` v performanceMap a čtecí `scripts/summarize-cpu-profile.mjs` ukázaly ve 12vrstvém scénáři podstatnou režii `typedArrayToBase64`, `innerSerialize` a dalších automatizačních funkcí. Příčina ověřena v testu: `page.evaluate(() => map.jumpTo(...))` vracel fluent MapLibre objekt a nechal serializovat celou mapu.
- Opraveno na callback bez návratové hodnoty pro všechny 50 posunů a návrat výřezu. Stejná chyba odstraněna ze dvou viewport a dvou boundary scénářů. **Předchozí long-task hodnoty 228/748 ms p95 a 497/1003 ms max jsou kontaminované měřicím nástrojem a nesmějí být uváděny jako latence samotné aplikace.** Ani CPU samplování není bez režie.
- Opravené měření právě běží (`/tmp/mapos-performance-corrected.log`); po něm uložit nové hodnoty a znovu rozhodnout podle profilu, nikoli mechanicky optimalizovat cache či renderer.

### Dokončený release identity a opravené měření

- Nasazení `20260905-discover-parent-identity` dokončeno exit 0. Public smoke 7/7, `/tmp/mapos-discover-parent-public-smoke.log`. Produkční `/v2/discover/context` vrací Prague / relation 435514, populace 1 397 880 pro rok 2025 s Q1085, průvodce celé Prahy. JSON `output/performance/discover-parent-production-context.json`, vizuálně ověřený screenshot `output/playwright/discover-parent-production.png`. Záměna Prahy 1 na reprodukovaném bodě odstraněna.
- Opravený CPU/heap scénář **2/2**, `/tmp/mapos-performance-corrected.log`. 6 vrstev: heap delta 10,88 MiB; 39 long tasks, součet 3 394 ms, p95 229 ms, max 236 ms. 12 vrstev: delta 10,39 MiB; 305 long tasks, součet 27 799 ms, p95 204 ms, max 506 ms. Tyto běhy mají CPU sampler zapnutý a používají dev React, proto nejsou produkční p95 ani striktní srovnání se starým kontaminovaným testem.
- CPU profily a souhrny `output/performance/map-{6,12}-layers.cpuprofile`, `map-{6,12}-cpu-summary.json`. Režie serializace celé mapy odstraněna, dev jsx runtime zůstává mezi významnými pojmenovanými funkcemi. `(program)` nelze bez další trace automaticky připsat aplikaci. Další krok: oddělený produkční benchmark s připravenými vrstvami bez dynamických dev importů, poté konkrétní optimalizace podle profilu.
- Žádné nové aplikační změny po tomto release; lokálně navíc jen měřicí/testovací a dokumentační změny. Všechny fáze schváleného plánu stále zachovány jako cíl, zejména municipalitní pokrytí, zbývající adaptéry/P1 data, smíšené plánování a finální herní/AI funkce.

### Produkční výkonnostní profil — samostatné sestavení

- Přidán `playwright.performance.config.ts`: offline memory API, skutečný `vite build --mode performance` a preview, stejný scénář 6/12 vrstev. Build zapisuje do kořenového `dist/performance-web`, nezávisle na `apps/web/dist`. Běžné nasazení žádný tento výstup nebalí.
- `apps/web/src/map/performanceHarness.ts` poskytuje jen registraci fixture vrstev a potřebná přepnutí. `main.tsx` jej importuje pouze při compile-time MODE=performance; MapCore vystaví map reference pouze v dev/performance. Běžný produkční web build prošel a hledání `__maposPerformance`, `__maposMap`, `performanceHarness` v jeho výsledných JS nenašlo nic. Architektonická kontrola prošla, 3572 importů / 843 souborů.
- Test má kontrolu nepřítomnosti Vite dev klienta/dependencies, oddělené production/development názvy reportů a explicitní údaj o CPU sampleru. Profiluje stávající aplikaci, nikoli izolovaný náhradní renderer.
- První běh byl zastaven (exit 130): původně vnořený benchmark output byl ohrožen běžným buildem čistícím nadřazený dist. Nepoužívat jeho dílčí hodnoty. Opravený izolovaný běh `/tmp/mapos-performance-production-isolated.log` právě běží, session 8873; nezahajovat další kopii dokud neskončí. Konfigurace má pro další běhy explicitní emptyOutDir pouze pro přesný benchmark adresář.
- Produkce zůstává `20260905-discover-parent-identity`; tento blok přidává diagnostiku, nikoli tvrzení o dalším produkčním zrychlení. Po dokončení porovnat nové důkazy, případně zapnout samostatný CPU profil produkčního buildu.

### Produkční benchmark dokončen; přesná ochrana nezměněného výřezu

- Izolovaný production-mode běh session 8873 dokončen exit 0, **2/2**, `/tmp/mapos-performance-production-isolated.log` (2,4 min). Bez CPU sampleru, minifikovaný produkční React, žádný Vite dev klient, stejné 400bodové fixture vrstvy + dva rastry. Předchozí zastavený běh je nahrazen tímto.
- 6 vrstev: delta heap 9,28 MiB; 392 long tasks, součet 30 344 ms, max 776 ms, p95 134 ms; 129 feature požadavků. 12 vrstev: delta 9,16 MiB; 458 long tasks, součet 47 517 ms, max 1 531 ms, p95 209 ms; 310 požadavků. Sources/layers/listeners bez růstu. Neměřeno worker/GPU RAM ani reální provideři. P95 je mezi úlohami nad 50 ms, nikoli interakční p95. Host není izolovaný a výsledky nelze vydávat za univerzální rychlost produkce.
- Výchozí výsledky zachovány v `output/performance/map-{6,12}-production-baseline.json`. Benchmark byl sestaven **před** následující úpravou store; neslouží jako důkaz jejího zrychlení.
- `MapStore.setView` nyní při přesně totožných hodnotách zachová objekt výřezu, nevolá syncToUrl/notify. Skutečná změna libovolné hodnoty stále projde. Cílené testy **16/16** (`/tmp/mapos-view-noop-tests.log`), pokrývají prázdný update, přesnou shodu a skutečný zoom. Nový web build session 50346 a viewport browser session z `/tmp/mapos-view-noop-browser.log` ještě běží.
- Tato dílčí oprava zatím není nasazena; poslední produkční release zůstává `20260905-discover-parent-identity`. Další krok je production CPU trace s attribution, nikoli prohlašovat limit paměti za důkaz vyřešených záseků.

- Závěr ověření tohoto bloku: web build 50346 **exit 0**, viewport browser 70059 **3/3, exit 0** (`/tmp/mapos-view-noop-browser.log`): běžný posun, vzdálený přesun + Hledat zde a postupné doplnění POI bez pohybu. `git diff --check` čistý. Žádný živý proces z bloku nezůstává. Lokální guard nemá ještě produkční release ani doloženou rychlostní úsporu.

### Produkční trace a lazy zdroje čar

- CPU profil 12 vrstev produkčního sestavení prošel (`/tmp/mapos-production-cpu-profile.log`, 1/1, 40 s). Profil nelze interpretovat tak, že `(program)` je konkrétní aplikací způsobený bottleneck. Report `output/performance/map-12-production-cpu-summary.json`.
- Přidán opt-in `MAPOS_PERF_TIMELINE=1`, streaming trace limit 64 MiB a čtecí `scripts/summarize-map-timeline.mjs`. První příliš detailní trace limit správně překročila; zúžena na devtools.timeline, další běh **1/1** (`/tmp/mapos-production-timeline-bounded.log`). Souhrn `output/performance/map-12-production-timeline-summary.json`: cca 19 tisíc postMessage událostí na main thread i workers, jednotlivé zobrazené FunctionCall max ~5,7 ms. Časy jsou inkluzivní a nesčítají se na CPU total. Výrazná variabilita mezi běhy na sdíleném hostu neprokazuje zrychlení způsobené jedinou opravou.
- Konkrétní odstraněná práce v `pinsLayer.ts`: čistě bodová vrstva už vůbec nevytváří prázdný GeoJSON line source/line layer ani do něj při každém přijatém přehledu neposílá prázdný setData. Čáry vzniknou až s LineString výsledkem, po zmizení poslední trasy se odstraní. Zachováno vykreslení pod piny a aktuální viditelnost/průhlednost při pozdním vytvoření.
- Pins/engine cílené testy **13/13**. Test fake map ověřuje počty zdrojů/commitů a cyklus points → route → points → route → detach. První build odhalil chybějící povinné name/layerId v testových datech; doplněny, finální web build **exit 0** (`/tmp/mapos-lazy-lines-build-verified.log`). Browser import skutečnou factory **1/1**, vykreslí bod i trasu a obnoví po posunu (`/tmp/mapos-lazy-lines-browser.log`).
- Celá web sada `/tmp/mapos-lazy-lines-web-suite.log` právě běží. Nová optimalizace a předchozí setView guard zatím lokální, produkce pořád `20260905-discover-parent-identity`. Standardní benchmark používá generické circle factory, proto jeho číselný výsledek **není měřením úspory lazy line source**; pro kvantifikaci rozšířit stejný scénář o skutečnou pins factory.

- Plná web sada lazy-line změn **469 pass / 7 skip / 0 fail** (`/tmp/mapos-lazy-lines-web-suite.log`). Běžný build neobsahuje performance bridge. Standardní deploy `20260905-lazy-pin-lines` právě běží, session 49869.
- Benchmark rozšířen o `MAPOS_PERF_RENDERER=pins`: používá skutečnou `createPinsLayerHandle`, včetně clusterů a ikon. Oddělené reporty `map-{6,12}-production-pins-layers.json`. První průchod **2/2**, `/tmp/mapos-production-pins-benchmark.log`, ale před následujícím zpřísněním.
- Nová důkazní podmínka settle: zdroj musí být nejen loaded, ale také vracet skutečné prvky přes querySourceFeatures. Předchozí loaded-only podmínka mohla po změně stylu přijmout prázdný nově vytvořený source. Přidána i absence line sources u čistě bodových pins fixture. Zpřísněný finální běh právě spuštěn, `/tmp/mapos-production-pins-populated.log`; jeho výsledek nepředjímat. Tyto nové harness/test změny vznikly po zabalení release; běžné produkční chování neovlivňují.

### Finální ověření lazy pinových čar

- Release `20260905-lazy-pin-lines` dokončen exit 0; backup/restore/migrations/rollback-compatibility/HTTP gates prošly. Public smoke **7/7**, `/tmp/mapos-lazy-lines-public.log`. Nové běžné produkční chování zahrnuje lazy line source a ochranu totožného setView.
- Zpřísněný production pins benchmark **2/2**, `/tmp/mapos-production-pins-populated.log` (1,7 min). Každý datový zdroj po ustálení obsahuje prvky, prázdné line sources nevznikají, zdroje/vrstvy/listenery se vracejí na stejný počet. 6 vrstev: delta heap **11,55 MiB**, celkem 12 mapových zdrojů; 12 vrstev: **13,30 MiB**, celkem 18 zdrojů. Celkový počet zahrnuje i infrastrukturu mapy.
- Long tasks pro tento konkrétní fixture běh: 6 vrstev 34 událostí / 3 246 ms total / 409 ms max / 290 ms p95; 12 vrstev 108 / 9 432 ms / 626 ms / 169 ms. Nejde o přímé before/after srovnání ani o důkaz splnění všech interakčních cílů. Nezaměňovat s jednoduššími circles reporty.
- Nový samostatný návod `docs/performance-benchmark.md` popisuje spuštění, oba renderery, izolaci sestavení, CPU/trace a limity interpretace. Všechny spuštěné procesy tohoto bloku jsou terminální.
- Zbývající celý plán zachován: připravené municipality Evropy, úplnější projekce poskytovatelů, další adaptéry/vybrané P1 vrstvy, modelová provenance počasí, smíšené profily úseků a finální průvodce/AI/questy. Tyto body nejsou uzavřeny zeleným výkonovým testem.

### WMS-T: první funkční časové ovládání (lokálně)

- SourceSublayer nyní zachovává time domain, units/default/nearestValue/multipleValues/current. Parser dědí parent dimenze a správně kombinuje WMS 1.1 Dimension + Extent / WMS 1.3 Dimension. Každý domain je omezen na 64 KiB, intervaly zůstávají v probe kompaktní.
- `wms/time.ts` poskytuje bounded selector pro explicitní ISO datum/UTC čas a pevné kroky dny/hodiny/minuty/sekundy. Max. 256 posledních termínů je při oříznutí jasně označeno. Měsíce/roky, continuous intervaly a current endpoint se neaproximují. Původní domain zůstává v probe pro budoucí pokročilé UI.
- WMS describe vytvoří single-select `wmsTime` pro jednu vybranou podvrstvu; default je explicitně v GetMap URL. Neznámý čas od klienta se nepropustí do URL, použije se validní default. Původní TIME query z pasted URL se odstraní při normalizaci, aby nevznikaly dvě konfliktní hodnoty.
- SourceLayers předává vybraný čas přes tilesForFilters → cachedTileTemplate. Změna času používá existující lokální změnu tile source, ne refetch ostatních vrstev. Bbox placeholder zůstává neescapovaný. Velké single-select facety nyní používají kompaktní Select místo stovek chips.
- Adapter testy **80/80**, runtime/source integrační **18/18**, web **470 pass / 7 skip / 0 fail**. Web a API build exit 0. Browser `e2e/addSource.spec.ts` WMS scénář **1/1**: import → aktivace → default GetMap → změna termínu → nové URL s TIME. Fixture nyní obsahuje dvě data.
- Živý průchod přes skutečný `upstreamAdapterIo`: NASA GIBS MODIS_Terra_CorrectedReflectance_TrueColor in EPSG:3857, katalog intervalů od roku 2000 do 2026-09-05, 256 termínů a správný default. Dvě PNG pro 2026-09-01/02 mají různé SHA256, velikosti 137 595 / 166 056 B. `output/performance/wms-time-gibs-smoke.json`. První ruční smoke použil špatný text content-type default a následně špatný tvar návratu fetchBytes; obě chyby byly v diagnostickém skriptu, produkční source IO správně přijímá XML.
- Opakovatelné ověření `node --import tsx scripts/wms-time-source-smoke.mjs` používá dva publikované termíny a bounded guarded transport. Nový script běží v `/tmp/mapos-wms-time-repeatable-smoke.log`; výsledek ještě ověřit.
- Primární podklad: [GeoServer Time Support](https://docs.geoserver.org/stable/en/user/services/wms/time/), [dimension configuration](https://docs.geoserver.org/stable/en/user/data/webadmin/layers/).
- **Zbývá před úplnou WMS-T podporou:** dynamické časové legendy/GetFeatureInfo, jiný než poslední bounded výběr starých dat, kalendářní intervaly, current/no-cache politika, společná doména více podvrstev, obnova capabilities u uložené vrstvy a UI kontrola dlouhého selectoru na mobilu. Nové atributy a ovládání jsou zatím lokální; aktuální VPS pořád `20260905-lazy-pin-lines`. Tento blok ještě není nový release ani uzavřená celá fáze 7.

- Opakovatelný WMS-T smoke script dokončen **exit 0**, oba PNG termíny potvrzené se stejnými SHA256 jako první úspěšný průchod. Žádný živý build/test/smoke proces z tohoto bloku nezůstává.

### Časové WMS: zachování defaultu a mobilní ověření

- Opraveno tiché nahrazení historického výchozího data nejnovějším: validní default, který leží v publikované doméně, zůstane mezi max. 256 volbami i mimo poslední okno. Datum mimo kroky se nepřidává. Label nyní přesně označuje poslední termíny a výchozí. Nové regresní testy, sada adapter SDK **81/81**, build exit 0.
- Mobilní browser 390×844 **1/1** (`/tmp/mapos-wms-mobile-selector.log`): import WMS s 33 termíny → aktivace → kompaktní Select → volba 2026-08-15 → skutečné nové tile URL. Nejde jen o kontrolu změny textu.
- Finální web build `/tmp/mapos-wms-default-web-build.log` **exit 0**. Zahájeno standardní nasazení `20260905-wms-time`, skutečný log `/tmp/mapos-wms-time-deploy.log`. Nepovažovat nasazení za dokončené před terminálním výsledkem a public smoke.
- Pokročilé časové legendy, current, kalendářní kroky a další původně uvedené části zůstávají otevřené. Mobilní kontrola dlouhého selectoru je tímto splněna pro ověřený scénář.

### Převzetí: zastavené nasazení WMS a oprava historie migrací

- Kandidát `20260905-wms-time` nebyl nasazen. Gate nad obnovenou zálohou odmítla checksum migrace 0021; aktuální symlink zůstal `20260905-lazy-pin-lines`. Dodatečné indexy from/to/pair byly chybně přidány do již publikované historie.
- Obnoven původní SQL obsah 0021; checksum `fb7d8ce28cd3ed1fa888709b652d9b4f20c95fd4721f291b8e31ae6bd31e863d` ověřen proti běžícímu produkčnímu kontejneru. Indexy jsou nová registrovaná migrace 0022. Regresní test uzamyká publikovaný checksum. Kontrolu historie neobcházíme.
- Opraveno duplicitní očekávání 0020/0021 v databázovém testu. Databázové testy 13/13 a nové migrační testy 2/2. API build prošel.
- Kompletní API průchod měl jediný neúspěch: inventář cest byl zastaralý vůči existující `/v2/world/threads/save`. Ověřeno přidání v obou kompozicích, počty nyní 194 produkce / 189 memory / 188 společných. Cílená parita prochází; opakovaný celý průchod běží.
- Celý původní plán zůstává otevřen podle tabulky fází; historické průběžné zápisy nejsou potvrzení aktuálního nasazení.

- Finální kompletní API sada po opravách: **642 pass / 1 skip / 0 fail**, `/tmp/mapos-takeover-api-final.log`. Opravené nasazení `20260905-wms-migration-recovery` běží, log `/tmp/mapos-wms-migration-recovery-deploy.log`. Před potvrzením všech gates zůstává poslední potvrzená produkce lazy-pin-lines.

- Nově opakovaná celá webová sada: **470 pass / 7 skip / 0 fail**, `/tmp/mapos-takeover-web-final.log`. Stručné další zadání je v `2026-09-05-takeover-execution.md`; nejde o prohlášení všech fází za dokončené.

### Potvrzené obnovení nasazení

- `20260905-wms-migration-recovery` dokončeno **exit 0**. Záloha/obnova, idempotentní migrace, kompatibilita předchozího image a candidate HTTP kontrola prošly; aktuální služby healthy.
- Veřejný smoke **7/7**, `/tmp/mapos-wms-migration-recovery-public.log`. Produkční URL https://mapos.promptstudio3000.com. Předchozí release `20260905-lazy-pin-lines` zůstává pro rollback.
- Nový release obsahuje WMS časové ovládání z předchozího rozpracování a opravu 0021/0022. Nové lokální ověření API 642 pass / 1 skip, web 470 pass / 7 skip; žádné selhání.
- Nejde o dokončení všech fází. POI detailové kontrakty dalších poskytovatelů, municipality, úplnější počasí, další adaptéry a smíšené úseky zůstávají podle nového stručného plánu otevřené.
