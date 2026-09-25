# MapOS — AI odpovědi a Global/Planet: závazné rozšíření T00–T11

Aktualizace priority8.9.: jádro T12 se na přání uživatele přesouvá před další Global/Planet. Platí [konkrétní audit a balíčky AI-1 až AI-3](2026-09-08-ai-map-priority.md); původní pořadí „AI jako poslední“ níže je tím upraveno.

Stav původního dokumentu: implementační návrh, 2026-09-07. Rozšiřuje schválený plán, nenahrazuje dokončení rozpracovaného jádra. AI UI se integruje jako poslední; společná metadata se připraví dříve, aby nebylo potřeba přepisovat adaptéry.

Společný backlog: [T00–T14, pořadí a podmínky vydání](2026-09-07-master-plan.md).

Navazující audit: [Velocity — konkrétní zdroje, kód a limity](../research/2026-09-07-velocity-audit.md).
Průběh implementace: [stav T00–T14](2026-09-07-implementation-status.md).

## Co MapOS již má a musí znovu použít

- `apps/api/src/services/ai/contracts.ts`: AiCitation, AiSourceBlock, data classes, model profiles, cancellation, outcome/usage metadata.
- `gateway.ts`, `runtime.ts`, `modelRuntime.ts`, `adapters.ts`: profil/transport, omezení souběhu, validace, cache, modelové adaptéry. Žádný druhý klient LLM nebo jiná databáze AI konverzací.
- `toolRegistry.ts`, `toolCatalog.ts`, `chatTools.ts`, `layerCatalog.ts`: nástroje a povolení. Nové čtení vrstev přidávat zde.
- `conversation.ts`, `chatService.ts`, `orchestrator.ts`: kontext a revize konverzace, deterministické odpovědi a tool loop.
- `planDiscussionService.ts`, `planProposal.ts`, `planEditor.ts`: návrhy změn výletu a jejich aplikace. Chat nesmí obejít existující edit/revision logiku.
- `inlineLayer.ts`: mapová reprezentace výsledků. Rozšířit její evidence binding; nový „AI map engine“ nevytvářet.
- `briefService.ts`, `PlaceAiBrief`, guide synthesis a region digest: přesunout společné získávání evidence do sdílené služby, nikoli souběžně volat wiki/photos/POI pro každý typ odpovědi.
- `AiPanel` a současná detailová sekce: jednotné místo pro konverzaci a krátké odpovědi. Nevytvářet další chat přes mapu.

## T12 — Jedna vrstva AI odpovědí pro celé MapOS

### 12.1 Rozsahy a užitečné vstupy

| Rozsah             | Příklady                                   | Evidenční podklad                                                                     | Akce výsledku                                          |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Místo              | Co tu je? Co je na místě zajímavé?         | Aktuální detail, povolená wiki fakta, fotografie s popiskem, původní zdroje           | Otevřít citovaný údaj/médium, uložit místo             |
| Oblast             | Shrň tento kraj. Co zde chybí v datech?    | AreaSelection + revize, existující stats a coverage, bounded POI souhrn               | Vybrat metriku, zvýraznit ověřené výsledky             |
| Okolí / viewport   | Kavárna poblíž trasy, zajímavosti v okolí  | Skutečný bbox, aktivní filtry, lokální index a limity zdrojů                          | Jedna dočasná výsledková vrstva                        |
| Počasí / prostředí | Kde je menší znečištění? Co znamená barva? | Konkrétní model/čas, hodnoty a jednotky, nejistota a coverage                         | Nastavit existující vrstvu/čas přes kontrolovanou akci |
| Plán               | Zastávka po cestě, porovnání variant       | PlanDocument revision, skutečná route geometry, časy, otevřené POI                    | Návrh změny, aplikovat až explicitním tlačítkem        |
| Statistiky         | Porovnej tyto oblasti                      | Stejná série, období, jmenovatel a kompatibilní úroveň                                | Tabulka + existující choropleth                        |
| Global             | Co se změnilo v provozu v této oblasti?    | Pozorované polohy, interval, pokrytí a věk dat, ne predikované render pozice          | Čas, výběr objektu, skutečně uložená historie          |
| Planet             | Kdy bude vidět ISS? Co právě zobrazuji?    | Orbitální elementy/epochy, deterministický výpočet, poloha pozorovatele dle oprávnění | Vybrat objekt/čas; vysvětlit výpočet                   |
| Hra                | Jak ovládat hru? Co mohu splnit poblíž?    | Pravidla a veřejné dostupné questy, GPS/practice režim                                | Otevřít quest, nabídnout nápovědu bez změny odměn      |

