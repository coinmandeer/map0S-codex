# Aktivní implementace AI Overview V2 — 9. 9. 2026

## Aktualizace 12. 9. — oblastní odpovědi a statistiky

Aktuální pokračování a důkazy: [AI přehledy a regionální data](2026-09-12-overview-regions-completion.md). Tento záznam má přednost před staršími seznamy chyb níže. Nově jsou propojené LAU–NUTS identity (97 649 obcí / 31 zemí), regionální populace 65+ a HDP, členěný přehled s časnými mapovými referencemi, otázky o vybrané oblasti, volba územního rozlišení a opravený přenos průběžných odpovědí. Praha již dostává AROPE svého NUTS 2, nikoli náhradní údaj za celý stát.

Modelový kontrakt umožňuje validované zdrojové sekce; živá syntéza/web čekají na doloženou alokaci Ollama. Soukromé zdroje, libovolné správní crosswalky, automatická sousední srovnání a celá obecná webová rešerše se nepovažují za dokončené. Publikované věkové údaje znamenají první konkrétní řadu 65+, nikoli celou věkovou strukturu. Přesné nasazení, měření a omezení jsou v odkazovaném předání.

Schválené pořadí T12-P0 → P1 → P2 → P3 → P4 nahrazuje pořadí AI-1–3 níže. Výchozí vydání: `20260908-ai-answer-map-r2`. Pracovní strom obsahuje rozsáhlé předchozí změny; zachovány. Nasazený první balíček: `20260909-ai-overview-v2-r2`; celý plán ještě není dokončený.

- P0: implementované základní opravy targetu, veřejného source-only detailu, legacy briefu, relace mimo panel a Stop/EOF. Privátní POI a úplná revokační kontrola historie nejsou hotové.
- P1: implementovaný endpoint, sdílený běh, okamžité podklady, citace a společný renderer pro bod/POI/oblast. Modelový výběr je zatím konzervativní a extraktivní.
- P2: částečné — vlastní veřejné recenze, propojená Wikipedia, omezené webové kandidáty a přesné počty lokálního indexu. Chybí ověření identity obecných webových dokumentů, rozporů a připojení oficiálních statistik.
- P3: implementované PostgreSQL repository konverzací a vlastní uložené snapshoty; veřejné sdílení a úplná historie v UI zbývají.
- P4: první vydání ověřené — viz [měření, vydání a skutečný backlog](2026-09-09-ai-overview-v2-implementation.md). Bez doložené alokace nelze označit živý modelový profil za ověřený.

Generace pouze explicitním otevřením AI nebo otázkou. Hover/pan/zoom nevolají model. Současný detail nesmí automaticky spouštět výzkum. Google/FSQ nejsou automatické modelové podklady. Nové AI operace musí projít doloženou rozpočtovou alokací; bez ní zůstávají použitelná fakta.

## Předchozí vydání a historický audit

# AI odpovědi a jejich reprezentace v mapě — priorita 8.9.2026

Nové směřování uživatele přesouvá jádro T12 před další rozšiřování Global/Planet. Tento dokument doplňuje společný master plán; nenahrazuje jeho datové a rozpočtové podmínky. Stav níže je kontrola aktuálního kódu, nikoli nový živý test modelu nebo naměřená rychlost produkční AI.

## Implementace 8.9. — AI mapový výsledek

Stav kódu: implementováno a ověřeno níže; stav nasazení je veden zvlášť v implementation-status.

