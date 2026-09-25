# MapOS — aktuální stav 12. 9. 2026

Aktuální nasazené vydání: **20260912-overview-regions-r6** — https://mapos.promptstudio3000.com.

## Aktualizace 12. 9. — oblastní odpovědi a statistiky

Aktuální pokračování a důkazy: [AI přehledy a regionální data](2026-09-12-overview-regions-completion.md). Tento záznam má přednost před staršími seznamy chyb níže. Nově jsou propojené LAU–NUTS identity (97 649 obcí / 31 zemí), regionální populace 65+ a HDP, členěný přehled s časnými mapovými referencemi, otázky o vybrané oblasti, volba územního rozlišení a opravený přenos průběžných odpovědí. Praha již dostává AROPE svého NUTS 2, nikoli náhradní údaj za celý stát.

Modelový kontrakt umožňuje validované zdrojové sekce; živá syntéza/web čekají na doloženou alokaci Ollama. Soukromé zdroje, libovolné správní crosswalky, automatická sousední srovnání a celá obecná webová rešerše se nepovažují za dokončené. Publikované věkové údaje znamenají první konkrétní řadu 65+, nikoli celou věkovou strukturu. Přesné nasazení, měření a omezení jsou v odkazovaném předání.

Následující tabulka zachycuje starší základ 9. 9.; novější předání uvedené výše má přednost.

Baseline `c239d92`; původní pracovní změny zachovány. Závazný rozsah je [master plán T00–T14](2026-09-07-master-plan.md), včetně společné AI vrstvy a směru Global/Planet. Celý plán není dokončen. Historické záznamy níže popisují stav v době zápisu; tato tabulka má přednost.

| Úkol   | Ověřený výsledek                                                                                                                                                                                      | Skutečně zbývá                                                                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00    | Výchozí stav a společný plán evidovány                                                                                                                                                                | Průběžně aktualizovat stav vydání                                                                                                                                                                    |
| T01    | Rušení transportu, sdílení, partial/error stavy, vykreslené modelové vzorky ve statusu                                                                                                                | Audit všech fusion/ingest větví, priority a výkonové měření                                                                                                                                          |
| T02    | Navigační větev oddělena od filtru, skrytí nad z13,5                                                                                                                                                  | Kompletní PMTiles edice Evropy, coverage/crosswalk a browser drill-down                                                                                                                              |
| T03    | Long-press, clustering do z11, rozestoupení 2–12 bodů napříč vrstvami                                                                                                                                 | Mobilní a 30cyklový lifecycle audit                                                                                                                                                                  |
| T04    | Lokální hover bez HTTP, fakta před AI, explicitní těžké panely                                                                                                                                        | Media cache hoveru a kompletní zmenšení overview DTO/resolvery                                                                                                                                       |
| T05    | GBIF density, dynamická edice sucha, modelový CAMS grid                                                                                                                                               | Numerický EMODnet import/mediány, rozlišení no-data sucha, další optimalizace počasí                                                                                                                 |
| T06    | Oddělené uložené vrstvy světů, volba světa v logu                                                                                                                                                     | Audit všech podkladových náhledů a událostí                                                                                                                                                          |
| T07    | Persistentní atomické měsíční/denní rozpočty                                                                                                                                                          | Ověřená volná alokace účtů a omezené náhradní klíče; neaktivováno                                                                                                                                    |
| T08    | Plán a rozpočtová brána                                                                                                                                                                               | Google transporty, mapy/search/panorama/routes a aktivace                                                                                                                                            |
| T09    | Explicitní Pro záložka a nový API kontrakt, API vypnuté                                                                                                                                               | Ověření účtu; OS Places přístup/import/index                                                                                                                                                         |
| T10    | Veřejné Prozkoumat, oddělení GPS, šipky, sprint, HUD 5 Hz, pěší metadata                                                                                                                              | WalkableSector graf, přichycení/pohyb, serverové anchory, celý quest cyklus                                                                                                                          |
| T11    | EONET bodová vrstva a místní katalog webkamer se třemi zdroji                                                                                                                                         | GIBS/radio/ČSÚ, polygonové události a další importy zbývají                                                                                                                                          |
| T12    | Nasazen společný postupný přehled, source-only detail, bezpečný legacy brief, persistentní konverzace/snapshoty, Stop/EOF, časná mapa a rozpočty. Živá první fakta 109–481ms v kontrolních scénářích. | [Přesný stav P0–P4 a zbývající úkoly](2026-09-09-ai-overview-v2-implementation.md): plná syntéza, webová identita/rozpory, privátní zdroje/revokace, úplný scope a historie UI; Ollama alokace chybí |
| T13–14 | Audit Velocity, plán motion/Planet a první 2D svět Global v MapLibre                                                                                                                                  | Collectory lodí/letadel, orbitální výpočet a skutečný glóbus nejsou aktivní                                                                                                                          |

