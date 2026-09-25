# MapOS — společný implementační plán

## Aktualizace 12. 9. — oblastní odpovědi a statistiky

Aktuální pokračování a důkazy: [AI přehledy a regionální data](2026-09-12-overview-regions-completion.md). Tento záznam má přednost před staršími seznamy chyb níže. Nově jsou propojené LAU–NUTS identity (97 649 obcí / 31 zemí), regionální populace 65+ a HDP, členěný přehled s časnými mapovými referencemi, otázky o vybrané oblasti, volba územního rozlišení a opravený přenos průběžných odpovědí. Praha již dostává AROPE svého NUTS 2, nikoli náhradní údaj za celý stát.

Modelový kontrakt umožňuje validované zdrojové sekce; živá syntéza/web čekají na doloženou alokaci Ollama. Soukromé zdroje, libovolné správní crosswalky, automatická sousední srovnání a celá obecná webová rešerše se nepovažují za dokončené. Publikované věkové údaje znamenají první konkrétní řadu 65+, nikoli celou věkovou strukturu. Přesné nasazení, měření a omezení jsou v odkazovaném předání.

## Oprava cyklistických voleb a statistické konverzace (12. 9. 2026)

Cyklistické volby, statistická konverzace a mobilní opravy jsou implementované, ověřené a nasazené jako `20260912-ai-statistics-cycling-r5`. Důkazy a zbývající omezení: [AI/statistiky/cyklistika r5](../releases/20260912-ai-statistics-cycling-r5.md).

- Plná CyclOSM je znovu jasně dostupný podklad; infrastruktura Lite a značené sítě Waymarked mají odlišné explicitní akce.
- AI statistický dotaz vybírá zemi z otázky a zachovává konverzaci ve vyhledávání. Navazující ukazatel/země sdílí historii s AI panelem.
- Publikované české NUTS 2 hodnoty AROPE a nezaměstnanosti jsou skutečně dostupné a propojené s geometrií. Chybějící obecní řady ani kompletní evropské pokrytí se nepředstírají.
- Opravené rušivé automatické otevření statistického exploreru, skoky kamery při obnově a dvojí započtení prostoru panelů.
- Další analytické záměry, časové trendy a pokročilejší syntéza zůstávají produktovým backlogem. Oprava konkrétní otázky není důkaz obecné schopnosti odpovědět na libovolnou statistickou otázku.

Aktualizace 9. 9. 2026. Tento vstupní dokument spojuje schválené T00–T11 s AI odpověďmi a inspirací Velocity. Není zprávou o dokončeném vydání. Skutečný stav kódu, ověření, živých dat a nasazení je v [implementačním přehledu](2026-09-07-implementation-status.md).

## Architektura a pořadí

Zachovat MapLibre, aktivní Three/GameHost, PostGIS, současné registry, LayerManifestV2, AI gateway/tool registry a detailové panely. Nevytvářet druhý orchestrátor dotazů, LLM klienta, POI index nebo mapový renderer pro běžné režimy. Discover je výchozí. Reload začíná prázdným plánováním; uložené výlety zůstávají.

Nejbližší závazná priorita: **praktické produktové vydání** podle [nového plánu](2026-09-09-product-experience.md): překryvy a pravdivý stav → načítání/Discover/tematická data → hledání/detail/plánování → užitečnější AI. Nahrazuje výhradní prioritu celého T12 před všemi UX opravami. AI zůstává součástí stejného produktu; hra/Planet jen regrese. [Technický dluh](2026-09-09-technical-debt.md) má samostatný budoucí backlog. Dosavadní funkce se neimplementují znovu.

## UX audit bez změny rozvržení

[Navazující UX plán](2026-09-09-ux-audit-followup.md) doplňuje produktové vydání o kontext, návrat k výsledkům, přidávání zastávek bez změny režimu a mobilní ověření. Nejde o nový redesign. První balíček je nasazen jako 20260909-product-ux-r2; [důkazy a konkrétní zbývající omezení](../releases/20260909-product-ux-r2.md). Další body auditu nejsou automaticky dokončené.

## Závazný backlog základního vydání

