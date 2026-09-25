# MapOS — vydání Discover / trasy / hra, 6. 9. 2026

Aktuální stav vydání7.9. včetně GBIF, CDI, Foursquare Pro, rozpočtů a odděleného průzkumu je v [implementačním registru](2026-09-07-implementation-status.md). Níže je historický stav6.9.; jeho testovací omezení hry a pevná edice sucha byla následně změněna.

Tento dokument aktualizuje stav implementace, neoznačuje celý původní plán za dokončený. Úplný [výzkum evropských integrací](2026-09-european-layer-research.md) je zachovaný v repozitáři; jeho historická označení „implementováno“ nejsou důkazem současné dostupnosti každého datasetu.

## Změny tohoto vydání

| Oblast              | Implementace                                                                                                                              | Omezení / další krok                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Výběr regionu       | Dlaždice menších oblastí dostávají ID vybraného území. Backend omezuje zemi, úroveň a prostorový rozsah.                                  | Prostorové přiřazení používá reprezentativní bod menší oblasti. Není to ověřený evropský registr rodič–potomek. Doplnit oficiální crosswalk a kontrolu hraničních obcí. |
| Přiblížení oblasti  | Celý bbox, přídavný prostor pro kontext a skutečné rozměry panelů. Stejný pomocník pro obecné fit-bounds.                                 | Městské části nejsou nově importovány. U LAU zůstává obrys výběru, nevytváříme smyšlené podčásti.                                                                       |
| Opakované hranice   | Sdílení souběžných dotazů, serverová LRU cache 32 MiB / nejvýše 2048 dlaždic; klíč obsahuje revizi i vybranou oblast.                     | Cache není persistentní PMTiles archiv. Studený první dotaz stále generuje PostGIS.                                                                                     |
| Borders             | Ovládání u vyhledávání, na mobilu kompaktní ikona; Escape zavírá nabídku.                                                                 | Ověřit všechny velikosti panelů při následném vizuálním auditu.                                                                                                         |
| Geokódování         | Přednost skutečného názvu před typovým štítkem poskytovatele, srozumitelná podřazená lokalita.                                            | Dosud není kompletní normalizace všech poskytovatelů ani využití jejich bbox při každém hledání.                                                                        |
| Prázdný plánovač    | Doprava, preference, GPS a výběr bodu z mapy jsou dostupné před zadáním trasy.                                                            | Pokročilé varianty zůstávají v plném editoru.                                                                                                                           |
| Silniční geometrie  | Opraveno čtení Mapy GeoJSON Feature i LineString; chybějící geometrie už se nenahrazuje přímkou.                                          | Dvouvertexová skutečná krátká trasa je platná.                                                                                                                          |
| Přepočet tras       | Nová revize poskytovatele znovu vypočítá staré výsledky. Zastaralá odpověď nepřepíše mezitím upravený plán.                               | Doplnit samostatnou provenienci skutečného fallback enginu do každé alternativy.                                                                                        |
| Pěší/cyklo fallback | Samostatné OSRM grafy, volitelná konfigurace OSRM_CAR_URL / FOOT / BIKE.                                                                  | Veřejné služby neposkytují vlastní SLA; další krok vlastní routing nebo smluvní poskytovatel.                                                                           |
| GPS ve hře          | Výchozí GPS, srozumitelná nepřesnost/stáří/odmítnutí, obnovení polohy. Testovací ovládání chráněno schopností serveru.                    | Produkční skóre nevzniká simulací. Bez povolené GPS není hraní připravené.                                                                                              |
| Herní mapa          | Questy mají 3D značky, cílový bod/trail checkpoint, vzdálenost a zaměření. Zastaveny produkční požadavky staré paralelní practice vrstvy. | Jde o propojení současného serverového světa, nikoli dokončení všech mechanik QuestLayer v2.                                                                            |
| Výchozí gotchi      | Načtení uloženého ověřeného modelu a LOD manifestu ihned, bez zbytečné první přípravy.                                                    | Chladný server bez cache stále potřebuje zdroj modelu; neutrální fallback se neoznačuje za pravý asset.                                                                 |
| Sucho               | Nová přepínatelná Copernicus CDI v4.1 WMS vrstva, legenda a explicitní datum 2026-06-11.                                                  | Ověřený snímek, ne živá předpověď. Automatická aktualizace edice není hotová.                                                                                           |
| Hloubka moře        | Nová přepínatelná EMODnet WMS vrstva s omezením geografického rozsahu.                                                                    | Mořské dno, nikoli hloubky jezer nebo hladina.                                                                                                                          |