## AI Overview V2 — 9.9.

Priorita zůstává T12 před dalšími zdroji/hrou/Planet. [Předání vydání a měření](2026-09-09-ai-overview-v2-implementation.md) má přednost před historickými AI zápisy. 1301 různých testů prošlo /9 přeskočených, 27 browser scénářů, produkční Postgres CAS/restore a owner izolace ověřené. Nasazení prošlo obnovou zálohy a kompatibilitou. Celý schválený AI plán ještě není dokončený; živé volání modelu nebylo bez doložené alokace aktivované.

## Doplnění 8.9.: Foursquare a webkamery

[Podrobný postup](2026-09-08-foursquare-webcams.md) je součástí master plánu: Foursquare Pro implementované, aktivace čeká na ověřený účet/zůstatek; T11b má místní otevřený katalog; Windy zůstává volitelný a jeho samostatný klíč chybí. Žádné nové API nebylo aktivováno ani zaplaceno.

## Ověřená sada CAMS a pěší podklady

- CAMS: stabilní buňky, nejvýše 48 vstupních míst, společná hodinová cache tří veličin. Zdrojová jednotka a modelový čas se ověřují; chybějící hodnota není nula. Popisek je samostatný bod uprostřed buňky, aby se při dělení polygonu na dlaždice neopakoval. Hodnota je vzorek modelu, nikoli plošný medián. Vrstva je výchozím stavem vypnutá.
- Živá kontrola jedné buňky u Tarragony: 8.9.2026 06:00 UTC, PM2.5 10,6 µg/m³, PM10 24,6 µg/m³, EAQI 31; opakování mělo nula nových vstupních míst. Jde o kontrolní vzorek, nikoli audit celého evropského pokrytí nebo komerčních oprávnění Open-Meteo.
- Herní road služba: rušení až do Overpass, cache 24 h/16 MiB/128 položek, odmítnutí částečné upstream odpovědi, zachování OSM node IDs, pěších tagů a úrovní mostů/tunelů. Bariéry dělí cesty; neznámé podmíněné přístupy se nepovolují. Živý malý výřez Tarragony vrátil 58 úseků s metadaty a odpovídajícími uzly. To není hotový graf ani záruka, že již všechny herní entity leží na veřejných anchorech.
- API: 681 testů prošlo, 2 přeskočené. Web: 479 prošlo, 7 přeskočených. SDK 105, adapter SDK 83 a map runtime 4 prošly v téže sadě. Celkem 1352 prošlo, 9 přeskočeno.
- Pět offline browser scénářů prošlo za 20,7 s: plánování, hover bez HTTP, skutečný pohyb avatara/blur, rozestoupení bodů a CAMS včetně přepnutí veličiny bez nového dotazu. Screenshot CAMS vizuálně ověřen. Typecheck API a produkční web build prošly; build stále upozorňuje na velké chunky.
- Důkazy: `output/verification-20260908/`, screenshot `output/playwright/cams-model-20260908.png`. Výkon p95 hoveru, 6/12 vrstev, 30 cyklů a přenos před/po dosud nezměřen; testovací časy nejsou takový benchmark.