- Karty míst i návrhy vrstvy používají jednu dočasnou inline vrstvu, nejvýše 100 bodů. Nahrazení/schování odregistruje předchozí zdroj; uložené vrstvy zůstávají. Změna světa odstraní dočasný výsledek.
- Zobrazení nezapíná celé zdrojové vrstvy a nemění kameru. Samostatné přiblížení zahrne všechny body a skutečné odsazení panelů; výpočet podporuje i výsledky přes datovou hranici.
- Lokální obousměrný hover karty/pinu používá feature-state; žádný HTTP ani nový výpočet geometrie. Původní detailová reference se přenáší odděleně od neprůhledného AI ID.
- Dotaz nese bbox, svět a dostupnou referenci vybraného pinu. Oblast/revizi ověří server; OSM hledání a podporované query_layer dostávají kanonický polygon. Chybějící revize vrací 409 před streamem. Centrové regionální statistiky se při výběru oblasti nenabízejí, dokud nemají přesnou vazbu na její identitu.
- Odpověď označuje oblast/výřez a čas požadavku (nikoli platnost dat). Změna výřezu nabídne ruční obnovení; žádná automatická generace při pohybu.
- Gateway má odběratele sdíleného požadavku: první odpojení neukončí ostatní, poslední zastaví transport. Test ověřuje obě situace.

### Hranice tohoto vydání a další implementace

1. AI-1 není celý: společný serverový snapshot filtrů/času/revize plánu a permission partition, stabilní historie mimo životní cyklus panelu a zachování vybraného pinu při přepnutí panelu zbývají. Bbox přes datovou hranici není odeslán jako chybný obdélník; plné vícečástové dotazování ještě není implementované.
2. Výběr polygonu je implementovaný pro place search a podporované query_layer. Není tím slíbeno polygonové filtrování všech událostí, počasí či soukromých seznamů. Regionální statistika se nesmí nahradit číslem ze středu.
3. AI-2: společná evidence, časová platnost, coverage, revize cache a jednotné citace pro brief/guide/chat zbývají. Aktuálně se tlačítko mapových míst zpřístupní až s dokončenými citacemi.
4. AI-3: vyřešené odběratelské rušení gateway není záruka rušení všech ingest/fusion větví. Vlastník běhu panelu, persistentní finanční rozpočet a benchmark skutečného modelu zbývají. Žádný nový placený zdroj ani automatická generace nebyly aktivovány.
5. Browser kontrola používá deterministické SSE fixtures: měří funkčnost UI, nikoli kvalitu modelu nebo produkční cenu/TTFB.

## Výchozí audit před implementací (historický)

### Co již existovalo

- AiPanel, stream událostí/textu/karet a /v2/ai/chat; citace, další otázky, místa, fakta, návrhy vrstev a změn plánu.
- Gateway, modelové profily, validace, fronta, cache, sdílení běžících generací a oddělení privátních dat.
- Inline vrstva z nástrojem nalezených míst: validovaný V2 manifest, atribuce, limit200bodů, ruční zobrazení a uložení. Pro její vykreslení není potřeba další provider dotaz.
- Souhrn místa, průvodce a plánovací asistent. Jsou to existující cesty; nepřidávat druhý chat ani druhé mapové SDK.

## Konkrétní mezery ověřené v kódu

1. AiPanel posílá mapCenter, zoom, activeLayerIds, mode a případně planId. Neposílá přesný bbox, AreaSelection/revizi hranic, vybraný pin ani úplný aktuální filtr/čas/svět. Kontext dotazu není přesným snapshotem mapy.
2. Karta places v showOnMap zapíná celé zdrojové vrstvy a přibližuje první místo. Karta layer-draft zobrazuje přesný inline výběr, ale také přibližuje pouze první bod. Tyto dvě akce působí odlišně a první může spustit nepotřebné dotazy.
3. Inline vrstvy mají samostatná ID, mohou se hromadit a nemají společného vlastníka aktivní odpovědi. Při převodu inline feature se původní sourceId nepřenáší do mapových properties a layerId se nahradí ID AI vrstvy. Nutné doplnit původní feature/layer reference pro skutečný detail.
4. AiPanel drží odpovědi lokálně; běžící požadavek ruší explicitní Zastavit, ne zavření panelu. Je nutné určit vlastníka běhu mimo životní cyklus komponenty, aby se neztrácela konverzace ani nezůstávalo nepotřebné čekání. Neřešit naivním cleanup abortem, který rozbije StrictMode.
5. AiCitation má zdroj a retrievedAt, ale chybí jednotná evidence identita, revize, coverage, validAt a rozlišení měření/modelu/odhadu.
6. Gateway sdílí Promise identických běhů, ale druhý odběratel pouze čeká; rušení je vázané na signal prvního běhu. Chybí reference counting odběratelů pro bezpečné odpojení posledního zájemce.
7. Cache gateway zahrnuje retrievedAt. Pokud volající obnovuje tento čas při každém čtení stejných faktů, může zbytečně znemožnit cache hit; ověřit testem konkrétních volajících. Brief má vlastní týdenní TTL a kompozici podkladů. Není to jednotná cache podle revize evidence.
8. Textové/tokenové limity a fronta nejsou hotový persistentní finanční rozpočet T12 napojený na T07. Nepovažovat existenci gateway za dokončené řízení nákladů.
9. Některé cesty mají skutečné složené nástroje, jiná legacy nejbližší-POI cesta záměrně vrací unavailable pro ostatní nástroje. Existence položky v registru nedokazuje její dostupnost v každém typu odpovědi.