### T00 — výchozí stav a předání

Zachovat rozpracované změny. Zaznamenat commit, pracovní stav a nasazenou revizi odděleně. Každá položka má stav funguje/částečné/chybné/chybí/neověřené, změněné rozhraní, závislosti, test a konkrétní zbývající krok. Nové dopředné migrace, žádný reset. Rešerše je katalog návrhů, nikoli seznam funkčních integrací. Zachovat ADR 0012 o poradní evidenci práv a konkrétní podmínky poskytovatelů.

### T01 — společný životní cyklus dat

Identita dotazu: vrstva + normalizovaný bbox + LOD + filtry + čas + areaId + boundaryRevision. Signál zrušení až do transportu. Shodný požadavek sdílet; poslední odpojený zájemce zruší transport. Abort nikdy není úspěšná nula. Pouze aktuální generace smí aplikovat výsledek. Vypnutí, změna světa či stylu nesmí pozdní odpovědí obnovit zdroj. Vyprázdnění musí odstranit features.

Fronta: detail → viditelná data → preload, rastry odděleně. Lehká data po 300 ms klidu, těžká přes Hledat zde. Filtr/oblast ihned, pokud manifest dovolí rozsah. Jednotné stavy čeká/načítá/aktuální/bez výsledků/částečné/přibližte/mimo pokrytí/obnovit/limit/chyba; stejné v draweru i logu. Spinner přes ikonu, ne pouze barevná tečka, retry konkrétní vrstvy. Diagnostika zdroj/čas/objekty/cache/chyba; bajty jen změřené na transportu.

### T02 — hranice, prostorový filtr a statistiky

Výběr oblasti a navigační větev jsou oddělené. Klik vybere stabilní ID a fit celého bbox s panely; dotazuje děti jen tohoto rodiče. Oddálení obnoví sousedy, explicitní filtr zůstává. Prahy 4/7/10 s hysterézí ±0,25; nad 13,5 běžné hranice skrýt. Nejvýše dvě sady během přechodu. Hover bez HTTP, pin má přednost. Borders vlevo dole s odsazením panelu.

Import GISCO NUTS/LAU a ověřených místních zdrojů do neměnných PMTiles; žádný externí import při pohybu. Manifest země/úroveň/edice/licence/generalizace/pokrytí. ADM2 neznamená obce. RÚIAN použít skutečné polygonové správní části. Tarragona má neúplné názvy; nevymýšlet je.

Statistiky join kódem/typem/revizí nebo ověřeným crosswalkem. Jedna aktivní statistika; přepínač a přístupný stav úplná/částečná/nedostupná. Jednotná srovnatelná škála, no-data nebarvit krajským číslem jako obec. Výběr zůstává viditelný nad výplní. Body ST_Covers, trasy průnikem, před limitem i stránkováním. Neznámá revize vrací obnovitelnou chybu, ne nefiltrovaná data.

### T03 — gesta, piny a ovládání

Pravý klik nebo levý/touch press 650 ms; pohyb >8 px, druhý prst, scroll, blur/cancel zruší. Stojící kurzor nikdy nevytvoří pin. Potlačit následný klik. Lokální bod ihned, GPS detail později; menu zpráva/trasa/uložení. Zpráva krátký dialog.

Cluster radius 36 px, maxZoom 11, průměr 32–48 px; od z12 jednotlivé piny. Klik přibližuje rozložení. Do 12 totožných pozic dočasné spiderfy přes vrstvy, neměnit GPS; větší souběh seznam. Piny 28–32 px bez nožičky. Search vlevo; bez centrálního pinu a What is here. Logo obsahuje svět/status, animuje jen skutečné načítání. Jediné Hledat zde. Přechody 120–180 ms a reduced-motion.

### T04 — přehled, hover a detail

Malé PinPreview DTO: identita, poloha, název/kategorie/styl, malá media reference, rating se stupnicí/počtem/poskytovatelem, několik odkazů a atribuce. Bez raw provider polí. Jeden registr interaktivních vrstev včetně dotů, jeden RAF hit-test. Hover 150 ms bez HTTP, fotka jen z již načtené cache; jinak lokální ikona. Přesun do flyoutu jej drží, Escape/pohyb/změna filtru/odstranění zavře. Mobil první tap náhled, explicitní Detail.