Nasazení `20260908-pin-spread-movement` bylo dokončeno včetně zálohy/obnovy a veřejného smoke. Aktivní vydání **`20260908-cams-walkable-roads`** na https://mapos.promptstudio3000.com prošlo zálohou/obnovou, kompatibilitou a veřejným smoke. Záloha je `/opt/ps3000/apps/mapos-v3/backups/20260908-cams-walkable-roads`; předchozí aplikace zůstává pro návrat. Veřejný browser načetl 6 platných buněk CAMS Europe pro 8.9.2026 07:00 UTC, HTTP 200, bez JS chyb a bez Google/FSQ požadavků. Screenshot `output/playwright/cams-public-20260908.png`.

## Historie předchozích kroků

## Aktuální pokračování: 20260907-budget-worlds-explore

Následující sada je ověřena lokálně a připravena k nasazení; předchozí produkční release je `20260907-loading-preview`. Starší zápisy níže jsou historie, nikoli současná blokace SSH.

| Úkol | Nový výsledek                                                                                                                                                  | Co skutečně zbývá                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01  | Sdružené zdroje přenášejí partial status včetně prázdné částečné odpovědi. Budget admission sdílí existující transport; každý retry rezervuje znovu.           | Audit všech fusion/ingest větví, priority a měření přenosu.                                                                                                                                                   |
| T05  | GBIF density jako samostatný výchozím stavem vypnutý raster. CDI čas se načítá z capabilities, bez pevného data.                                               | CAMS, numerické mediány EMODnet, rozlišení transparentní no-data/bez sucha, persistentní katalog edic a coverage.                                                                                             |
| T06  | Každý svět uchovává vlastní vrstvy a filtry; osobní user-layers globální. Volba světa pouze v logu.                                                            | Browser audit všech návratů a náhledů podkladů.                                                                                                                                                               |
| T07  | Dopředná migrace0023, atomické persistentní měsíční/denní rezervace, operation allowlist, nevracení odeslané spotřeby, žádný memory fallback.                  | Ověření skutečné volné kvóty účtu, nové omezené klíče a providerové limity. Žádný grant nebyl vytvořen.                                                                                                       |
| T09  | Nové verzované FSQ Places API, Pro pole, explicitní záložka, výběr kandidáta bez dalšího detail volání, odstraněné automatické legacy API obohacování.         | API vypnuté do aktivace; lokální OS Places index/import a portal token chybí. Historické uložené detaily zůstávají čitelné.                                                                                   |
| T10  | Veřejné explore session oddělené od GPS/test, šipky neovládají mapu, blur/modal/focus ruší pohyb, rychlost4m/s, načtený avatar6m, jedno místo s GPS watcherem. | Sprint, HUD5Hz, nezměněné heartbeat pozice, pěší graf/anchory, veřejně dosažitelné entity, GPU/perf cykly. Místní starý road practice generátor stále chráněn test flag; není prohlášen za veřejnou pěší síť. |

Ověření: plná sada1342prošlo/9přeskočeno; PostgreSQL test24souběžných zájemců o poslední jednotku propustil jednoho, nový connection zachoval spotřebu a denní15limit. Tři offline browser scénáře prošly i s vypnutými testovacími oprávněními, včetně skutečné vykreslené pozice avatara a blur. Skill herní klient též spustil reálné klávesy; výstupy `output/web-game/explore-fixed-20260907`. Živá GBIF dlaždice byla200/67585bajtů; jde o jediný ověřený tile, nikoli celosvětový coverage audit. CDI capabilities dne7.9.2026 uvádí poslední explicitní edici11.6.2026; datum nevymýšlíme.

Aktivace: [postup a rozpočty](2026-09-07-provider-budget-activation.md). Google přenosy ani FSQ placené volání se při testech neaktivovaly. T08, OSimport, AI T12 a Global/Planet T13–14 zůstávají podle společného master plánu. Celý plán není dokončen.

## Rozšíření schváleného směru