Vyhledání nejbližšího místa, součet počtů, medián, srovnání statistik a výpočet dráhy jsou deterministické nástroje. Model může vysvětlit výsledek, nesmí čísla počítat odhadem nebo si doplňovat chybějící geometrii.

### 12.2 Společný evidence snapshot

Additivně rozšířit současné AiSourceBlock/AiCitation o volitelná metadata; zachovat starší volající:

- `evidenceId`, provider/source ID, původní feature/area ID a revize;
- `observedAt`, `receivedAt`, `validAt`/interval, `boundaryRevision`;
- bbox/scope, jednotka, metoda `observed/modelled/aggregated/reported/predicted`;
- coverage `complete/partial/none/unknown`, počet načtených výsledků a známý skutečný total odděleně;
- `dataClass`, atribuce a konkrétní oprávnění použít zdroj pro externí AI;
- odkazy jen ze zdrojového registru, nikoli volné URL vygenerované modelem.

Evidence snapshot vytváří server z autorizovaných dat. Klient smí poslat identifikátory/scope a výslovný dotaz, ale nemůže sám označit cizí data za veřejná nebo prokázaná. Pokud klient posílá text, zůstává nedůvěryhodným vstupem.

Zdrojový HTML, wiki text, komentáře a názvy POI jsou data, nikdy systémové instrukce. Nástroje mají allowlist názvů, validované argumenty a oddělená oprávnění. Modelu neposílat API klíče, session tokeny, SQL ani raw URL s autentizací.

### 12.3 Tok odpovědi

1. Uživatel otevře stávající AI panel, klikne na shrnutí nebo zadá dotaz. Hover, zoom, posun a zapnutí datové vrstvy samy nespouštějí LLM.
2. Server odvodí scope a revizi z výběru/konverzace. Pokud chybí důležitý údaj, vrátí konkrétní upřesnění; automaticky nezvětší hledání na celý svět.
3. Vyhledá existující evidence snapshot a běžící identický požadavek. Otevřený detail, guide a AI souhrn sdílejí stejné získání veřejných faktů.
4. Deterministické nástroje připraví fakta, dostupnost a malé tabulky. Ty lze ukázat ihned i bez modelu.
5. Povolený model obdrží omezené zdroje a formát výstupu. Neprovádí vlastní skryté volání Google/Foursquare.
6. Výstup validovat: pouze existující evidence IDs, známé akce a skutečné feature refs. Neplatný výsledek neopravovat nekonečným dalším voláním; maximálně jeden opravný pokus ve stejném rozpočtu.
7. Odpověď zobrazit s citacemi, časem a viditelnými mezerami v datech. Částečná evidence nesmí vyústit v tvrzení o úplném pokrytí.
8. Mapová akce je nabídka. Aplikace nesmí sama přepnout svět, zapnout placený zdroj, přepsat trasu nebo uložit/publikovat obsah.
9. Změna scope/oblasti/detailu zruší nepotřebné čekání. Starý výsledek může zůstat v historii původní konverzace, ale nesmí přepsat nový panel ani novou mapovou vrstvu.

### 12.4 Výstupní kontrakt

Rozšířit existující AiRunOutcome a inline-layer envelope o strukturovanou odpověď:

