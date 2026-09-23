# Ollama Cloud a kompaktní detail — 12. 9. 2026

Navazuje na `2026-09-12-overview-regions-completion.md`. Nejnovější výslovné rozhodnutí vlastníka nahrazuje předchozí čekání na doložení bezplatného Ollama tarifu: účet a jeho limity spravuje vlastník. Nejde o ověřenou bezplatnou alokaci a tak ji aplikace ani dokumentace neoznačuje.

## Implementováno

- Existující společný gateway a OpenAI-compatible Ollama transport zůstávají jediným modelovým mostem. Rychlý model GLM 5.3 Flash, silnější GLM 5.3, záložní DeepSeek v4 Flash; všechny profily lze změnit prostředím bez dalšího klienta. Produkční compose nyní předává i rychlý/silný model a oba fallbacky.
- `MAPOS_AI_BUDGET_MODE=provider` explicitně předává měsíční finanční limit Ollama účtu. Per-run omezení, povolené operace, souhlas, oddělení soukromých dat, timeouty a rušení zůstávají. Výchozí `allocation` režim zachovává persistentní rozpočty. V provider režimu se nevytvářejí fiktivní záznamy bezplatné alokace ani nezobrazují odhadované zůstatky; agregované běhy zaznamenává gateway, účtovanou spotřebu vede poskytovatel.
- Web search i fetch používají stejný existující Ollama klíč. Aktivace nezakládá rešerši při hoveru, posunu ani běžném otevření detailu. Otevření přehledu respektuje uživatelské nastavení AI a webu.
- Detail: Info / Fotky / Recenze / Panorama. Zachované údaje a registry zdrojů; informační záložka zůstává připojená, fotografie a komunitní obsah se připojí při první návštěvě, iframe pouze při otevření Panorama. Přepínání nevytváří druhou AI relaci.
- Kompaktní identita nahoře, původní fullscreen galerie ve Fotkách. Sousední piny se nepřepínají šipkami používanými formulářem, záložkami nebo dialogem. Změna identity místa resetuje obsah a záložku.
- Mapillary lookup vyhledává skutečný snímek do 200 m; embed obsahuje `image_key`, nikoli pouze polohu mapy. Známý zdrojový Mapillary identifikátor lookup nepotřebuje. Chybějící token, nepokryté okolí a chyba se zobrazují odděleně. Alternativou je explicitní odkaz na Google Street View pro souřadnici, nikoli neověřené vložené panorama.

## Živá ověření před vydáním

Existující klíč v kontejneru: katalog modelů HTTP 200, GLM text HTTP 200 (1 955 ms), Ollama web search HTTP 200 s oficiálním výsledkem Prague City Tourism. Vynucené odevzdání přes nástroj: GLM 5.3 Flash 1 085 ms / 225 tokenů; GLM 5.3 718 ms / 242 tokenů; DeepSeek v4 Flash 969 ms / 375 tokenů. Jde o tři malé syntetické sondy, nikoli benchmark plných odpovědí. Žádný klíč není v záznamu ani repozitáři.

Automatické AI/budget/panorama testy: 124 prošlo, 1 databázový test přeskočen bez vyhrazeného testovacího PostgreSQL. API a web typecheck prošly. Stav nasazení a veřejné kontrolní scénáře se doplní po vydání.

## Omezení a další postup

- Mapillary token na produkci chybí. Dokud nebude dodaný, nelze tvrdit dostupnost vyhledávání jeho snímků; známá image ID a externí odkazy fungují odděleně. Token `MAPILLARY_ACCESS_TOKEN` je nyní předávaný produkčnímu API.
- Google/Foursquare: nejnovější souhlas odstraňuje uživatelskou podmínku čekání na bezplatný tarif, nikoli potřebu funkčních API oprávnění ani odlišných providerových datových kontraktů. Tento balíček neprohlašuje jejich starší neaktivní integrace za dokončené.
- Souhrn využívá již implementovaný výběr zdrojově doložených vět. Nejde ještě o volnou syntézu rozporů ani plné veřejné sdílení soukromých podkladů.
- Recenze jsou skutečné komunitní komentáře MapOS. Foursquare Pro neposkytuje automaticky fotografie či Premium hodnocení.