- T12 AI: [jednotná evidence, odpovědi, nástroje, rozpočty a UI](2026-09-07-ai-global-extension.md); plánováno, UI až po základních etapách.
- T13 moving objects a T14 Global/Planet: [audit Velocity a konkrétní implementační kroky](../research/2026-09-07-velocity-audit.md); plánováno, bez spuštění cizích collectorů.
- T01: 16 testů source outcome/shared transport a 18 testů engine/boundary/source prošlo. API typecheck prošel. Nejde zatím o kompletní integrační ani produkční ověření.
- Rozpracované UI: oddělení navigační větve hranic od filtru, clustering do z11, lokální hover, viditelné sekce detailu, pause počasí při zavření/skrytí.
- Nasazení: čeká na dohledání existujícího SSH přístupu; dotaz uživateli otevřen. Žádné nové nasazení zatím neproběhlo.

## Ověřená dílčí sada změn

Společný [master plán](2026-09-07-master-plan.md) nyní zachycuje T00–T14 včetně původních parametrů a nového AI/Velocity směru. AI, pohybové collectory ani Planet renderer nebyly aktivovány.

- T01: data-source adaptéry propagují signal do transportu, odlišují oversized a source failure od prázdných výsledků. Sdílený transport a engine mají cílené testy. Nejde ještě o audit všech OSM/fusion/background ingest větví.
- T02: navigační větev je oddělená od explicitního prostorového výběru, detailní hranice se skrývají nad z13,5. Zbývá skutečný browser drill-down a revize/crosswalk/PMTiles pokrytí; nebyl proveden nový evropský import.
- T03: clustering nastaven radius36/maxZoom11, doplněné rušení press gesta při scrollu. Spiderfy a souběhy napříč vrstvami ještě chybí.
- T04: registr zahrnuje dot vrstvy, lokální preview bez resolveru/obrázkových fetchů, mobilní první tap, relevantní invalidace místo každé aktualizace store. V detailu fakta před AI a viditelné hlavní sekce; těžké panely lazy/explicitní. Cache fotografií v hoveru a kompletní redukce overview payloadu ještě chybí.
- T05: přehrávání počasí čeká na datový čas a zastaví při skrytí/zavření. Numerická bathymetrie nyní vrací explicitní 503 `bathymetry-numeric-data-pending` bez sond; katalog používá pravdivý WMS mapový přehled. Skutečné mediány, numerický import, CAMS a dynamický katalog sucha zbývají. Starý nepoužitý prototyp grid service není publikovaný produkt a nesmí být znovu aktivován bez numerické edice.

### Doklady kontrol

- 32 cílených testů: source outcomes, shared request/upstream, LayerEngine, boundaryLevel a nepublikovaná bathymetrie; všechny prošly.
- Celoprojektový typecheck prošel. Sestavení všech workspace prošlo; Vite upozorňuje na velké chunky, nejde o měření runtime RAM.
- Architecture boundaries a CSS token kontrola prošly.
- Offline browser: planning/API a lokální preview nad dot vrstvou. První test opraven na již existující čtyřbodovou testovací trasu místo zastaralého očekávání přímky. Mapové podklady jsou syntetické fixtures, nikoli ověření živých evropských dat.
- Screenshot náhledu: `output/playwright/pin-preview-20260907.png`, vizuálně zkontrolován.
- Nebyl proveden benchmark p95/6–12 vrstev/30 cyklů, měření přenosu před/po ani produkční smoke. Žádná taková čísla se nesmějí odvodit z unit testů.

### Konkrétní pokračování

1. Dokončit T01 zbylé poskytovatele a partial výsledky sdružených zdrojů; otestovat abort/pozdní update přes celý reálný tok.
2. Browser ověřit hranice, mobilní detaily a galerie; implementovat spiderfy a media cache preview.
3. T05 lokální numerická edice, aktuální sucho, GBIF density/CAMS; T06 oddělené per-world presety.
4. T07 persistentní budget před jakýmkoli novým Google/FSQ voláním; odstranit staré automatické legacy FSQ enrichment volání při migraci na nový kontrakt.
5. Dokončit T08–T11 a živé importy podle master plánu. Hra v této dílčí sadě nebyla upravena.
6. Připojit rozšíření T12–T14 podle jejich detailních dokumentů, bez druhých SDK a AI frameworků.
7. Dohledat SSH přístup; poté záloha/restore/migrace/release/public smoke. Zatím žádné nové nasazení ani veřejná revize tohoto pracovního stromu.