- `answerId`, `runId`, conversation revision, scope + scopeRevision, generatedAt;
- krátký text a claims `{text, evidenceIds, kind: fact|inference|recommendation}`;
- citace, datové období, coverage notices a chybějící zdroje;
- volitelné malé tabulky a `featureRefs`;
- actions z allowlistu: `select-feature`, `fit-area`, `set-layer-filter`, `set-time`, `propose-plan-change`, `open-source`;
- status `ready/partial/unavailable/cancelled/budget-exhausted` plus současná usage/model/cache metadata.

Výstup neobsahuje spustitelný JavaScript, libovolný HTML, SQL nebo renderer expression od modelu. Souřadnice mapových výsledků se resolvují ze schválených featureRefs, nikoli z odhadnutých čísel modelu. Schemata mají limity délky a počtu prvků.

### 12.5 UI odpovědí a jejich mapová vrstva

- Krátké odpovědi v detailu pod fakty, dlouhé ve stávajícím AiPanelu. Stejná render komponenta citations/status/actions.
- Odpověď má shrnutí, zdroje, platnost a 1–3 relevantní akce. Technický model/run/cost detail až v rozbalení.
- Při generování krátké konkrétní stavy „Čtu data oblasti“, „Porovnávám hodnoty“, „Připravuji souhrn“. Žádné vymyšlené interní uvažování ani falešná procenta.
- AI výsledky dočasně vykreslí existující inlineLayer. Maximálně jedna aktivní odpověď a 100 referencovaných míst; předchozí odpovědi zůstanou v konverzaci.
- AI výběr má vlastní srozumitelnou barvu/obrys, ale zachová kategoriální ikony. Není druhou kopii všech zapnutých POI.
- Ovládání „Zobrazit na mapě“, „Skrýt výsledky“, „Obnovit pro tuto oblast“. Posun nepouští nové generování.
- Na hover této vrstvy se zobrazí stejný lokální PinPreview. Žádné další LLM nebo placené API.
- Mobil: stávající bottom sheet/panel, klávesnice neovládá herního avatara. Odpověď nesmí zakrýt všechny mapové akce.
- Chybějící model: fakta, tabulka a citace zůstávají použitelné; text „AI souhrn není dostupný“ bez rozbití detailu.

### 12.6 Cache, oprávnění a náklady

- Cache klíč: task/template/schema/model profile + jazyk + normalizovaný dotaz + scope + revize všech evidence + permissionPartition. Nesdílet soukromou odpověď mezi účty.
- Výchozí TTL: place/region 1 h, neměnná statistická edice 24 h, počasí do další platnosti modelového snapshotu (max15 min), živý provoz max15 s. Expirace zdrojů má vždy přednost před těmito stropy.
- Před výpočtem dedup stejného běžícího požadavku. Zavření jednoho zájemce neruší ostatní; poslední odpojení zruší transport.
- Rozšířit T07 budget service o modelové tokeny/operace; nedělat druhé účtování. Výchozí externí AI rozpočet 0, dokud není potvrzená alokace účtu. Existující lokální profil lze využít v nastavených limitech.
- Max2 souběžné generace globálně, max1 na uživatele, fronta8, nejvýše4 tool rounds / 8 tool calls, max20 evidence bloků po4 000 znacích a souhrnný kontext8 000 tokenů, max1 200 výstupních tokenů, timeout30s.
- Rezervovat horní mez použití před voláním, po známé usage vyrovnat. Neznámý výsledek nebo timeout ponechá konzervativní rezervaci, nevyvolá automatický placený fallback.
- Zdrojové volání nástroje musí projít také rozpočtem poskytovatele. AI nesmí rozšiřovat field mask nebo Pro dotaz změnit na Premium.
- Google/Foursquare omezení jsou přenesena do evidence. Neodesílat proprietární recenze, fotografie či jiné nepovolené hodnoty do externího modelu a neukládat jejich odvozenou kopii do otevřeného indexu.
- Preference pro přesnou polohu a soukromé poznámky se uplatní před vytvořením promptu, nejen skrytím v UI. Citace nesmí prozradit cizí soukromý feature ID.

### 12.7 Nástroje rozšiřují současný tool registry

