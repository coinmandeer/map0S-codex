# MapOS: rychlá, srozumitelná a praktická mapa

Další ověřená produktová priorita: [přehled vybrané oblasti a skutečné rozlišení statistik](2026-09-12-area-overview-statistics.md). Audit 12. 9. našel nespojené regionální podklady a preferenci státních řad v běžném katalogu; opravy zatím nejsou implementované ani nasazené.

## Oprava cyklistických voleb a statistické konverzace (12. 9. 2026)

Cyklistické volby, statistická konverzace a mobilní opravy jsou implementované, ověřené a nasazené jako `20260912-ai-statistics-cycling-r5`. Důkazy a zbývající omezení: [AI/statistiky/cyklistika r5](../releases/20260912-ai-statistics-cycling-r5.md).

- Plná CyclOSM je znovu jasně dostupný podklad; infrastruktura Lite a značené sítě Waymarked mají odlišné explicitní akce.
- AI statistický dotaz vybírá zemi z otázky a zachovává konverzaci ve vyhledávání. Navazující ukazatel/země sdílí historii s AI panelem.
- Publikované české NUTS 2 hodnoty AROPE a nezaměstnanosti jsou skutečně dostupné a propojené s geometrií. Chybějící obecní řady ani kompletní evropské pokrytí se nepředstírají.
- Opravené rušivé automatické otevření statistického exploreru, skoky kamery při obnově a dvojí započtení prostoru panelů.
- Další analytické záměry, časové trendy a pokročilejší syntéza zůstávají produktovým backlogem. Oprava konkrétní otázky není důkaz obecné schopnosti odpovědět na libovolnou statistickou otázku.

Schválený směr 9. 9. 2026: najít místo → pochopit mapu → detail → cesta → uložení/sdílení.
Výchozí doložené vydání: 20260909-ai-overview-v2-r2. Tento dokument odděluje rozpracovaný kód od ověřeného nasazení. Aktuální práce není tvrzením o dokončení celého plánu.

## Předchozí produktové vydání: 20260909-product-ux-r2

Nasazeno na https://mapos.promptstudio3000.com. Podrobné důkazy a omezení: [záznam vydání](../releases/20260909-product-ux-r2.md).

| Balíček                       | Implementováno a nasazeno                                                                                                                                                                                           | Ověření / zbývající omezení                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Překryvy                      | CyclOSM Lite, více aktivit Waymarked, samostatné krytí, migrace OpenTopo bez změny podkladu. Zrušené či nahrazené aktualizace nepřidají další zdroje.                                                               | Regresní testy a 6/12vrstvový benchmark prošly. Živý CyclOSM zůstává závislý na dostupnosti komunitních dlaždic.                                                                           |
| Načítání                      | Hledat zde zachytí konkrétní vrstvy; timeout je terminální pro daný výřez; pan sám nepotvrdí zotavení. Zavíratelné chyby a per-layer retry.                                                                         | Testy timeoutu, pan/outage, lifecycle. Nula API požadavků během samostatného měření hoveru a změny opacity po ustálení.                                                                    |
| Hledání                       | HTTP selhání má vlastní chybu, retry a křížek; zadání zůstává. Geocoder uvádí, že není omezený na výřez.                                                                                                            | Praha a Tarragona; simulovaná 503 a následné úspěšné opakování.                                                                                                                            |
| Cesta                         | Detail, kontextové menu, Discover a uložená místa používají jednu operaci přidání skutečné zastávky na konec draftu bez změny režimu/GPS/výpočtu. Undo používá ID.                                                  | Jednobodový lokální draft, přidání dalších bodů a undo testované. Výpočet/uložení vyžadují dva body. Nové plánování po reloadu zůstává prázdné.                                            |
| Katalog                       | Paměť Vše/Zapnuté, hledání kategorií/sekcí a odkazy k existujícím překryvům, viditelné aktivní filtry, reset vrstvy. Preset má potvrzení obsahu a undo bez přepsání později upravené vrstvy.                        | Hledání zahrnuje dostupné statistické série i konkrétní kategorie. Neaktivní zdroj je odlišený od zamčeného přístupu; další registrace konkrétních providerů mají svůj integrační backlog. |
| Návrat a mobil                | Discover při otevření detailu zůstává připojený, uchová obsah/scroll a vrací focus. Zachována existující podpora visualViewport, safe areas a mobilního shellu.                                                     | Desktop a mobil 390×844 zkontrolovaný. Fyzická mobilní klávesnice, VoiceOver a všechny kombinace dialogů nejsou v tomto vydání nově certifikované.                                         |
| Detail / AI                   | Kompaktní providerové záložky, krátký přehled s volitelným delším vysvětlením, popis cíle, existující citace/hlášení. Uložené přehledy ruší staré list/detail dotazy; mazání jiné položky nezavře otevřený přehled. | API vlastnictví testované. Živá plná modelová syntéza se touto změnou neaktivuje. Úplné slučování duplicitních faktů všech poskytovatelů zůstává samostatnou obsahovou prací.              |
| Dřívější produktové rozšíření | Existující Discover/statistiky/počasí zachované.                                                                                                                                                                    | Kompletní evropská distribuce, numerická batymetrie, aktivace kvótovaných poskytovatelů, hra a Planet nejsou tímto vydáním dokončeny.                                                      |