Závěrečná offline kontrola: 2/2 browser scénáře prošly (9,0 s), včetně opuštění hoveru, opětovného otevření a Escape. Automatický focus popupu vypnut, aby náhled nepřebíral klávesnici. Uchované výstupy kontrol: `output/verification-20260907/`. Jedná se o offline fixtures, nikoli výkonový benchmark produkce.

## Navázání s VPS přístupem

SSH přístup byl ověřen přes uživatelský účet a ssh-agent. Původní blokace nasazení je vyřešena. Žádná hesla ani cesta k soukromému klíči se neevidují v projektu.

Kompletní projektová testovací sada: layer-sdk105/105, adapter-sdk83/83, map-runtime4/4, API664 prošlo/1 přeskočený. Web po opravě importu CSS475 prošlo/7 přeskočených. CSS pro stav vrstvy je nyní importované ze vstupu aplikace, nikoli z komponenty, kterou přímo načítají čisté Node testy. Testy nebyly oslabeny ani vypnuty.

Zahájeno vydání `20260907-loading-preview` přes stávající release skript. Stav nasazení bude potvrzen až po restore drill, aktivaci a veřejné kontrole.

## Nasazeno — 7. 9. 2026

- Aktivní release **20260907-loading-preview** na https://mapos.promptstudio3000.com, předchozí `20260906-boundary-navigation-final` zachována pro návrat.
- Záloha `/opt/ps3000/apps/mapos-v3/backups/20260907-loading-preview`; ověřená obnova84tabulek, dopředné migrace a read/write předchozího image prošly.
- Veřejný web/health/CSP/CORS/ochrana interního endpointu prošly. Prohlížeč zobrazil mapu Tarragony, bez konzolových chyb. Průvodce pravdivě uvádí částečný výpadek webového podzdroje; neoznačujeme všechny poskytovatele za zdravé.
- Číselná bathymetrie vrací očekávané503 se zprávou o připravovaných datech; WMS přehled je samostatný fallback.
- Serverový loopback vzorek60požadavků health/layers: p50 **5,138ms**, p95 **12,079ms**. Není to benchmark mapových interakcí ani externích dat.
- Screenshot `output/playwright/vps-20260907.png`; souhrn `output/verification-20260907/deployment.txt`.
- Rozsah vydání jsou výše uvedené dílčí opravy. T07–T14 ani ostatní výslovně zbývající části tím nejsou dokončené. Nasazený přehled při z8 zůstává vizuálně hustý; plný audit clusteringu/spiderfy a výkon6/12vrstev pokračuje podle backlogu.

## Nasazeno: rozpočty, světy, průzkum

Release `20260907-budget-worlds-explore` aktivní; záloha a obnova, kompatibilita předchozího image a veřejný smoke prošly. FSQ zůstává vypnuté bez budget grantu. Logy `/tmp/mapos-new-deploy.log` a `/tmp/mapos-new-public-smoke.log` budou kopírovány do výstupů ověření.

## Navazující UI oprava 8.9. — lokálně ověřována

Rozestoupení2–12souběžných bodů funguje napříč vrstvami a zachovává původní souřadnice. Rozlišitelné body nejprve přiblíží; více než12nerozlišitelných bodů otevře seznam se správným vlastníkem vrstvy. Escape/pohyb/styl/filtr odstraní dočasné značky a čáry. Čistý layout test ověřuje rozestupy a limit, offline browser skutečný klik dvou zdrojů; screenshot `output/playwright/pin-spread-20260907.png`.