## Nejbližší implementační balíčky

### AI-1: přesná odpověď nad mapou

- Jednotný serverově ověřený MapAnswerScope: bbox, svět/režim, oblast/revize, reference pinu, aktivní filtry/čas a revize plánu; permission partition.
- Obě akce Zobrazit v mapě použijí jednu aktivní dočasnou vrstvu přesných referencí. Pro první vydání max100bodů. Předchozí odpověď zůstane v historii, její dočasné značky se nahradí. Uložené vrstvy se nemažou.
- Zobrazení vrstvy a přiblížení oddělit. Akce Přiblížit výsledky použije bbox všech bodů s rezervou pro skutečný panel; jediné místo má omezený cílový zoom.
- Hover karty zvýrazní existující pin, hover pinu zvýrazní kartu. Bez HTTP a bez přegenerování geometrie. Detail resolvuje původní layerId/featureId.
- Kontextový štítek odpovědi ukazuje oblast/okolí a čas. Po posunu nabídne Obnovit pro tento výřez; nic negeneruje automaticky.
- Test: přesně3nalezená místa =3mapové výsledky bez zapnutí celých zdrojů; 20přepnutí odpovědí nehromadí zdroje/listenery; správný původní detail a fit všech bodů.

### AI-2: společná fakta a rychlá odezva

- Rozšířit AiSourceBlock/AiCitation podle T12 o stabilní evidence ID, revizi, původ, čas, metodu a coverage. Server je autorita; klient nemůže důkaz podvrhnout.
- Detail, guide a chat sdílejí získání stejných faktů. Fakta a mapové výsledky mohou být použitelné před dokončením souhrnu.
- Odpověď: krátký text, konkrétní výsledky, zdroje/platnost a1–3akce. Stejný renderer stavů a citací v detailu i panelu.
- Výpočty vzdáleností/počtů/statistik dělají nástroje. Model vysvětluje výsledky; nedoplňuje chybějící geometrii ani pokrytí.
- Nejprve místní/již načtená evidence, další zdroje cíleně podle dotazu. Hover/pan/zoom ani nové vrstvy nespouštějí generaci.

### AI-3: provoz a optimalizace

- Sdílené generace s odběrateli; odpojení posledního zruší transport, stará odpověď nesmí nahradit nový scope. Stav běhu oddělit od mount/unmount panelu.
- Cache podle skutečných revizí a oprávnění, nikoli pohyblivého času čtení; audit legacy brief cache. Stejný dotaz nad stejnými daty se znovu neplatí.
- Připojit existující T07 rozpočty, limity kontextu a nástrojů podle T12. Bez souhlasené alokace nevytvářet nové externí placené běhy ani placené provider obohacení.
- Měřit zvlášť čas prvních použitelných faktů/bodů, dokončení textu, zdrojové dotazy, vstupní/výstupní tokeny, cache hit a zrušené běhy. Dosavadní čísla webových testů nejsou benchmark AI.
- Kontrolní otázky: zajímavosti v Tarragoně; místa v přesně vybrané oblasti; srovnání ovzduší s časem/modelovým pokrytím; zastávka při skutečné trase; vysvětlení právě zobrazené globální vrstvy.