## Závazné další chování

- Lehké vrstvy po 300 ms klidu, drahé přes jedno dostupné Hledat zde. Žádný detailní evropský OSM dotaz; žádný provider dotaz při hoveru, animaci ani změně krytí.
- Starší data jen pro kompatibilní dotaz a s označením. Změna oblasti/filtru nesmí vydávat staré body za nový výsledek.
- Jeden katalog včetně neaktivních položek; integrace vs aktuální pokrytí jsou různé stavy. Chyby lze zavřít bez vymazání diagnostiky.
- Hranice: celý bbox s panely, pouze děti vybraného rodiče, oddálení vrací sousedy, nad 13,5 skrýt běžné hranice. Nejvýše dvě sady.
- Statistiky pouze pro skutečnou úroveň a období; jedna výplň, stabilní škála, no-data nejsou nula.
- Počasí: čas se změní spolu s připraveným obrazem; play končí po zavření/skrytí stránky. Low Data bez přednačítání.
- Search: jednoznačný název + typ + oblast, žádná skrytá AI. Plán po reloadu prázdný; chyba routeru zachová body a nevydává přímku za cestu.
- AI: okamžitá fakta, kvalitní citovaný souhrn, kontext filtrů/oblasti/času, Stop/partial, geometrie nezávislá na textu, návrat bez nové generace. Neaktivní model neoznamuje probíhající rešerši.

## Ověření a vydání

Vydání 1: překryvy, ovládání, katalog a chyby. Vydání 2: data/Discover/environment/search/trasy. Vydání 3: detail a užitečné AI.
Každé přes projektové kontroly, zálohu/restore, kompatibilitu a veřejný smoke. Žádné nové importy ani API aktivace se nesmějí vydávat za hotové podle existence adaptéru.

Kontrolovat Praha/Tarragona, satelit/Mapy/vektor, mobil/desktop, obě témata, Low Data, reduced-motion, odmítnutá GPS; pomalé a selhávající zdroje; 30 cyklů vrstev/detailů. Benchmark 6/12 vrstev před/po se stejným zařízením/výřezem/cache: přenosy, použitelná mapa, první výsledky, odezva a paměť. Hover p95 ≤50ms bez 150ms UX prodlevy. Neuvádět dosud nezměřené cíle jako výsledky.

## Další produktový backlog

Google; aktivace FSQ a OS import; numerická batymetrie; další statistiky a kamery; úplný pěší graf a quest cyklus; Planet. Nejsou to technický dluh a neblokují tento produktový balíček. Hra a Global pouze regresní opravy.

## Doplnění uživatelského UX auditu

[Navazující plán](2026-09-09-ux-audit-followup.md) zachovává současné rozestavení/styl a doplňuje zejména viditelný kontext výsledků, hledání bez falešné nuly, přidání zastávky bez změny režimu, návrat se scrollem a mobilní použitelnost. Nepřebírá automatickou obnovu draftu po reloadu ani nový mobilní shell. Rozpracované změny nejsou při tomto doplnění nasazené.

### Navazující práce 12. 9. 2026 — oblasti a statistické rozlišení

Implementace a ověřené regionální importy jsou evidované v [přehledu oblasti/statistik](2026-09-12-area-overview-statistics.md). Priorita: skutečně vybraná oblast místo středu, jedno rozlišení metadat a mapy, viditelný rozsah čísel a užitečný přehled bez čekání na model. NUTS 3 populace a hustota už byly publikované; nelze je dál evidovat pouze jako plánovaný descriptor. Živá syntéza bez potvrzeného rozpočtu ani obecní chudoba tím nejsou aktivované.