Hra: sprintShift8m/s, běžný pohyb4m/s; renderer dostává polohu přímo, React HUD při pohybu5Hz. Zrušení pohybu také ruší sprint. Testy rychlosti a resetu prošly. Nejde o hotové přichycení na pěší síť.

## T11 — EONET přírodní události, 8.9.2026

Implementováno v současném DataSource registru a mapovém rendereru; výchozí vypnuto. Filtry období1–365dní a13kategorií,200událostí na dotaz, cache15minut, bounded2MiBresponse, abort a žádné automatické stránkování. Poslední bod a datum jsou vždy ze stejné geometrie; historická poloha ve výřezu nezpůsobí vykreslení neaktuálního bodu. Nejnovější polygon nepřevádíme na smyšlený bod: přehled označí partial. Detail uvádí typ, datum, stav podle zdroje a původní odkaz. Není to služba živých bezpečnostních výstrah ani úplný katalog.

Ověření:15cílených testů adaptéru/registru/sourceoutcome prošlo; web479prošlo/7přeskočeno, API a web typecheck prošly. Skutečný dotaz nad evropským výřezem vrátil20bodů a14nepodporovanýchgeometrií, správně partial. BrowserCLI ověřil vypnutou počáteční vrstvu, zapnutí a filtr Požáry; screenshot `output/playwright/eonet-filters-20260908.png` vizuálně zkontrolován. Levý průvodce v tomto screenshotu používá offline fixtures, nikoli živou lokalizaci.

Oficiální kontrakt: [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3), ověřeno8.9.2026. Bod je publikovaná poloha, nikoli hranice postiženého území. Další krok: polygonový renderer nebo samostatné plochy při zachování časové identity; geografický a mobilní audit. Nasazeno **20260908-eonet-events** na https://mapos.promptstudio3000.com. Záloha/obnova, kompatibilita a veřejný smoke prošly; předchozí release zachován. Veřejný browser: nula EONET dotazů před zapnutím, po zapnutí HTTP200/20bodů/15nepodporovanýchgeometrií se stavem partial, bez JS chyb. Během ustálení mapy byly pozorovány3aplikační dotazy; není to měření externí spotřeby ani optimalizační benchmark. Screenshot `output/playwright/eonet-public-20260908.png` vizuálně ověřen.

## Webkamery bez Windy — nasazeno8.9.

Místní ODbL katalog9451záznamů CartoCams/OSM, výchozí vypnutá vrstva, regionální filtr před limitem300, žádné obrázky ani provider dotazy při pohybu. Tři cílené testy prošly, API/web typecheck prošly. [Přesné zdroje, práva a aktualizace](../research/2026-09-08-open-webcams.md). Nejde dosud o univerzální vložený přehrávač ani potvrzení funkčnosti všech odkazů. Nasazeno `20260908-open-webcams` na https://mapos.promptstudio3000.com. Záloha/obnova a veřejný smoke prošly. Produkční browser vrátil11kamer v Praze, HTTP200/complete,0JS chyb,0obrazových požadavků na provozovatele,0kamerových dotazů před zapnutím. Screenshot `output/playwright/webcams-public-20260908.png` vizuálně ověřen.14cílených testů zdrojů a479webových testů prošlo;7webových přeskočeno.

## Global a další katalogy kamer — nasazeno 8.9.2026

- 2D svět Global v nabídce loga: vlastní sada vrstev a akcent, první vstup zapne EONET a USGS; žádné automatické celoevropské OSM POI. Přesun na světový výřez a obnova dat; návrat obnoví kameru a vrstvy předchozího světa. Lokální prostorový filtr se mezi světy nepřenáší, při návratu se obnoví. Kamera a oblast mají tuto paměť po dobu běhu aplikace; nejde o nové trvalé ukládání kamer.
- Administrativní překryv a jeho tlačítko v Global skryté. Současný MapLibre renderer zachován. **Není to dosud 3D Planet, AIS/ADS-B ani satelitní runtime.** T13/T14 pokračují podle plánu.
- Katalog kamer:10217záznamů (OSM9451 + Fintraffic764 + ODH2), filtr jednotlivých zdrojů, oddělené atribuce a datum metadat. Bez automatických obrazových požadavků. Přesný import a omezení v [rešerši](../research/2026-09-08-open-webcams.md).
- Web481testů prošlo,7přeskočeno.6cílených testů importů/katalogu prošlo; API build a web typecheck, architektonické hranice a CSS token kontrola prošly. Lokální browser ověřil přepnutí Global a návrat na předchozí souřadnice/zoom/vrstvy. Offline EONET fixture nemá tuto cestu a vrací404; živá data se ověřují samostatně při veřejném smoke.
- Nasazení a veřejné kontroly budou potvrzeny zvlášť. Nejde o benchmark p95/6–12vrstev ani potvrzení funkčnosti každého kamerového odkazu.