Detail: název/akce → média/panorama → fakta/wiki → AI souhrn → praktické odkazy → počasí/komentáře. Současný registry, žádná duplicitní galerie. Těžké widgety až viditelné, kvótované jen explicitní záložkou. Původní Mapy/Park4Night ID musí resolvovat i uložená místa před zmenšením overview. Detail z přehledu ihned, doplnění abortovatelné. Fullscreen galerie se šipkami/Escape/křížkem; Low Data bez preloadu sousedů.

### T05 — počasí a environmentální data

Počasí: stabilní grid, buňky 70–110 px, nejvýše 480; 96 popisků desktop/48 mobil; nejvýše 144 vstupních bodů. Lokální zoom/interpolace bez dotazu na snímek, hystereze ±0,25 a dvě sady. Časový ovladač 56 px desktop/80 mobil, den/čas/play; model/platnost/legenda v malé nabídce, bez mediánu výřezu. Play čeká na připravený snímek; preload max1, Low Data0. Zavření/skrytí pozastaví.

GBIF agregované mapové dlaždice jako hustota publikovaných pozorování, oddělené detailní GBIF/iNaturalist body při přiblížení. Ovzduší: stanice odděleně od CAMS/Open-Meteo modelového PM2.5/PM10/EU AQI gridu, max48 vstupních míst, zdrojový čas a rozlišení. Sucho: katalog capabilities každých24h, poslední ověřená edice, přesná kategoriální legenda; rozlišit bez indikace/mimo pokrytí/chybí.

EMODnet: lokální numerický import od západního Středomoří, zdrojová edice, vertikální reference a no-data. Stabilní víceúrovňový grid; medián všech validních základních buněk v cílové ploše, nikdy medián mediánů. Hodnota/min/max/count/vodní pokrytí, ořez maskou a popisek ve vodě. Přehled předgenerovat, detail omezeně z lokálních dat. Klient nestahuje celý raster. Do publikace pouze pravdivý mapový přehled, žádné bodové sondy vydávané za mediány.

### T06 — světy, katalog a podklady

Svět jen v logu, vlastní vrstvy/filtry pro každý svět; doporučené nastavení pouze při prvním vstupu. Osobní místa globální. Odchod ze hry uvolní GPU/listenery/požadavky. Bezpečné toalety běžná kategorie; události vlastní sekce Všechny/kategorie se sdílenými filtry, bez změny režimu. Přírodní události oddělit.

Podklady: stejný skutečný berlínský výřez pro Mapy, ÖPNV, CARTO, Esri i ostatní; skutečná konfigurace a autentizace, bez follow light/dark ovladače. Uložený náhled jen kde dovoleno, jinak lazy povolený živý. Žádné všechny podklady při startu ani skrytě placený Google preview.

### T07 — persistentní bezplatný rozpočet

Před aktivací Google/Foursquare: serverový atomický budget poskytovatel/billing/SKU/období. Allowlist operace/polí → dedup pokud dovoleno → rezervace → odeslání. Odeslané chyby/aborty se počítají; retry další rezervace. Výpadek evidence = nepouštět kvótované požadavky. Restart nesmí vynulovat spotřebu.

Stropy za měsíc: Google tiles80 000, Text Search Pro1000, Details Pro1000, Details Enterprise500, Routes Essentials1000, placené Photos/Street View Tiles0; Foursquare Pro450 a současně15/den globálně, Premium0. Tyto interní stropy neprokazují volný zůstatek účtu. Aktivace jen po ověření ceny, skutečného zůstatku a jiné spotřeby. Providerové kvóty a omezené oddělené klíče, žádné klíče v repo/logu. Náhrady klíčů ověřit před zrušením starých.

### T08 — Google

Oficiální 2D Tiles session se skutečnou expirací, sdílená dle typu/jazyka/regionu. Omezená proxy, správná cache/logo/dynamická atribuce, žádný offline archiv. Obnova session jednou. Search MapOS/Google, Google jen Enter/potvrzení, max20 a bez autopaging/Nearby při pohybu; allowlist polí, žádné `*`.