Zdroje: [Ollama Cloud](https://docs.ollama.com/cloud), [web search/fetch](https://docs.ollama.com/capabilities/web-search), [Mapillary embed](https://help.mapillary.com/hc/en-us/articles/115001778705-How-to-embedding-a-Mapillary-capture-into-your-own-app).

### Dodatečné opravy z browser kontroly

Starší průvodce měl webový collector nezávislý na explicitním povolení modelu. Nyní běžný Discover neprovádí webové hledání ani s aktivním klíčem. V Tarragoně se také pro název čtvrti Eixample vracel článek o Barceloně; encyklopedický popis nyní vyžaduje ověřené QID, detail může navíc použít původní explicitní Wikipedia odkaz. Samotný název místa se za identitu článku nepovažuje. Regresní testy pokrývají oba případy.

Google Street View Embed byl ověřen existujícím klíčem a refererem produkčního MapOS. Server vrátil HTTP 403: **Maps Embed API není aktivováno v Google Cloud projektu**. Není to chyba Ollama ani limit MapOS. Pro skutečné vložené Google panorama je potřeba zapnout Maps Embed API a připravit browser key s omezením na toto API a doménu MapOS; současná verze nabízí funkční externí Street View odkaz. Klíč se testem nezveřejnil do aplikace.

### Transport a skutečný modelový přehled

Živý r9 smoke odhalil, že samotný úspěch jednoduchého modelového volání nestačil: oblastní přehled skončil bez textu kvůli limitu completion (ten zahrnuje i reasoning), zatímco POI syntéza proběhla. Web search/fetch vracely validní JSON s `Content-Type: text/html`, který společný transport správně odmítal podle staršího kontraktu.

Oprava: pouze Ollama web endpointy dostaly explicitní MIME výjimku při zachování JSON parseru, ochrany URL, cache izolace a byte limitu. U podporovaných cloud thinking modelů je nastavené `reasoning_effort=low` (konfigurovatelné). Interní completion envelope přehledu je 4 000 tokenů včetně reasoning; zobrazený souhrn má stále nejvýše 240 slov a běh deadline 25 s. Konzervativní rezervace dvou pokusů je 24 000 tokenů; provider-managed režim ji neprezentuje jako účtovanou skutečnou spotřebu.

Model vybírá krátká lokální evidence ID a případně index celé encyklopedické věty. Server obnoví původní identitu i přesný text, poté provede existující validaci. Model už neopisuje čísla ani dlouhé zdrojové klíče. Neznámý handle, cizí běh, soukromý dokument nebo krácení statistické věty jsou odmítnuté. Aktualizovaný úvod odstraňuje přesné duplikáty stejných zdrojových tvrzení v dalších sekcích.

Izolovaný skutečný cloud běh nové služby nad produkčními daty Prahy: vstup 2 767 tokenů, výstup včetně reasoning 174 tokenů, model 1 394 ms, celý serverový přehled 2 469 ms. Validovaná kompozice `model-assisted`; částečný stav pouze kvůli pravdivě omezenému pokrytí lokálního indexu. Jde o jeden serverový běh, nikoli p95 nebo klientské síťové měření.

### Ověření UI

Skutečný pin Olo (OpenStreetMap, Tarragona): během běžícího přehledu přepnuto Info → Fotky → Info. Přehled zůstal připojený, dokončil se v pozadí a návrat ukázal výsledek; v resource timing zůstal jediný overview požadavek. Přepínání záložek nevybralo sousední pin. Recenze zobrazují skutečný komunitní obsah, Panorama pravdivý stav chybějícího tokenu a odkazy. Mobil 390 × 844 / reduced-motion: scrollWidth 390, každá záložka 89,5 × 44 px. [Mobilní screenshot](../../output/playwright/cloud-detail-mobile.png). Celá matice médií a všech poskytovatelů tímto smoke není pokrytá; vybraná živá místa neměla schválené fotografie.

## Nasazeno a veřejně ověřeno

**Finální vydání `20260912-cloud-detail-r10`**, https://mapos.promptstudio3000.com, 12. 9. 2026. Záloha, obnova do dočasné databáze, dopředné migrace, kompatibilita předchozí aplikace a veřejné zdraví API/webu prošly. [Důkaz obnovy](../evidence/2026-09-12-cloud-detail/release-restore.txt). Lokálně 191 testů prošlo, 1 vyžadující samostatnou budget test DB přeskočen; API i web typecheck prošly.

Veřejné HTTPS měření z macOS/Node 22 během souběžné kontroly chatu a webového adaptéru (jednotlivé vzorky, nikoli p95):

| Scénář                                          |   První fakta |                Dokončení | Skutečný výsledek                                                                    |
| ----------------------------------------------- | ------------: | -----------------------: | ------------------------------------------------------------------------------------ |
| Praha — oblast, model zapnutý                   |        174 ms |                 4 113 ms | `model-assisted`, omezení pouze neúplný lokální POI index / širší statistická úroveň |
| B.B.Q. Ribs — POI + web                         |        188 ms |                 6 991 ms | `model-assisted`, complete, žádná chyba zdroje                                       |
| Chat: oficiální turistický web Prahy            |             — |                 3 057 ms | `model-tool-loop`, citovaný odkaz Prague City Tourism                                |
| Stejný produkční webový adaptér: search + fetch | search 790 ms | fetch samostatně neměřen | skutečný výsledek prague.eu, načteno a omezeno na 6 000 znaků                        |

[Veřejné přehledy](../evidence/2026-09-12-cloud-detail/live-overviews.json), [chat](../evidence/2026-09-12-cloud-detail/live-chat.json), [webový transport](../evidence/2026-09-12-cloud-detail/live-web.jsonl). R9 diagnostický neúspěch je uchovaný odděleně, nenahrazuje výsledek finální verze.

Browser finální API: Olo v Tarragoně — nová syntéza neopakuje název/kategorii ve druhé sekci. Dvě explicitní aktualizace odpovídají dvěma overview požadavkům; následné Fotky → Info počet nezvýšilo. [Finální desktop](../../output/playwright/cloud-detail-final-desktop.png). Přehledy běžného místa stále vědomě neproměňují neověřené webové kandidáty v doložená fakta; samostatný chat umí webové zdroje využít přes společné nástroje. Nejde o tvrzení dokončené volné syntézy celého původního AI backlogu.