Vizuální kontrola Global odhalila prázdný timeline host pro USGS: samotná deklarace časových dat ještě nemá ovladač. Footer nyní přijímá jen skutečně vykreslené časové ovladače (počasí, události, statistiky); období ostatních zdrojů zůstává v jejich filtrech. Regresní test chrání proti prázdné liště. Mobilní první Global kamera používázoom1 místo desktopovéhozoom2.

### Veřejné ověření konečného vydání

`20260908-global-camera-sources-ui` je aktivní na https://mapos.promptstudio3000.com. Záloha `/opt/ps3000/apps/mapos-v3/backups/20260908-global-camera-sources-ui`, zkušební obnova, dopředné migrace, kompatibilita předchozího image a veřejné kontroly webu/health/CSP/CORS prošly. Předchozí `20260908-global-camera-sources` i jeho předchůdce jsou zachované pro návrat.

- Desktop: přepnutí Global → světový výřez → návrat obnovilo přesné14.43/50.1/z10 a původní osm-poi stack. V aktivním Global0nových OSM POI dotazů,0kamerových automatických obrazových dotazů,0Google/FSQ dotazů,0JS chyb. První verze testu měřila interval před dokončením kliku a zahrnula2počáteční OSM požadavky Default; opravená hranice měření začíná po aktivaci Global. Původní výstup je zachovaný, nejde o vypnutí kontroly.
- NASA v konečném desktopovém globálním výřezuHTTP200/100bodů a následně90bodů, partialkvůli limitu200událostí a9nepodporovanýmgeometriím. Celkem3aplikační EONET odpovědi v běhu. Počáteční dotaz ještě nad předchozím pražským výřezem měl nedostupnou upstream odpověď, stavunavailablese nezaměnil za úspěšnou nulu. Zůstává optimalizovat přechod tak, aby se nové zdroje vůbec nespouštěly nad odcházejícím výřezem; nejde o měření externí spotřeby či benchmark.
- Místní katalog: Helsinky/Fintraffic68bodů, Jihotyrolsko/ODH2body, obaHTTP200/complete a správný provider filtr. Žádné automatické obrazové pole v overview.
- Mobil390×844: Global vstupz1, EONETHTTP200, bezJSchyb a vodorovného přetečení. Na obou velikostech žádná prázdná časová lišta. Screenshots `output/playwright/global-public-20260908.png` a `global-mobile-public-20260908.png` vizuálně ověřeny.
- Důkazy v `output/verification-20260908/global-camera-sources/`; browser scénář v `output/verification-20260908/public-global-smoke.mjs`. Web481testů prošlo/7přeskočeno,6cílených testů kamer prošlo. Benchmark paměti/6–12vrstev/p95 se v této sadě neprováděl.

Další pořadí: zamezit počátečnímu dotazu nového světa nad starou kamerou; lazy snímek ověřeného Fintraffic v současném detailu; ruční importy převést na kontrolovanou aktualizaci; T13motion pilot a T14Planet podle rozšířeného plánu. AI zůstává společnou T12vrstvou a nebude zavedena podruhé pro Global.

Priorita8.9. podle uživatele: soustředit další vydání na [AI odpovědi a mapovou reprezentaci](2026-09-08-ai-map-priority.md). T12 není prázdná implementace — základ již existuje; nedokončené je sjednocení a optimalizace. Tento audit nespouštěl živé modelové generace ani neměnil nasazenou aplikaci.

