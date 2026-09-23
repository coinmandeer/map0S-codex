# MapOS — UX audit: srozumitelný kontext a cesta od výsledku k akci

## Oprava cyklistických voleb a statistické konverzace (12. 9. 2026)

Cyklistické volby, statistická konverzace a mobilní opravy jsou implementované, ověřené a nasazené jako `20260912-ai-statistics-cycling-r5`. Důkazy a zbývající omezení: [AI/statistiky/cyklistika r5](../releases/20260912-ai-statistics-cycling-r5.md).

- Plná CyclOSM je znovu jasně dostupný podklad; infrastruktura Lite a značené sítě Waymarked mají odlišné explicitní akce.
- AI statistický dotaz vybírá zemi z otázky a zachovává konverzaci ve vyhledávání. Navazující ukazatel/země sdílí historii s AI panelem.
- Publikované české NUTS 2 hodnoty AROPE a nezaměstnanosti jsou skutečně dostupné a propojené s geometrií. Chybějící obecní řady ani kompletní evropské pokrytí se nepředstírají.
- Opravené rušivé automatické otevření statistického exploreru, skoky kamery při obnově a dvojí započtení prostoru panelů.
- Další analytické záměry, časové trendy a pokročilejší syntéza zůstávají produktovým backlogem. Oprava konkrétní otázky není důkaz obecné schopnosti odpovědět na libovolnou statistickou otázku.

Stav 9. 9. 2026: schválený požadavek na plán, nikoli na nový redesign. Vstupem je uživatelem dodaný text auditu. Autor auditu neprohlédl živou aplikaci; doporučení proto nejsou sama důkazem chyby. Tento dokument doplňuje produktový plán, neruší rozpracované opravy ani nepřesouvá technický dluh zpět do vydání.

## Implementační stav po vydání 20260909-product-ux-r2

Nasazeno 9. 9. 2026; [důkazy vydání a přesná omezení](../releases/20260909-product-ux-r2.md). Následující plán zůstává cílovým rozsahem; existence této sekce není potvrzení každého historického návrhu.

- Dokončeno rozpracované rušení překryvů, cílené Hledat zde, timeouty a ochrana uložených přehledů před starými odpověďmi.
- UX-1: zachování Discover při detailu a focusu, kontext běžného hledání a overview. Plná obecná serializovaná výsledková relace všech panelů není nově zavedena.
- UX-2: pravdivá chyba/retry/zavření; hledání Prahy i Tarragony ověřené. Existující intent a explicitní AI zachované.
- UX-3: společné přidávání skutečných míst bez opuštění Discover; explicitní otevření plánu a undo podle ID. Lokální jednobodový draft má metadata dev.mapos.collectingStops; nejde o vypočtenou ani uloženou cestu.
- UX-4: současná visualViewport/safe-area podpora zachována, mobilní screenshot ověřený. Úplný fyzický mobilní/accessibility průchod zbývá.
- UX-5: rozšířené hledání sekcí/překryvů, filtry a preset preview/undo; hledání je napojené i na názvy aktuálního statistického katalogu, neaktivní zdroj a zamčený přístup mají odlišné důvody.
- UX-6/7: kompaktní detail, kratší AI s rozbalením, datované uložené přehledy a bezpečnější mazání; úplná obsahová deduplikace a pokročilé sdílení soukromých přehledů se nepředstírají.

## Pevná omezení

- Zachovat současné rozestavení, umístění search/režimů/panelů a vizuální styl. Žádné nové hlavní okno, dashboard, navigace nebo sada barev.
- Existující desktopový i mobilní shell zůstává. Mobil se opravuje v jeho současných plochách; audit není autorizací přestavět ho na jiný bottom-sheet koncept.
- Discover zůstává výchozí. Po reloadu je nové plánování prázdné. Nabídnout lze explicitně otevření uloženého výletu, nikoli automatickou obnovu rozpracované trasy.
- Zachovat společný katalog včetně neaktivních integrací. Nezavádět povinný filtr, který neaktivní položky schová.
- Otevření detailu, hover, pohyb mapy ani onboarding nespouští model. Živá AI a kvótované zdroje zůstávají podle skutečné aktivace.
- Dříve požadovaný viditelný obsah detailu neukrýt znovu pod obecné Více. Rozbalování se týká delšího vysvětlení AI, nikoli základních faktů a hlavních médií.

## Výchozí stav a návaznost

Doložená produkce: 20260909-ai-overview-v2-r2. Historický stav před tímto vydáním: následující změny tehdy byly lokální; aktuální stav viz tabulka výše.