Po těchto balíčcích rozšířit AI na Global/Planet a hru přes stejnou evidenci a nástroje. Na data pohybu nebo orbitální výpočet čekají jen dotazy, které je skutečně potřebují.

## Zpřesnění dalšího balíčku po kontrole volajících

- Sdílené rušení tohoto vydání platí pro `AiGateway.run` (např. existující krátké souhrny přes `askCml`). Chatový nástrojový cyklus používá `AiGateway.turn`; ten drží vlastní timeout/frontu a není tímto vydáním deduplikovaný. Při sjednocení nutně zahrnout historii, nástroje, toolChoice, oprávnění a konverzační revizi; nelze sdílet běhy pouze podle poslední otázky.
- `getPlaceBrief` již volá `askCml`, který prochází stejnou gateway. Jeho skutečný klíč zahrnuje obsah promptu přes source block, takže samotné počty okolních míst/faktů v legacy cacheKey nejsou důkazem kolize odpovědí. Duplicita je zejména v získávání faktů: neighbours, Wikipedia, reverse geocoding, Wikidata a web se skládají před dotazem na gateway cache.
- AI-2 začít sdíleným poskytovatelem faktů pro stabilní identitu místa/oblasti. Klíč: identita, jazyk, zdrojová revize/platnost a oprávnění. Cache odpovědi není náhradou cache získání faktů. Neodstraňovat retrievedAt z obecného klíče bez zavedení validAt/revize a testu změněného obsahu.
- První měření: dvě otevření stejného místa, následná otázka na totéž místo a změna revize jednoho zdroje. Samostatně počítat získání faktů, generace, cache hity a čas prvního použitelného obsahu. Neprovádět měření proti placenému modelu bez aktivované doložené alokace.

### Konkrétní napojení zbývajícího snapshotu

- V AiPanel číst `MapStore.activeLayers[layerId].filters` jednotlivě, nikoli sloučit všechny filtry do jednoho objektu. Server povolí pouze klíče/hodnoty daného manifestu a vrstvy dostupné účtu. Do kontextu nevkládat privátní volný text z filtrů bez odpovídajícího souhlasu.
- Čas převzít z `MapStore.temporal` (`cursor`, `mode`, rozsah a časová zóna); rozlišit požadovaný čas, skutečnou platnost získaných dat a čas položení otázky. Nepřeznačovat nejnovější měření na historický požadovaný čas.
- Revizi plánu číst z `activePlanDocument`, ale před nabídkou změny znovu načíst dokument pod vlastníkem na serveru. Mezitím změněný plán má vrátit nový náhled, nikoli aplikovat staré indexy zastávek.
- Kontextový fingerprint rozšířit o ověřené filtry/čas/revize. Historická odpověď si ponechá svůj snapshot; ruční Obnovit vytvoří nový běh. Běžný pohyb kamery ani přehrávání času nevolá model.

## Aktualizace 12. 9. 2026 — Ollama Cloud a záložky detailu

Nasazeno `20260912-cloud-detail-r10`. Ollama GLM 5.3 Flash / GLM 5.3 a společné web search/fetch jsou aktivní a živě ověřené. Vlastník výslovně převzal správu tarifu; starší podmínka doložení bezplatné Ollama alokace je nahrazená provider-managed konfigurací. Detail nyní používá Info / Fotky / Recenze / Panorama; odstraněna automatická webová rešerše běžného Discover a neověřené zaměňování stejně pojmenovaných čtvrtí. 191 regresních testů prošlo, obnova 90 tabulek ověřena. Podrobný stav, měření a konkrétní nedokončené části: [Cloud a detail](2026-09-12-cloud-detail-tabs.md).

Google panorama: živý test klíče vrátil 403 — Maps Embed API není zapnuté v projektu. Mapillary vyhledávání potřebuje token. Tyto funkce nejsou označené jako aktivované; zatím jsou dostupné přímé odkazy v záložce Panorama. Volná syntéza neověřených webových kandidátů, celý kontext filtrů/času obecného chatu a širší původní backlog zůstávají samostatné úkoly.