Potvrzený billing mimo EHP: běžné Google Places mapové výsledky a Google trasy svázat s Google podkladem. Nabídnout přepnutí; při odchodu odstranit proprietární overlaye, zachovat otevřená data. Nezařazovat Google obsah do otevřeného indexu/exportu; uchovávat jen povolené reference. Panorama lazy Maps Embed Street View s omezeným browser key, explicitní alternativa Mapillary. Routes Essentials pouze explicitní výpočet, bez traffic/matrix/optimalizace; chyba nikdy neznamená přímku.

### T09 — Foursquare

Nové Places API + version header a fsq_place_id. Záložka spustí Pro-only dotaz až klikem. Známé ID1call; jinak lokální OS index, poté search název/poloha radius200m/max3. Nejednoznačné kandidáty vybere uživatel. Search s potřebnými poli nevyvolá detail znovu. Žádné Premium rating/photos ani skryté staré v3 calls. Uchovávání odpovědí až podle konkrétních podmínek účtu.

Samostatný otevřený FSQ OS import z Places Portal/Iceberg: ES/CZ, následně ověřené země; omezená RAM/disk, edice/ID/kategorie/původ/uzavření. Silné shody v existující POI identitě, nejasné ponechat. Nikdy míchat komerční Premium data do OS datasetu. OS import nespotřebovává Pro API budget, vyžaduje vlastní přístup.

### T10 — hra

Aktivní world/GameHost. GPS a Prozkoumat oddělit: virtuální avatar bez wallet/test oprávnění nedokazuje návštěvu/nečerpá GPS odměnu. Jeden GPS vlastník. MapLibre keyboard vypnout jen při herním focusu a obnovit původní stav; šipky/WASD/joystick jeden controller, input/modal/blur/hidden zastaví. Rychlost4m/s sprint8, vizuální avatar6m, autentický schválený default asset; náhrada označená fallback.

WalkableSector s revizí, pokrytím, OSM uzly/hrany/access/foot/conditional/barrier/bridge/tunnel/layer. Konzervativní povolená pěší síť, ne libovolné highway. Most nevytváří křižovatku pod ním. Klient max8MiB/1preload, server omezená cache24h. Start snap do30m, jinak nabídka dosažitelného bodu. Tap-to-walk graf do2km, bez spojení zastavit. Les/pláž zatím pouze ověřené cesty.

Jeden interpolovaný camera controller: z18,3/pitch55, pan pozastaví follow, ruční zoom respektovat, avatar níže dle panelu; HUD max5Hz, síť max1Hz jen změny. 3D budovy odz14, Low Data vypne; terén odložen do správného výškového umístění. Serverové entity ze stejných verzovaných anchorů jako validace. První cyklus quest/interakce/capture/uložení/reconnect, nonce a idempotence. Instancing a uvolnění GPU. Bez nové ekonomiky/stakingu/multiplayerové autority.

### T11 — malé nové integrace

EONET kategorie/období +cache15min. GIBS denní true-color a sníh z capabilities přes WMTS. Radio Browser lokální katalog s polohou denně, bez autoplay. ČSÚ EP2024 účast/vítěz/podíl strany/rozdíl1.–2. v současných sériích s kontrolními součty. Wikidata majáky/technické památky/observatoře současným POI tokem. GBFS předpočítaný registr pokrytí. Vše nové výchozí vypnuto, žádná nová startup zátěž.

### T11b — veřejné webkamery a aktivační návaznost Foursquare

[Detailní implementační a aktivační postup](2026-09-08-foursquare-webcams.md): Foursquare podle existující rozpočtové brány; Windy Webcams jako volitelná vrstva kamerových pinů, explicitní snímek/player, žádné automatické video ani hover HTTP. Sdílet katalog, DTO, transport a detail; bez druhé galerie. Živý přístup dosud neaktivován.

## AI a pohybové světy

Aktualizace priority 8.9.: [AI-1 až AI-3](2026-09-08-ai-map-priority.md) nyní předchází dalšímu rozšiřování Global/Planet. První implementace řeší přesné mapové výsledky a část kontextu/rušení; úplná evidence a náklady zůstávají součástí stejného T12.