- CyclOSM Lite místo neprůhledného překryvu; odstranění OpenTopo překryvu, kompatibilní migrační cesta.
- Více vybraných sítí Waymarked, samostatné krytí překryvů, explicitní nabídka tras namísto automatického zapínání.
- Události bez změny režimu; opravené rozpoznávání dlaždicových zdrojů, zavíratelné chyby a pravdivější Map status.
- Filtr obnovuje svou vrstvu; vizuální změna má oddělenou událost bez nucené obnovy dat.
- Neaktivní registrované datové zdroje v katalogu, částečně doplněné hledání/Vše/Zapnuté.
- Kompaktní doplňkové panely detailu, označení přehledu z dostupných dat, odstranění vlastního uloženého přehledu.

Tyto části nejprve dokončit regresními a browser kontrolami. Celý starší produktový plán není tímto hotový. Detailní stav je v 2026-09-09-product-experience.md; údržba v 2026-09-09-technical-debt.md.

Další potvrzení z kódu:

| Místo                  | Zjištění                                                                 | Dopad na plán                                                                  |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| ui/CommandSearch.tsx   | Neúspěšný geocode/tag HTTP i některé výjimky skončí prázdným seznamem.   | UX-2 musí oddělit chybu od úspěšného prázdného hledání.                        |
| ui/MapPlaceContext.tsx | Přidání do trasy mění režim na planning a používá starší TripPlan cestu. | UX-3 sjednotí akci nad současným dokumentem plánu a ponechá Discover otevřený. |
| store/shellState.ts    | Existuje returnTo, historie a společný levý kontext pro AI/detail.       | UX-1 rozšíří stav obsahu a obnovu scrollu; žádná druhá historie panelů.        |
| ui/CommandSearch.tsx   | Existuje rozlišení intentů, běžné hledání a explicitní AI akce.          | UX-2 upraví názvy, chybové stavy a zpětnou vazbu; žádný druhý vyhledávač.      |
| store/mapStore.ts      | Původní pravidlo prázdného plánu po reloadu je zachované.                | Návrh auditu na automatické pokračování se nepřebírá.                          |

## UX-1 — Viditelný kontext výsledků a návrat (nejvyšší priorita)

Do existujícího záhlaví výsledků a AI přidat jeden stručný řádek „Výsledky pro …“ s akcí Změnit. Nezavádět další trvalou lištu nad mapou. Popisek odvozovat od skutečně provedeného dotazu:

- Běžný geocoder hledá název/adresu: nezobrazovat tvrzení, že byl omezen na výřez, pokud používá jen geografické zvýhodnění.
- Místní datové hledání: výřez zachycený při potvrzení; při zapnutém prostorovém filtru výřez ∩ vybraná oblast.
- Detail/AI místa: přesná identita pinu nebo vybraná souřadnice. Okolní místo není totožnost cíle.
- Oblast: stabilní ID a revize, čitelný název; samostatná možnost odstranit filtr.
- Koridor trasy: volba se nabídne teprve po existenci skutečné vypočtené geometrie a funkčního serverového koridorového dotazu. V tomto balíčku jej nevytvářet ani nepředstírat.

Pohyb mapy nezmění kontext hotové AI nebo explicitního hledání. Uživatel uvidí „Mapa se posunula“ a stávající akci pro nové hledání. Běžné lehké mapové vrstvy se dál mohou obnovovat automaticky. Klik na pin nezruší vybranou oblast.

V existující historii shellu držet klíč výsledkové relace, text hledání, filtry, vybraný výsledek a scroll seznamu. Otevření detailu či vrstev nesmí relaci zrušit. Návrat obnoví výsledky a focus. Pokud uživatel mezitím ručně posunul mapu, návrat ji automaticky nepřesune zpět; původní prostor výsledků zůstane označený. Bez ručního pohybu zůstává výřez beze změny.

Ověření: hledání → detail → galerie → zpět; oblast → pin → zpět; AI → detail → zpět; pan při otevřeném detailu. Žádná nová generace při návratu a žádný nový dotaz jen kvůli scrollu.

## UX-2 — Jeden vstup, rychlý výsledek a pravdivé hledání

Zachovat CommandSearch a existující detekci záměru. Český placeholder „Hledat místo nebo se zeptat na mapu“. Názvy/adresy/souřadnice vždy zpracuje běžná cesta; model až explicitním potvrzením AI akce. Nejednoznačné zadání nabídne výsledky míst a samostatné „Zeptat se AI“, dostupné podle schopností aplikace.