## Aktuální integrační tabulka

„Existující“ znamená zachovanou integraci, nikoli nový plošný test v tomto vydání. Bezplatná registrace neznamená neomezené či komerční využití služby.

| Data / poskytovatel                             | Přístup / adaptér                                                                                                    | Stav                                                          | Co konkrétně následuje                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GISCO NUTS + LAU                                | Download → existující import → PostGIS → MVT                                                                         | Existující import LAU 2024; prostorově omezené zobrazení nově | Ověřený parent crosswalk, městské části z národních dat, report pokrytí podle úrovně a edice.                                                   |
| Evropské hranice offline                        | Vygenerovat z publikované edice PMTiles nebo ZXY                                                                     | Zbývá                                                         | Generalizace podle zoomu, sdílené hrany, obsahový hash, atomický přepínač, rollback a benchmark studeného startu.                               |
| Eurostat                                        | Statistiky SDMX/JSON → existující importy                                                                            | Existující                                                    | Doplnit chybějící regionální řady a spojení geo kód + rok hranic; data pro stát nesmí obarvit obce jako obecní měření.                          |
| ČSÚ, StatFin, GUS, CBS, INE, Statistics Denmark | Národní statistické adaptéry                                                                                         | Existující, různé úrovně pokrytí                              | Audit po konkrétních datasetech a obdobích, ne obecné tvrzení „země podporována“.                                                               |
| World Bank                                      | API bez klíče                                                                                                        | Existující státní řady                                        | Ponechat státní měřítko; nevyrábět lokální statistiky interpolací.                                                                              |
| Copernicus EDO CDI                              | [WMS](https://drought.emergency.copernicus.eu/data/wms-service), bez klíče → europe-drought                          | Nově vykreslená rastrová vrstva                               | Periodický GetCapabilities, ověřit publikovaný čas a legendu, atomicky aktualizovat snapshot; později zonální statistiky z analytického rastru. |
| EMODnet                                         | [WMS dokumentace](https://emodnet.ec.europa.eu/en/emodnet-web-service-documentation), bez klíče → emodnet-bathymetry | Nově vykreslená rastrová vrstva                               | Přidat metadata edice, vlastní numerickou sondu až po ověření jednotek a nodata; jezera samostatně.                                             |
| Natura 2000 / EEA                               | Existující WMS přepínače směrnic                                                                                     | Existující                                                    | Footprint EU, národní chráněná území mimo EU; prázdný rastr není důkaz absence ochrany.                                                         |
| OpenStreetMap POI                               | Existující adaptér s minQueryZoom 8                                                                                  | Existující                                                    | Náročné kategorie po výřezu, sledovat upstream limity a úplnost; import regionálních výřezů pro stabilní provoz.                                |
| Mapy                                            | API klíč, POI/geokódování/routing                                                                                    | Existující; routing opraven                                   | Nastavení účtu [Mapy Developer](https://developer.mapy.com/), sledování kvót a skutečného fallbacku.                                            |
| Park4Night                                      | Existující uložené zdrojové záznamy a resolver                                                                       | Existující                                                    | Řídit se doloženým oprávněním, neslibovat nové veřejné API ani plošný scrape.                                                                   |
| Waymarked Trails / CyclOSM                      | Přímé raster tiles, oddělené od POI                                                                                  | Existující                                                    | Filtry odpovídající skutečným produktům; dostupnost podle footprintu.                                                                           |
| Open-Meteo / RainViewer                         | Existující modelová data a radar                                                                                     | Existující                                                    | Oddělit platnost modelu, běh modelu, radarový čas a skutečné rozlišení; bez dalšího prohlášení o vyšší přesnosti.                               |
| Sensor.Community / USGS                         | API bez klíče, existující vrstvy                                                                                     | Existující                                                    | Stáří měření, timeouty, rozsah; samostatné coverage údaje.                                                                                      |
| GBIF / iNaturalist                              | Existující API                                                                                                       | Existující                                                    | Licence po záznamu, neinterpretovat prázdné místo jako absenci druhů.                                                                           |
| OpenAQ                                          | [Účet/API](https://docs.openaq.org/)                                                                                 | Podle klíče                                                   | Zadat serverový klíč, ověřit stanice a čerstvost v aktuálním výřezu.                                                                            |
| NASA FIRMS                                      | [MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/), existující adaptér                                             | Podle klíče                                                   | Přístupové kvóty, čas detekce, neprezentovat každý bod jako potvrzený požár.                                                                    |
| OpenChargeMap                                   | [API klíč](https://openchargemap.org/site/develop/api)                                                               | Podle konfigurace                                             | Ověřit pokrytí a stáří, dostupnost stanice není živá obsazenost.                                                                                |
| Mapillary                                       | [Developer účet](https://www.mapillary.com/developer), token                                                         | Podle konfigurace                                             | Token a fotografie na vyžádání, respektovat práva médií.                                                                                        |
| GBFS                                            | Katalog operátorů → existující experimentální adaptér                                                                | Částečné                                                      | Footprint každého feedu, TTL a automatické pozastavení mimo oblast.                                                                             |
| Copernicus Data Space                           | [STAC/API účet](https://documentation.dataspace.copernicus.eu/APIs/STAC.html)                                        | Další etapa                                                   | STAC katalog není hotová mapa: výběr pásem, oblačnost, zpracování do COG/tiles.                                                                 |
| CORINE / GHSL / povodně                         | Download/rastr → COG/tiles + agregace                                                                                | Další etapa                                                   | Jeden ověřený produkt po druhém, jednotky, nodata, datum, licence, legenda.                                                                     |
| Národní ortofota a historie                     | IGN, ČÚZK, geo.admin, NLS aj.; viz úplný katalog                                                                     | Další etapa                                                   | Každá kolekce: rok snímku, georeference, skutečné pokrytí a přístupová práva.                                                                   |
| Europeana / Allmaps                             | [API](https://api.europeana.eu/en), IIIF a georeferenční anotace                                                     | Další etapa                                                   | Získat klíč, práva konkrétních obrázků; ne každý IIIF obrázek je georeferencovaný.                                                              |
| ENTSO-E                                         | Účet/token → časové řady                                                                                             | Další etapa                                                   | Tržní oblasti a jejich vlastní geometrie, ne automaticky státy.                                                                                 |
| Volby / kriminalita                             | Národní zdroje + harmonizované evropské řady                                                                         | Částečné / další etapa                                        | Audit metodiky, let a geografického detailu; neslibovat lokální crime data všude.                                                               |

## Následující implementace pro další AI

### 1. Spolehlivé evropské oblasti — nejvyšší priorita

1. Rozšířit importní staging o skutečný parent ID s revizí a metodou přiřazení. Upřednostnit oficiální LAU–NUTS crosswalk; geometrický fallback označit jako odvozený.
2. Nezaměňovat NUTS statistické regiony a administrativní kraje/okresy. Zachovat zdrojové názvy a úrovně.
3. Zkontrolovat nulové rodiče, nejednoznačné průniky, ostrovy, enklávy a obce přes hranici. Publikovat audit součtů po zemích.
4. Generovat immutable přehledové dlaždice mimo uživatelský požadavek. Volba PMTiles versus serverové ZXY musí zahrnout měření serveru i mobilních klientů; nestahovat celý archiv do RAM.
5. Zachovat revizi, ID, cache izolaci a přesné filtrování před limitem. Dodat regresní PostGIS testy parent-only výřezu, nikoli jen test mock repository.
6. Akceptace: klik na Tarragonu i český kraj ukáže pouze skutečné potomky a celé území se vejde vedle panelů; municipality ani evropské pokrytí neoznačit jako hotové bez auditované evidence.

### 2. Statistiky a katalog dostupnosti

1. Propojit katalog datasetu s rendererem a verzí geometrie; zvlášť rozlišit registraci, import a úspěšně vykreslená data.
2. Dostupnost počítat pro zvolený ukazatel, období a oblast: zelená úplné, žlutá částečné, červená nedostupné. Zachovat jednu aktivní choropleth statistiku.
3. Státní hodnoty neposouvat na obce při zoomu; nabídnout pravdivě dostupnou vyšší úroveň.
4. Implementovat footprint / minzoom / maxzoom / temporal range pro všechny rastry, včetně důvodu pozastavení a automatické obnovy po návratu.
5. CDI snímek aktualizovat importním jobem s ověřením času a legendy. Pro zonální souhrny použít numerický dataset, ne odhad barev z PNG.

### 3. Hratelný QuestLayer na existujícím serverovém světě

1. Zachovat serverový autoritativní stav, guest identitu a produkční GPS. Simulace pouze explicitně testovací, bez veřejného skóre/odměn.
2. Dokončit nástup hráče: volba guest → GPS připravena → bezpečný blízký cíl → jedna srozumitelná odměna. Nevyžadovat wallet pro základní model.
3. Převzít z auditu QuestLayer v2 konkrétní mechaniky postupně: visit, cache s odpovědí, sekvenční trail; potom encounter/minihry a kooperativní raid. Nenahrazovat již existující serverové mechaniky druhým enginem.
4. Pro každý quest mít zdroj, licenci, obtížnost, vzdálenost, bezpečný přístup, dostupnost, progress a podmínky dokončení. Otevřená licence softwaru není licence cizích geocache souřadnic.
5. Použít skutečné dostupné gotchi assety s doloženým původem, verzí a cache; fallback pravdivě označit. LOD, instancing, limit entit, disposal a jeden render loop jsou povinné.
6. Přidat malou, okamžitou animovanou zpětnou vazbu na vyzvednutí/quest; pouze lokální transform/opacity, reduced-motion. Pacman body až po bezpečné trase nad ověřeným pěším grafem, ne náhodně skrz budovy či soukromé pozemky.
7. Multiplayer ověřit dvěma klienty; finance/rewards z historického prototypu neprezentovat jako produkční infrastrukturu.

### 4. Sociální demo a další UX

- Seed pouze jako dobrovolně zapnuté izolované demo se zřetelným označením. Samostatný namespace, deterministická ID, idempotentní import a odstranění jen demo dat. Nikdy nevytvářet falešnou veřejnou aktivitu.
- Normalizovat search DTO včetně bbox, typu a kontextu; nedoplňovat falešnou „jistotu“ z pořadí výsledků.
- Dodat skutečnou provenienci routing engine, možnost rychlého opakování chyby u konkrétního segmentu a vlastní/smluvní routing grafy.
- Zachovat skrytou neužitečnou timeline. Logo, velká herní redesign fáze a nové AI režimy zůstávají mimo toto vydání.

## Ověření a vydání

Průběžné důkazy jsou v `output/ux-20260906/`. Stav nasazení a konečné výsledky jsou doplněné níže po dokončení kontrol. Lokální snímek s neutrálním avatarem není důkaz načtení produkčního modelu. Srovnávací benchmark 6/12 vrstev a hover p95 na referenčním zařízení nebyl v tomto vydání zatím proveden; žádné procentuální zrychlení neslibujeme.

### Dokončené lokální kontroly

- API: 659 úspěšných testů, 1 přeskočený, bez selhání. Web: 474 úspěšných, 7 přeskočených, bez selhání.
- Cílené regresní kontroly geometrie tras, revize provideru, cache hranic a GPS: úspěšné. GPS test pokrývá i pozdějšího odběratele již odmítnuté polohy.
- Produkční build API i webu prošel; varování o velkých JS balících přetrvává a patří do další optimalizační etapy. Kontroly architektury, CSS tokenů a úniku tajných hodnot prošly.
- Browser: prázdný planner, desktop/mobile Borders, oba nové přepínače rastrů; 33 odpovědí WMS HTTP 200 v prvním plném průchodu, 24 v následném průchodu; žádná JS chyba stránky.
- Hra: připravená GPS, produkční pohyb nelze změnit klávesnicí, žádná volba simulace, srozumitelné odmítnutí GPS. Na lokálním paměťovém serveru vytvořen návštěvní quest, ověřeno jeho zobrazení a 3D vlajka. Dokončení návštěvy, raid ve dvou klientech a celá QuestLayer kampaň nejsou tímto browser testem pokryté.
- Mobilní snímek odhalil odsunutí vyhledávání; opraveno ukotvení slotu a šířka/vrstvení nabídky Borders, opakovaný snímek zkontrolován.

### Produkční ověření a oprava živého spojení

Vydání `20260906-discover-game` prošlo obnovou 84 tabulek, idempotentními migracemi, kontrolou čtení/zápisu předchozího image a HTTP kontrolami. Veřejný dotaz stejné pražské trasy nově vrátil **128 bodů místo 2**, vzdálenost zůstala 4 203 m. Pěší a cyklistický OSRM fallback vrátily rozdílné skutečné trasy (2 178,1 m a 3 145,6 m).

Vybraná kontrolní dlaždice Tarragony obsahovala bez výběru 380 obcí / 91 014 B, s výběrem provincie 147 obcí / 34 341 B. Jde o jeden konkrétní výřez, nikoli o celkový počet obcí provincie nebo benchmark celé Evropy. Síťové časy prvního průchodu byly 1 264 ms bez výběru, 462 ms s výběrem, 284 ms při opakování; jednotlivé vzorky nejsou p95 ani důkaz univerzálního zrychlení.

Veřejný default model vrátil `ready`, token 100 a platný GLB; browser stáhl jeho LOD přes HTTP 200. Následný vizuální test odhalil starší infrastrukturní závadu: Nginx API proxy nepředávala WebSocket upgrade. Opraveno HTTP/1.1 + Upgrade/Connection a obnovení klientského spojení po přerušení. Navazující vydání **`20260906-discover-game-live`** prošlo stejnou kontrolou zálohy/obnovy a je aktivní na [veřejném MapOS](https://mapos.promptstudio3000.com).

Po obnovení produkčního WebSocket transportu se ukázal závod při inicializaci: klient poslal polohu hned po `subscribe`, zatímco server ještě asynchronně ověřoval relaci. Klient nyní čeká na potvrzení `subscribed`; teprve potom hlásí „Živě“ a posílá GPS. Reconnect toto potvrzení znovu vyžaduje. Finální opravné vydání: `20260906-discover-game-ready` (výsledky ověření níže).

Do dalšího nasazovacího gate doplnit automatizovaný WebSocket test přes skutečnou webovou proxy: handshake → subscribe ACK → první platná GPS → snapshot s `positionReady` → odpojení a opětovné připojení. Samotná HTTP health kontrola tento typ chyby nepokrývá.

### Finální stav

**Nasazeno a veřejně ověřeno: `20260906-discover-game-ready`.** Prohlížeč po nasazení potvrdil stav „Živě“, viditelné herní objekty a skutečný výchozí gotchi model; žádná chyba stránky ani konzole, žádná hláška „Neznámá událost“. Snímek `output/ux-20260906/public-game.png` byl vizuálně zkontrolován.

Finální restore drill obnovil 84 tabulek, ověřil migrace i kompatibilitu předchozí verze. Lokální HTTP soak na VPS: 60 vzorků endpointů health/layers, p50 3,211 ms, p95 4,893 ms. Toto měření není latence mapových interakcí ani úplný výkonnostní benchmark.

Skutečně zbývá zejména: ověřená hierarchie a městské části v Evropě, persistentní předgenerované dlaždice, úplná dostupnost statistických datasetů podle území/období, automatické nové edice CDI, izolovaný sociální demo seed, další quest mechaniky a benchmark 6/12 vrstev na referenčních zařízeních.
