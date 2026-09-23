# AI přehledy, oblastní fakta a statistické vazby — 12. 9. 2026

Navazuje na [oblastní plán](2026-09-12-area-overview-statistics.md) a [AI Overview V2](2026-09-09-ai-overview-v2-implementation.md). Rozložení, vizuální styl, SSE endpoint, gateway, společný přehled i existující mapová vrstva zůstávají. Historické splněné úkoly se neopakují.

## Vydání a skutečný stav

Výchozí vydání: `20260912-area-overview-statistics-r3`. První celek `20260912-overview-regions-r4` byl nasazen s dopřednou migrací 0025 a ověřenou obnovou zálohy. Závěrečné vydání **`20260912-overview-regions-r6` je nasazené** na [veřejné aplikaci](https://mapos.promptstudio3000.com). Záloha, obnova 90 tabulek, migrace, kompatibilita a veřejné ověření jsou doložené níže.

| Výsledek                              | Implementace                                                                                                    | Ověření                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Úřední vazby LAU–NUTS                 | 0025, kontrolovaný offline parser, atomický import podle přesné zdrojové edice/kódu                             | Publikováno 195 298 vazeb (97 649 obcí na NUTS 2 a NUTS 3), 31 zemí                                                       |
| Obecní údaj versus regionální kontext | Společný Discover/Overview používá crosswalk, přesné pokrytí zůstává pro jiné zdroje                            | Praha → CZ01 AROPE 9,1 %; Tarragona → ES51 21,3 %, 2025. Nejde o obecní míru chudoby                                      |
| Čitelnější odpověď                    | Krátký úvod, charakter, místní statistiky, zajímavosti, praktické údaje, širší kontext, návštěvnické zprávy     | Stabilní sekce, zachované citace, české běžné jednotky/kategorie; základní obsah už není schovaný společně pod rozbalením |
| Encyklopedický popis                  | Ověřené QID a již existující sdílený Wikipedia resolver i v režimu dostupných dat                               | Není podmíněný spuštěním Ollama web search; shoda podle názvu nestačí                                                     |
| Místa oblasti v mapě                  | Serverová reference v EvidenceItem, časné mapRefs; text a geometrie mají oddělené revize                        | Test 20 doplnění textu zachovává geometrickou revizi                                                                      |
| Staré OSM body                        | Přesný lokální resolver `osm-<id>`; nevydává číselné ID za konkrétní OSM node/way                               | Zachováno původní ID, zdrojový odkaz vede na polohu; nové typované reference se nemění                                    |
| Návaznost chatu na oblast             | Serverem ověřené areaRef se přenáší do společného overview pro explicitní otázky o vybrané oblasti              | Otázka na jinou zemi má dál přednost přes statistickou službu; nechceme vracet aktuální polohu místo odpovědi             |
| Navazující otázky                     | Nabídky podle skutečné evidence; další záměr může použít dokončené podklady stejného vlastníka/ACL/cíle/času    | Změna oprávnění či refresh cache obchází; neúplný sběr se nepovažuje za hotový                                            |
| Modelový výstup                       | Sekce přes stávající submission tool, nejvýše jedna oprava; úplné doložené věty s validací citací/čísel/rozsahu | Automatické testy. Živá aktivace zatím čeká na ověřenou alokaci Ollama                                                    |
| Podrobnost statistiky                 | Automatický výběr nebo explicitní dostupná úroveň nad současnými zdrojovými filtry                              | Dostupnost publikace oddělena od toho, zda ji uživatel vypnul                                                             |
| Další regionální data                 | Eurostat 65+ NUTS 3, HDP na obyvatele NUTS 3                                                                    | Importy a kontrola kódů/edice; rozdílný poslední rok mezi zeměmi není skrytý                                              |

## Úřední vazby a publikované pokrytí

Zdroj: [validovaná tabulka Eurostatu LAU 2024 – NUTS 2024](https://ec.europa.eu/eurostat/web/nuts/local-administrative-units), konkrétní [zdrojový workbook](https://ec.europa.eu/eurostat/documents/345175/501971/EU-27-LAU-2024-NUTS-2024.xlsx/12971f56-c035-dbab-4d9f-ff1dcc617bb3). SHA-256 `f114f962c2d29153bdd1245a9ba88114f4879d7387a8c0ae10cae1f34d4f41c4`.

Parser ověřuje schema, kódy, duplicity, zemi a limity velikosti. Zachovává řetězcové oficiální kódy včetně úvodních nul. Import se váže k plnému identifikátoru již instalované zdrojové edice; nezmění existující hranici ani její název. Konflikt s dříve publikovanou vazbou zastaví transakci. Vazba není prostorová tolerance ani odhad podle názvu. Stejný kód v jiné edici automaticky nezdědí předchozí vazbu.

Ze 97 674 zdrojových záznamů zvolených 31 zemí se k místním edicím připojilo 97 649 obcí. Rozdíl: DE 2, EL 1 a NO 22 nepřipojených řádků; nejsou vydávány za hotové pokrytí. NUTS 1 není v tomto importu publikovaný, protože zde nemá instalovanou odpovídající cílovou edici. Turecký list má odlišné schéma, nebyl bez kontroly převzat. Česká kontrola 6 258/6 258, španělská 8 132/8 132. Podrobnosti: [účtenka](../evidence/2026-09-12-overview-regions/crosswalk-import.json).

Příprava: `python3 scripts/prepare-lau-crosswalk.py SOURCE.xlsx OUTPUT.json CZ ES` nebo explicitní seznam ověřovaných zemí. Import v API prostředí: `node apps/api/dist/geo/importLauCorrespondence.js OUTPUT.json`. Zdrojový kontinentální soubor se neposílá prohlížeči.

## Regionální řady

- `eurostat-population-65-plus`: 32 801 historických hodnot, 2000–2025; počet lidí ve věku 65+, **nikoli procentní podíl**. Za rok 2025 ověřeno CZ 14/14 a ES 59/59 číselných hodnot s geometrií. Praha NUTS 3: 257 441; Tarragona NUTS 3: 176 264. [Eurostat populace podle věku](https://ec.europa.eu/eurostat/databrowser/view/demo_r_pjanaggr3/default/table).
- `eurostat-gdp-per-capita`: 30 956 historických hodnot, 2000–2024. Česko má v roce 2024 14/14 krajů, Praha 62 400 EUR/obyvatele. Španělsko má nejnovější publikovaný rok 2023; Tarragona 34 500 EUR/obyvatele. HDP není příjem domácnosti. [Eurostat HDP](https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table).
- Stávající místní populace/hustota, NUTS 3 populace a NUTS 2 AROPE/nezaměstnanost zůstávají. Referenční rok a rozsah se přenášejí jako strukturovaná metadata evidence, nezískávají se parsováním modelového textu.

## Dvě chyby nalezené až živým ověřením

1. **Zadržovaný proud odpovědi.** Caddy komprimoval `text/event-stream` pomocí zstd. V kontrolním běhu dorazily události najednou přibližně za 2 365 ms. Komprese se nyní vypíná jen pro dvě AI SSE cesty; ostatní odpovědi ji zachovávají. API posílá `no-transform` a `x-accel-buffering: no`. Po opravě první obsah v témže scénáři za 299 ms a další části postupně do cca 2,5 s. Jde o jednotlivé běhy, nikoli p95 ani obecné procento zrychlení. [Před](../evidence/2026-09-12-overview-regions/stream-before.json), [po](../evidence/2026-09-12-overview-regions/stream-after.json). Konfigurace je verzovaná v `infra/caddy-mapos.caddy`; původní vhost je v záloze r4 `caddy.before.conf`.
2. **SQL po přidání crosswalku.** Kombinace prostorové a kódové větve pomocí OR zhoršila použití indexu. Opravené větve se spojí až po samostatném indexovaném výběru, nepřenášejí celé geometrie do mezivýsledku. Živý read-only probe opraveného dotazu: Praha 65/18/20 ms, Tarragona 24/12/11 ms; vždy správná regionální AROPE. První běh není garantovaně studený diskový test. Původní timeout nebyl vydáván za neexistující data.

Stabilní hashové identifikátory evidence zkracují opakované zprávy, zachovávají cílovou revizi i zdrojový záznam. Prázdné/duplicitní publikace už nevytvářejí další plný snapshot. Původní ID míst ani staré uložené snapshoty se nepřepisují.

## Co není hotová živá schopnost

- V databázi nebyla 12. 9. nalezena žádná alokace poskytovatele Ollama. Uživatel byl požádán o tarif a doložitelnou přidělenou kapacitu, nikoli klíč. Model/web zůstávají za existující tvrdou rozpočtovou bránou. Není dovoleno vytvořit rozpočet podle domnělé volné kvóty.
- Syntéza je řízený výběr a uspořádání doložených zdrojových vět; není to volné generování nových tvrzení. U webových kandidátů bez ověřené identity se nezobrazí text jako potvrzený fakt. Plná tematická webová rešerše, rozpory a živé obsahové hodnocení modelu nejsou tímto označené za dokončené.
- Crosswalk libovolných geoBoundaries krajů/okresů na oficiální statistické jednotky a Wikimedia stále vyžaduje úřední identifikátory; běžné `shapeISO` někdy označuje celou zemi. Nepřiřazovat je podle názvu.
- Automatická srovnání sousedů, kompletní věková struktura, plně lokalizované odpovědi mimo češtinu a plošně připravená média mají samostatný backlog. Zde je první konkrétní věková řada, nikoli hotová demografická analýza.
- Obecný tool-loop chatu není plně nahrazený overview; přehled místa a explicitně vybrané oblasti společnou službu používají. Před dalším rozšířením je potřeba společná evidence a rozpočty zbývajících modelových cest.
- Soukromé AI zdroje a veřejné sdílení soukromých přehledů zůstávají vypnuté. Google/FSQ, hra, numerická batymetrie a Planet nejsou dokončené tímto AI balíčkem.

## Předání r6 — implementováno, ověřeno a nasazeno

- Veřejné API a web jsou zdravé, aktivní symlink ukazuje na `20260912-overview-regions-r6`. [Obnova 90 tabulek a kompatibilita](../evidence/2026-09-12-overview-regions/restore-r6.txt) prošly před přepnutím aplikace. Migrace 0025 je dopředná a idempotentní; návrat předchozí aplikace nevyžaduje odstranění dat. Hranice nebyly přepublikované pod jinou identitou.
- Cílený soubor 236 testů prošel, SDK 105 testů prošlo; po poslední úpravě úvodu a atribuce dalších 23 cílených kontrol prošlo (překrývají se s původní sadou, nesčítat jako nezávislý počet). Produkční sestavení API/webu, architektura, CSS tokeny a kontrola tajemství prošly. Velké frontendové chunky stále zůstávají.
- Finální úvod oblasti má v živých kontrolách 38 slov pro Prahu a 36 pro Tarragonu. První věta popisu a stejné statistiky se už neopakují v následujících sekcích; zdrojové podklady zůstávají v evidence. Ovládání mapových míst je před sekcemi a nečeká na dočtení celé odpovědi. Původ encyklopedického úvodu Discover má vlastní `leadSourceIds`; neodvozuje se z OSM tipů pod ním.
- Veřejná otázka o „této oblasti“ vrací vybranou Prahu i při zaslaném středu mapy v Tarragoně. Vrací osm ověřených míst uvnitř hranice a karty zdrojových sekcí. Veřejný dotaz na chudobu ČR vrací AROPE, 8/8 NUTS 2, Moravskoslezsko 14,5 % (2025), kartu statistiky a vysvětlení rozsahu. Nejde o obecní chudobu ani pořadí příjmů. [Živý chat](../evidence/2026-09-12-overview-regions/public-r6-chat.json).
- Prohlížeč ověřil výběr Prahy z polygonu, explicitní přehled, klikatelné citace, přepnutí populační mapy LAU → NUTS 3 bez změny kamery a krajské hodnoty v tabulce. Mobil 390 × 844/reduced-motion: scrollWidth 390, bez horizontálního přetékání. Tento smoke není celá matice podkladů, klávesnice a 30 cyklů.

### Skutečné veřejné měření

Apple M4 / 24 GiB, macOS 26.6.2, Headless Chromium 152, veřejné HTTPS. Běh 12. 9. 2026 18:48 UTC, mobilní viewport 390 × 844 se zapnutou mapou. Každý cíl: explicitní refresh a pět opakování stejné relace. Cache upstreamů nebyly plošně vymazané. Bez modelového/webového souhlasu; nejde o Ollama benchmark.

| Cíl                               | První fakta | První mapová místa | Dokončení | Teplá cache, 5 vzorků          | Dekódované SSE prvního běhu |
| --------------------------------- | ----------: | -----------------: | --------: | ------------------------------ | --------------------------: |
| Praha LAU                         |       80 ms |             425 ms |  1 744 ms | 237 / 568 / 857 / 332 / 818 ms |                   173 179 B |
| Tarragona LAU                     |       81 ms |             457 ms |  1 579 ms | 551 / 714 / 347 / 507 / 396 ms |                   145 555 B |
| Neznámý bod                       |       85 ms |              žádná |     85 ms | 50 / 51 / 67 / 61 / 77 ms      |                     4 572 B |
| Původní OSM ID z lokálního indexu |      165 ms |             191 ms |  5 001 ms | samostatně neměřeno            |                    26 943 B |

Zdroj: [měření r6](../evidence/2026-09-12-overview-regions/public-r6-metrics.json). První fakta jsou před doplňovanými externími zdroji. U původního OSM ID je ověřené otevření přesného místního záznamu; 5s celkové doplnění zůstává viditelným omezením externího zdroje. U neznámého bodu se žádný sousední podnik nestal identitou.

Cíl p95 teplé cache ≤500 ms **není v tomto malém vzorku oblastí splněný**. Empirický nearest-rank p95 (maximum z pěti) je Praha 857 ms, Tarragona 714 ms, bod 77 ms. Je potřeba oddělit čas autorizace/serveru, přenosu a hlavního vlákna aktivní mapy; nejde o prokázanou samotnou SQL latenci. Během této doby se na sdíleném VPS nasazovaly i jiné aplikace. Výsledky proto neslouží jako garantované SLO ani čistý výkonový test izolovaného serveru.

Nové oblastní přehledy obsahují více statistik, míst a plný citovaný encyklopedický popis. **Neprokazujeme celkové snížení přenosů proti starému chudšímu obsahu.** Dekódované tělo není síťový přenos; teplá odpověď obsahuje jeden snapshot (Praha 35 700 B), nový běh několik samostatně validovatelných snapshotů. Další úspora má cílit na sdílený obsah progresivních zpráv při zachování kompatibility a obnovy. Žádné vymyšlené procento úspory není vykázané.

### Konkrétní navazující práce

1. Aktualizace 12. 9.: vlastník výslovně převzal správu tarifu; původní podmínka doložení bezplatné alokace už neplatí. Aktivace a živé evaly pokračují v [Cloud/detail balíčku](2026-09-12-cloud-detail-tabs.md). Výběr celých zdrojových vět je implementovaný, volná tematická syntéza a ověřování rozporů nejsou dokončené.
2. Profil prvního/teplého běhu a úspora opakovaných evidence payloadů; cílit na naměřené překročení 500 ms, zachovat revize a pozdní odběratele.
3. Oficiální identity ostatních správních zdrojů, úplnější demografie a srovnatelné sousední statistiky; žádná oblastní procenta neodhadovat z plochy nebo názvu.
4. Ověřené Wikidata/Mapy produkční vrstvy, společný scope obecného chatu, soukromé zdroje a revokace pouze před jejich skutečným zpřístupněním. Dnes zůstávají vypnuté.
5. Zbývající obsahová/lokalizační a browser matice včetně zdrojově připravených médií; neprezentovat převzaté krátké texty jako novou živou rešerši.

Finální vizuální kontrola r6: [desktopový přehled](../../output/playwright/overview-r6-final-desktop.png), [místa v mapě](../../output/playwright/overview-r6-map-results.png), [mobilní přehled](../../output/playwright/overview-r6-final-mobile.png). Zobrazit → hover → Skrýt nepřidalo žádný dokončený AI request do resource timing a kamera zůstala na stejných souřadnicích/zoomu; [záznam](../evidence/2026-09-12-overview-regions/map-ui.json). Místní body se vykreslily po připravení inline vrstvy, bez zapnutí celého OSM. Nejprve použitý eventový záznam síťových požadavků ukončil testovací CLI relaci; kontrola byla zopakována v čisté relaci bez této instrumentace. Tento záznam proto netvrdí úplný audit všech síťových transportů nebo listenerů.