## AI mapová odpověď — kandidát 20260908-ai-answer-map

Podrobnosti a omezení: [AI priorita](2026-09-08-ai-map-priority.md). API a web typecheck prošly. SDK105, web484/7skip v základní sadě; AI/API103 a následná změnová regrese60 testů prošly (sady se překrývají, nesčítat). Gateway13 testů včetně sdíleného rušení prošlo. Závěrečný browser a VPS vydání se evidují po dokončení. Předchozí produkční verze zůstává zatím aktivní.

Závěrečný browser AI: 11/11 scénářů prošlo nad SSE fixtures (3,5 min na zatíženém vývojovém stroji, nikoli benchmark modelu). Přesný tříbodový výsledek, lokální hover, nahrazení jediného zdroje, fit a schování ověřeny. Architecture/CSS/secrets kontroly prošly. Vydání nyní nasazováno.

První staged build 20260908-ai-answer-map odmítnut před cutoverem: nový test provenance postrádal povinné confidence. Opraven pouze testovací vzorek, provoz zůstal na původní verzi. Následující kandidát: 20260908-ai-answer-map-r2; typecheck se opakuje nad finálními testy.

Vydání 20260908-ai-answer-map-r2 aktivní: produkční build prošel, záloha obnovena a ověřena včetně staré image kompatibility, aktivace atomická, API/web zdravé. Nová SQL migrace nebyla potřeba. Veřejný smoke/browser výsledek se doplňuje níže.

Veřejné ověření r2: public_web/health/security_headers/CSP/CORS/protected operations prošly. Headless Chromium načetl skutečnou CARTO vektorovou dlaždici nad Tarragonou a otevřel Map status: 0 page errors, 0 zachycených chat/Google/Foursquare požadavků během této kontroly. To není měření reálného modelu ani dlouhodobý výkonový benchmark. Důkazy: output/verification-20260908-ai/.

Doplňující veřejná kontrola: čekání na globální text „Mapa je připravená“ přesáhlo 60 s. Nezaměňovat úspěšný HTTP/tile test za ověření dokončení všech vrstev. Následná kontrola zaznamenává skutečný stav jednotlivých zdrojů a snímek po čekání.

Následná veřejná kontrola dokončena: Map status aktuální, OSM1263 míst/16,62s hlášených vrstvou; 0 JS chyb, 0 zachycených chat/Google/Foursquare volání. Jeden zrušený mapos HTTP požadavek (ERR_ABORTED); není počítán jako chyba aplikace. Nejde o benchmark všech vrstev: pomalý první průchod >60s a další průchod dokumentují variabilitu načítání, další T01 optimalizace stále zbývá.

## Aktualizace 12. 9. 2026 — Ollama Cloud a záložky detailu

Nasazeno `20260912-cloud-detail-r10`. Ollama GLM 5.3 Flash / GLM 5.3 a společné web search/fetch jsou aktivní a živě ověřené. Vlastník výslovně převzal správu tarifu; starší podmínka doložení bezplatné Ollama alokace je nahrazená provider-managed konfigurací. Detail nyní používá Info / Fotky / Recenze / Panorama; odstraněna automatická webová rešerše běžného Discover a neověřené zaměňování stejně pojmenovaných čtvrtí. 191 regresních testů prošlo, obnova 90 tabulek ověřena. Podrobný stav, měření a konkrétní nedokončené části: [Cloud a detail](2026-09-12-cloud-detail-tabs.md).

Google panorama: živý test klíče vrátil 403 — Maps Embed API není zapnuté v projektu. Mapillary vyhledávání potřebuje token. Tyto funkce nejsou označené jako aktivované; zatím jsou dostupné přímé odkazy v záložce Panorama. Volná syntéza neověřených webových kandidátů, celý kontext filtrů/času obecného chatu a širší původní backlog zůstávají samostatné úkoly.