Přidat samostatný stav error pro geocode/tag hledání. Zachovat text, ukončit spinner a nabídnout Opakovat a zavření hlášení. Abort není chyba ani úspěšná nula. Staré výsledky nesmějí být označené jako výsledky nové otázky. Při selhání u stejného dotazu lze ponechat předchozí výsledky s označením.

Hlavní text výsledku bude název; druhý řádek typ a oblast. Typ nesmí nahrazovat název (Praha versus hlavní město). Deduplikace pouze podle totožnosti zdroje/entity, ne názvu.

Existující nabídku prázdného hledání využít pro nejvýše tři začátečnické akce: „Zajímavá místa v mapě“, „Naplánovat cestu“, „Uložená místa“. První použije aktuální výřez a běžné dostupné kategorie, nikdy automaticky GPS či model. Při velkém výřezu nabídne přiblížení. „Porovnat oblasti“ se nezobrazí jako hotová akce, dokud nemá funkční srovnávací cestu. Po první akci krátké tipy ustoupí; nedávná hledání zůstanou v současném menu.

Ověření: Praha, stejně pojmenované podniky, adresa, souřadnice, dotaz s AI vypnutou, offline/429/500, rychlé A→B, klávesnice a mobil.

## UX-3 — Přidat zastávku bez opuštění objevování

Jedna společná operace nad existujícím PlanDocumentV2 pro detail, mapové kontextové menu, Discover, výsledkový seznam a Osobní. Nezavádět druhý draft nebo novou trvalou úschovu trasy.

Akce přidá stabilní referenci a souřadnici na konec současného draftu. Nevyžádá GPS, nespočítá automaticky cestu a nezmění režim, panel ani kameru. Existující spočtené úseky lze ponechat jen pokud odpovídají nezměněným koncům; nové zadání nesmí používat starý celkový čas/délku.

Potvrzení „Zastávka přidána“ nabídne Otevřít plán a Vrátit ve stávajícím systému oznámení. Otevřít plán je explicitní přechod. Vrátit odstraní právě přidanou zastávku podle ID, nikoli obnovou celé staré kopie dokumentu přes pozdější úpravy. Opakovaný klik během dokončování stejné operace nepřidá duplicitu; záměrné opětovné přidání místa později zůstane možné.

V Plánování zdůraznit současnou akci Přidat zastávku, v Discover Uložit místo. Pořadí a styl ostatních akcí nepřestavovat. Uložení plánu zůstává explicitní a odlišné od rozpracování draftu.

Ověření: přidat tři místa při Discover → otevřít plán; vrátit první akci po jiné úpravě; změna podkladu; reload prázdný draft; uložený výlet dostupný.

## UX-4 — Mobilní použitelnost současného rozvržení

Neprovádět migraci na jiný shell. Ověřit současné panely při 390×844 a 360×740, otevřené klávesnici a otočení zařízení. Přizpůsobit pouze dostupnou výšku a scroll podle visualViewport, safe areas a stávající velikosti panelu.

Dočasně otevřený panel vrstev dostane focus; obsah pod ním není omylem ovladatelný. Zavření vrátí focus a předchozí relaci, nikoli nový search. Přetažení úchytu panelu se nesmí zaměnit s posunem mapy; scroll obsahu zůstává normálním scrollem.

Primární dotykové ovladače mají hit area alespoň 44×44 CSS px, aniž by se zvětšovaly kreslené ikony nebo přesouvala tlačítka. Viditelný focus a krátké popisky u nejednoznačných akcí, zavírání stejným křížkem. Žádné nové barevné schéma. Respektovat reduced-motion.

## UX-5 — Proč tuto vrstvu vidím, nebo nevidím

Navázat na právě opravený společný stav. Přidat pouze chybějící významy: „Není vybrána kategorie“, „Výsledky omezuje filtr“, „Starší data“. „Skryto filtrem“ použít jen při důkazu z lokálního filtrování nebo metadata dotazu; samotná nula po serverovém filtru takový důkaz není.

V existujícím katalogu zachovat Vše/Zapnuté a poslední zvolený pohled. Hledání rozšířit přes názvy kategorií, témata, počasí a překryvy, nikoli jen seznam providerů. Každé výsledné nalezené ovládání vede ke skutečné existující vrstvě; nevytvářet druhý přepínač s vlastním stavem. Aktivní filtry ukázat jako krátké shrnutí; reset pouze dané vrstvy.

Předvolby zobrazí skutečně přidávaný obsah. Zachovat vlastní vrstvy a nabídnout vrácení pouze změn této aplikace presetu; pozdější ruční změny nepřepsat starým snapshotem. Žádný automatický podklad, zoom nebo režim.