- `summarize_place`: resolvery existujícího detailu, žádná paralelní enrichment pipeline.
- `summarize_area`: area ID/revision + lokální agregace a coverage.
- `compare_statistics`: deterministická kompatibilita metrik, období a jmenovatelů.
- `query_environment`: současné weather/numeric grid služby s datovým časem.
- `query_motion`: T13 latest snapshot s časem a coverage; model nikdy neodebírá celý firehose.
- `query_track_history`: pouze skutečně archivovaný interval, ACL a limit.
- `explain_orbit`: výsledek orbitálního výpočtu; model nedělá fyziku sám.
- `propose_plan_change`: současný návrhový kontrakt, revize a explicitní aplikace.
- `explain_game_rules`: veřejná pravidla a oprávněné questy. Nesmí odhalit skryté odpovědi, seed odměn ani měnit herní stav.

Názvy sjednotit se stávajícími ekvivalenty, pokud existují; nevytvářet dva nástroje se stejným chováním pod jinými jmény.

### 12.8 Testy a akceptace

- Place detail + AI + guide vyvolají jediné sdílené získání týchž veřejných faktů.
- Žádné AI requesty na hover, pan, zoom nebo anonymní start bez požadavku.
- Falešná citace, neznámé feature ID, modelový HTML/script/SQL a nepovolená akce jsou odmítnuty.
- Prompt injection v názvu POI, wiki textu nebo komentáři nemění nástroje/oprávnění.
- AI neopírá místní číslo o státní statistiku bez označení úrovně; neuvede nulové pozorování jako absenci druhů.
- Stará poloha lodi není prezentována jako živá a krátká predikce není důkaz skutečného pohybu.
- Google/Foursquare se nezavolá bez explicitní provider akce; překročený limit nezpůsobí automatický přechod na placený SKU.
- Změna oblasti, účtu, konverzační revize, trasy nebo zdrojové edice zneplatní příslušnou cache.
- Cancellation, souběžní odběratelé, retry, timeout a restart zachovají rozpočet.
- AI panel bez modelu funguje jako čtečka skutečných faktů; mapa zůstává ovladatelná.
- Přidat evals pro Praha/Tarragona/pobřeží, nedostupné statistiky, rozpor zdrojů, změnu času, GPS/practice a omezené pokrytí live feedu. Výsledky uvádět jako naměřené až po spuštění.

## Pořadí celku

1. T00–T06: dokončit existující mapu, načítání, data a UX.
2. T07–T09: společné rozpočty a bezpečné volitelné integrace.
3. T10–T11: herní základ a vybrané datové zdroje.
4. T13: veřejný motion runtime nejprve na MapLibre; Digitraffic + rozpočtově omezený OpenSky pilot.
5. T14: izolovaný lazy Planet pilot se satelity.
6. T12 UI/orchestrace: jednotná AI vrstva jako poslední. Metadata, evidence IDs a příslušná oprávnění připravovat additivně už v T01/T05/T07/T13, ale nespouštět dříve nové generace.

Každou etapu lze vydat za vlastním feature flagem. První otestované opravy MapOS nečekají na glóbus nebo aktivaci AI účtu. Stav dokončení zůstává po úkolech a po datech; nový plán není důkaz implementace.

## Implementační krok 8.9.2026 — vstupní Global

První funkční Global je samostatný preset nad stávajícím MapLibre: EONET/USGS, světový výřez, vlastní vrstvy, návrat kamery a oblasti. Nespouští motion, glóbus ani novou AI. Tento malý vstupní krok T13/T14 nepovažovat za dokončený Planet. Další práce: ohraničené timestampované motion snapshoty a ověřený zdroj, potom izolovaná lazy orbitální scéna. MapLibre5.24 podporuje globe projekci, kterou lze technicky porovnat s Cesiem v pilotu; automaticky nepřepínat současný herní Three renderer bez ověření souřadnic, výšek a lifecycle. AI pokračuje přes T12 a stejné evidence/source IDs; nevytvářet druhou odpovědní vrstvu pro Global.