- [T12: úplný návrh AI odpovědí, společné evidence, mapových akcí a testů](2026-09-07-ai-global-extension.md).
- [T13/T14: detailní audit Velocity, oficiální feedy a návrh Global/Planet](../research/2026-09-07-velocity-audit.md).
- T12 smí zobrazovat jen dostupné autorizované zdroje. Predikce letadla/satelitu zůstává výpočtem označeným jako výpočet, nikoli měřením nebo úsudkem modelu.

## Povinné ověření a vydání

Testovat sdílení/poslední abort/generace/vypnutí během dotazu, odlišné prázdné a chybové stavy. Pro geometrii díry/ostrovy/hraniční bod/průchozí trasa/soukromá data/limit/paging/revize. Pro grid známý raster a skutečný medián, no-data/pobřeží/nula/časová platnost/stabilní buňka. Pro budget souběh poslední jednotky/restart/retry/Pro allowlist/nulový skrytý provoz/exporty. Hra input focus/GPS autorita/bariéry/nespojený graf/anchor/reconnect/idempotence.

Browser: Praha/Tarragona/pobřeží/Evropa, desktop/mobil/light/dark/vector/satellite/raster/Low Data/reduced-motion/GPS denied/pomalý nebo chybující zdroj. Výběr → pan → filtr → hover → detail → galerie → zrušení, clustery2/3/mnoho, 30 cyklů lifecycle.

Měřit skutečně před/po: 6/12 vrstev, přenosy/doba použitelnosti/interakce/RAM/zdroje/listenery. Hover lokální p95≤50ms zvlášť od150ms prodlevy. Hover a animační snímky0provider calls. Payload cíl−30% pouze pokud výchozí audit doloží prostor; neuvádět cíl jako výsledek. Ověřit žádný soustavný růst po zahřátí a uvolnění. Startup žádný celoevropský OSM dotaz.

Nasadit až po kontrolách projektu, záloze a ověření obnovy, dopředných migracích a atomické publikaci neměnných datových edic. Samostatné feature flags pro kvóty/importy. Veřejný smoke, rollback aplikace i manifestu bez destruktivního rollbacku DB. Předání: skutečná revize/URL, měření, pokrytí, integrace a konkrétní nedodělky; neaktivní API ani část Evropy neoznačovat jako hotové.

## Aktualizace 12. 9. — přehled oblastí a statistiky

Viz [aktuální implementace, importy a důkazy](2026-09-12-area-overview-statistics.md). Nové publikované NUTS 3 hranice/populace/hustota rozšiřují existující katalog; žádný nový renderer nebo AI klient. Další P2 řady a crosswalk pro ostatní správní zdroje zůstávají produktovým backlogem. Dokončení se posuzuje podle veřejně ověřené revize v uvedeném dokumentu.

## Aktualizace 12. 9. 2026 — Ollama Cloud a záložky detailu

Nasazeno `20260912-cloud-detail-r10`. Ollama GLM 5.3 Flash / GLM 5.3 a společné web search/fetch jsou aktivní a živě ověřené. Vlastník výslovně převzal správu tarifu; starší podmínka doložení bezplatné Ollama alokace je nahrazená provider-managed konfigurací. Detail nyní používá Info / Fotky / Recenze / Panorama; odstraněna automatická webová rešerše běžného Discover a neověřené zaměňování stejně pojmenovaných čtvrtí. 191 regresních testů prošlo, obnova 90 tabulek ověřena. Podrobný stav, měření a konkrétní nedokončené části: [Cloud a detail](2026-09-12-cloud-detail-tabs.md).

Google panorama: živý test klíče vrátil 403 — Maps Embed API není zapnuté v projektu. Mapillary vyhledávání potřebuje token. Tyto funkce nejsou označené jako aktivované; zatím jsou dostupné přímé odkazy v záložce Panorama. Volná syntéza neověřených webových kandidátů, celý kontext filtrů/času obecného chatu a širší původní backlog zůstávají samostatné úkoly.