Pořadí vykreslení: vybraný objekt a ovládací body → aktivní výsledek/trasa → ostatní obsah → podklad. Zachovat z11 clustering/z12 jednotlivé piny; novým auditem svévolně nevracet agresivní clustery. Souběhy řešit existujícím rozevřením, mapové priority bez načtení nové geometrie.

## UX-6 — Detail a AI podle rozhodnutí uživatele

Zachovat již upravený detail. V první části vedle jména/kategorie a médií zpřístupnit několik skutečně dostupných praktických údajů: restaurace otevírací dobu, parkování přístup a poplatek, památka vstup/provoz, kamera čas snímku. Neznámý údaj není odhad ani zamčená výplň panelu.

První souhrn zůstane krátký a zdrojově podložený. Rozbalitelný Detail odpovědi obsahuje delší AI vysvětlení; neskrývá galerii, zdrojová fakta a praktické informace. Zachovat pozici čtení při doplnění. Fakta, návštěvnická hlášení a doporučení rozlišovat přímými názvy a citacemi. Žádná obecná zelená značka ověřeno pro modelový text.

AI výsledky využijí existující mapovou vrstvu a karty: místa → seznam/body, cesta → návrh změny existujícího itineráře, statistika → existující dostupná série. Nepodporovaná operace nabídne vysvětlení, nikoli smyšlený výsledek. Potvrzení AI změny plánu ukáže konkrétní rozdíl; undo podle revize, bez tichého přepsání.

Jeden detail pro shodnou entitu využije existující slučování identit. Automaticky neslučovat pouze blízké souřadnice nebo stejný název; zdroje a jejich případná omezení zůstanou oddělené. Rozpočty, veřejnost a omezení Google/FSQ se novým UX neobcházejí.

## UX-7 — Srozumitelné uložení a sdílení

Používat konkrétní názvy Uložit místo / Uložit plán / Uložit nastavení mapy / Uložit přehled. U mapy popsat ukládané vrstvy, filtry a výřez jako nastavení, nikoli garantovanou kopii budoucích dat. Přehled je datovaný snapshot; aktualizace je samostatná akce.

Před sdílením uvést obsah, který příjemce dostane, a omezení přístupu. Neobcházet ACL ani ukládat proprietární dokumenty do veřejného balíčku. Pokročilé sdílení soukromé AI odpovědi zůstane mimo vydání. Existující uložená místa/plány/přehledy a jejich ID musí fungovat dál.

## Rozhraní a implementační hranice

- Rozšířit existující stav výsledkové relace a shell returnTo o klíč obsahu/scroll; nepřidávat nový navigation store.
- Viditelný popis kontextu odvodit od skutečného request/snapshot scope. Chybějící serverovou podporu scope doplnit do současného kontraktu AI/dat, ne jen vykreslit slibující štítek.
- Pro přírůstky trasy použít existující operace PlanDocumentV2 a revize.
- Doplnit stavy hledání a vrstvy additivně. Staré zdroje bez metadata filtrů nesmějí tvrdit důvod prázdného výsledku.
- Použít současný AI endpoint, renderer, galerie a oznámení. Žádný nový LLM klient, renderer ani komponentový framework.

## Pořadí, měření a dokončení

1. Dokončit a ověřit rozpracovaný balíček překryvů/stavů; předat pravdivý stav nasazení.
2. UX-1 + UX-2 + UX-3: kontext, hledání a přidání do plánu.
3. UX-4 + UX-5: mobilní průchody a katalog.
4. UX-6 + UX-7: obsah odpovědi, rozhodovací detail, uložení a sdílení.

Referenční úkol: najít místo v Praze/Tarragoně, vysvětlit rozsah výsledků, otevřít detail, přidat do trasy, vrátit se, uložit plán. Stejný desktop/mobil scénář před/po. Měřit kliknutí, ztracené kontexty, první použitelný výsledek a skutečné síťové požadavky. Neodvozovat použitelnost pouze z času automatického testu.

Pevné podmínky: bez samovolné změny režimu při přidání zastávky; návrat zachová výsledky/scroll; chyby hledání nejsou nula; žádná generace při návratu/hoveru; žádné překrytí potvrzovacího tlačítka klávesnicí; reset/undo nepoškodí pozdější práci; vzhled a pozice hlavních ploch se nezmění.

Použít existující testy a browser scénáře. Zvlášť ověřit pomalý internet, odmítnutou GPS, neaktivní AI, chybějící data, dvě stejně pojmenovaná místa, textový výběr a reduced-motion. Vydávat běžným VPS postupem po záloze, restore/compatibility a veřejném smoke. Bez screenshotového porovnání a úspěšných scénářů nenazývat audit implementovaným.
