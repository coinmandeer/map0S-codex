# MapOS: audit výkonu, rozšíření dat a implementační plán

## 1. Závěr auditu a směr aplikace

**Tvoje podezření má oporu v implementaci. Největší problém není nedostatek lazy loadingu, ale opakovaná práce, čekání na celé skupiny zdrojů a neúplné řízení načítání jednotlivých vrstev.** Přidávání dalších vrstev bez opravy těchto mechanismů by současné problémy zesílilo.

MapOS má použitelný základ pro univerzální mapový nástroj: registry vrstev, adaptéry, vlastní data, plánování, průvodce i herní rozhraní. Jeho další vývoj bych postavil na této jednoduché posloupnosti:

**Vybrat data → rychle je zobrazit → filtrovat a porovnat → otevřít detail → použít výsledek v plánu, průzkumu nebo hře.**

Počet vrstev má význam, pokud každá přináší použitelnou informaci. Uživatel musí poznat, co vrstva obsahuje, kde má pokrytí, jak jsou data stará a zda mapa ukazuje úplné výsledky.

Plán vychází z tvých rozhodnutí:

- Hlavním produktem je **univerzální mapový nástroj**.
- Provoz zatím **osobní a nekomerční**.
- Infrastruktura: **stávající VPS a levné objektové úložiště/CDN**.
- Po pohybu mapy: **automatická obnova lehkých vrstev a spolehlivé „Hledat zde“ pro náročnější dotazy**.
- Hra: nejprve praktické questy, později rozsáhlejší 3D/Aavegotchi.
- Zachovat současný vizuální směr, opravit konkrétní UX problémy.

Audit zahrnul současný pracovní strom včetně necommitnutých změn, předchozí roadmapu, produkční sestavení webu, 71 cílených testů a kontrolu rozhraní v prohlížeči. Sestavení i tyto testy prošly. **Nejde o měření výkonu nasazené aplikace:** přesnou příčinu celé spotřeby RAM a tříminutového čekání bude nutné doplnit profilováním. Několik konkrétních závad se ale podařilo přímo reprodukovat.

### Co je skutečně špatně

| Oblast                    | Zjištění v současné implementaci                                                                                                         | Důsledek                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Aktualizace mapy          | Pro dvě úspěšně načtené bodové vrstvy jsem reprodukoval **pět zápisů dat do mapy**. Vrstva zapisuje sama a následně znovu engine.        | Zbytečné kopírování dat, práce workerů a překreslování.                          |
| Více vrstev               | Dokončení jedné bodové vrstvy znovu aktualizuje další již načtené bodové vrstvy.                                                         | Náklady rostou výrazně rychleji než počet vrstev.                                |
| Zastaralé odpovědi        | Některé vrstvy zapisují data ještě před kontrolou, zda odpověď stále patří aktuálnímu výřezu.                                            | Stará odpověď může přepsat novější mapu.                                         |
| Změny nastavení           | Změna průhlednosti nebo jednoho filtru může vyvolat obnovu všech vrstev.                                                                 | Síťová práce vzniká i při čistě vizuální změně.                                  |
| Cyklovrstvy a jiné rastry | Připojení dlaždicové vrstvy může čekat ve stejné frontě jako pomalé POI dotazy.                                                          | Jednoduché zapnutí overlaye působí pomalu, přestože nepotřebuje čekat na POI.    |
| OSM                       | Server čeká na doplnění až 48 buněk; jednotlivé dotazy mají dlouhé timeouty. Výběr buněk může pokrýt jen část výřezu.                    | Čekání na kompletní odpověď a nerovnoměrné pokrytí mapy.                         |
| „Hledat zde“              | Poslední načtený výřez a stav obnovy jsou částečně společné pro více vrstev.                                                             | Úspěch jedné vrstvy může skrýt potřebu obnovit ostatní.                          |
| Limity pinů               | Limit 100 bodů se uplatňuje až po dražším zpracování. Informace o ořezu se cestou ke klientovi ztrácí.                                   | Server pracuje zbytečně a mapa může vypadat úplně, přestože zobrazuje jen výběr. |
| Cache                     | Některé cache mají limit počtu položek, nikoli jejich velikosti. Sdílená cache dlaždic sama nevyhodnocuje expiraci.                      | Velké položky mohou spotřebovat neúměrnou paměť; hrozí zastarávání dat.          |
| Discover                  | Katalog má pevný limit **16 oblastí**, rozdílná pravidla zoomu a hranice se vracejí spolu s průvodcem a statistikami.                    | Chybějící zóny a interaktivita závislá na pomalém obsahu.                        |
| Hover Discover            | Listenery jsou přidávány uvnitř obnovy stylu, přestože komentář tvrdí opak.                                                              | Při přepínání podkladů se může násobit obsluha pohybu myši.                      |
| Počasí                    | Pro zvolenou hodinu server stahuje vícedenní hodinové řady pro celou mřížku a většinu hodnot zahodí.                                     | Velký zbytečný přenos mezi poskytovatelem a serverem.                            |
| Clustery                  | Běžné POI se clusterují jen do zoomu 5; klikací rozbalování clusteru chybí.                                                              | Ve městech překryvy, na malém zoomu nefunkční čísla clusterů.                    |
| Trasy                     | Geometrie trasy se znovu posílá do mapy při nesouvisejících změnách globálního stavu.                                                    | Další zbytečná práce při interakcích.                                            |
| Spojnice v plánovači      | V draweru se současně kreslí stará čára přes celý seznam a nové spojnice jednotlivých úseků. Kolečko má průhledné pozadí.                | Čára prosvítá přes čísla a vlajku.                                               |
| Import zdrojů             | Dokumentace slibuje více protokolů, než skutečně obsahuje registr adaptérů. FeatureServer se v běžné cestě importované vrstvy nezobrazí. | Některé „podporované“ integrace nejsou dokončené.                                |

Hlavní místa pro implementátora: [LayerEngine](/Users/coinmandeer/Downloads/map0S-v0.1/apps/web/src/engine/LayerEngine.ts:208), [serverové načítání vrstev](/Users/coinmandeer/Downloads/map0S-v0.1/apps/api/src/services/layerService.ts:61), [Discover](/Users/coinmandeer/Downloads/map0S-v0.1/apps/api/src/services/discoverService.ts:307), [počasí](/Users/coinmandeer/Downloads/map0S-v0.1/apps/api/src/services/weatherGridService.ts:177), [mapové interakce](/Users/coinmandeer/Downloads/map0S-v0.1/apps/web/src/map/MapCore.tsx:729) a [stará spojnice](/Users/coinmandeer/Downloads/map0S-v0.1/apps/web/src/styles/panels.css:1207).

### Co už existuje a nemá se implementovat podruhé

- Detail pinu již otevře lokální náhled a následně načítá podrobnosti.
- Větší panely i herní vrstva již používají oddělené načítání kódu.
- Drawer již obsahuje některé ikony, barvy a manifestové filtry. Chybí především shoda se skutečnými piny a lepší dostupnost filtrů.
- Existuje import geografických jednotek a serverové vektorové dlaždice tematických statistik.
- Existují základy AI nástrojů, generovaných vrstev a návrhů změn plánu.
- Mapové pořadí hlavní trasy, koleček a čísel bylo při kontrole správné. Potvrzený problém se spojnicí je v draweru.

Produkční hlavní JavaScript má přibližně **586 kB po gzip**, samostatný herní balík přibližně **250 kB po gzip**. Má smysl dále zmenšovat závislosti, ale samotné rozdělení balíků neodstraní výše uvedené opakované načítání.

---

## 2. Technický plán

### A. Jedno řízení načítání a jeden zápis do mapy

Zavést jasné oddělení:

**Datový adaptér načte výsledek → engine ověří jeho platnost → renderer zobrazí přijatou změnu.**

Implementace:

1. U vestavěných datových vrstev odstranit zápis do MapLibre z načítací části. Přijatou kolekci zapisuje engine právě jednou.
2. Každá vrstva má vlastní revizi dotazu, identitu aktuálního požadavku a informaci o pokrytí.
3. Odpověď pro starý výřez, starý filtr, vypnutou vrstvu nebo zrušenou mapovou instanci se nesmí vykreslit.
4. Přepočet vlastnictví a deduplikace pinů aktualizuje jen kolekce, kterých se změna týká.
5. Oddělit změny vzhledu, filtrů a viditelnosti:
   - průhlednost/barva: pouze změna stylu;
   - filtr: dotaz nebo lokální filtr konkrétní vrstvy;
   - zapnutí: připojení konkrétní vrstvy;
   - vypnutí: zrušení její práce a uvolnění prostředků.
6. Dlaždicové vrstvy připojovat okamžitě po připravení stylu. Jejich přenos řídí MapLibre, ne fronta POI.
7. Frontu datových dotazů ponechat omezenou; výchozí souběh čtyři, dále respektovat limity jednotlivých poskytovatelů.
8. Detail otevřeného pinu má vyšší prioritu než obnovování neaktivního panelu nebo přednačítání.
9. Obsluhu hoveru registrovat jednou a při zániku mapy odregistrovat.
10. Změnu geometrie trasy sledovat podle její revize; zvýraznění úseku řešit změnou stavu prvku.

Stávající veřejné manifesty zachovat. Novou načítací cestu doplnit kompatibilně a vestavěné vrstvy na ni převést; nepřepisovat celý pluginový systém.

### B. Přehledová data pinů oddělit od detailů

Mapové odpovědi mají obsahovat pouze údaje potřebné k vykreslení a aktuálním filtrům.

| Datová úroveň | Obsah                                                                                                              | Kdy se načítá                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Přehled       | Stabilní ID, poloha, název, kategorie, styl, zdrojová reference, nezbytné filtrovací atributy, informace o médiích | Pro aktuální výřez                       |
| Detail        | Popis, kontakty, otevírací doba, přístupnost, zdroje, přesná geometrie, seznam médií                               | Po otevření pinu                         |
| Médium        | Náhled, zobrazovací varianta, originál, rozměry, autor a licence                                                   | Náhled v kartě; větší varianta v galerii |
| Historie      | Časové řady, starší pozorování, komentáře                                                                          | Až po otevření příslušné sekce           |

Konkrétní změny:

- Neposílat celé OSM tagy a libovolné providerové objekty do každého mapového prvku.
- Zavést kanonická ID rozlišující například `osm:node:123`, `osm:way:123` a `osm:relation:123`.
- Staré reference zachovat přes kompatibilní resolver; nepřerušit uložená místa a plány.
- Detail cacheovat podle identity místa a revize zdroje.
- Seznam sousedních pinů stabilizovat při otevření detailu, aby se při každém posunu mapy celý znovu netřídil.
- Dlouhé trasy zobrazovat zjednodušeně podle zoomu; úplnou geometrii načíst pro detail nebo export.
- Stávající limit 100 výsledků zachovat jako limit jedné stránkované odpovědi, **ne jako náhradu úplného mapového přehledu**.
- Pro velká území používat agregace nebo vektorové dlaždice. Počet clusteru nesmí být prezentován jako celkový počet míst, pokud vznikl jen z oříznutého vzorku.

Zmenšování atributů, geometrie, clustering a vektorové dlaždice odpovídají i doporučenému postupu MapLibre. [Dokumentace výkonu MapLibre](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)

### C. „Hledat zde“ a pohyb mapy

Tlačítko bude společné pro mapu, nezávislé na otevření Discover draweru.

| Druh vrstvy                                 | Chování po posunu                                   |
| ------------------------------------------- | --------------------------------------------------- |
| PMTiles, MVT, rasterové dlaždice            | Automatické načítání viditelných dlaždic            |
| Levné bbox dotazy a vlastní indexovaná data | Automaticky přibližně 300 ms po zastavení           |
| Drahé externí hledání a větší přesuny       | Zobrazit „Hledat zde“; znovu použít dostupnou cache |
| Explicitně ruční vrstva                     | Načítat na vyžádání                                 |
| Detail pinu                                 | Neobnovovat kvůli samotnému pohybu mapy             |

Pravidla:

- Po relevantním pohybu vytvořit novou revizi výřezu a přepočítat stav každé aktivní vrstvy.
- „Hledat zde“ zobrazit, pokud alespoň jedna ručně obnovitelná vrstva nepokrývá nový výřez, čeká na potvrzení nebo potřebuje opakovat neúspěšný dotaz.
- Kliknutí spustí dotčené vrstvy pro aktuální výřez. Úspěch jedné vrstvy nesmí skrýt stav ostatních.
- Další pohyb během načítání znovu vytvoří požadavek pro novou oblast.
- Rozlišovat „žádné výsledky“, „oblast nepokryta“, „výsledky jsou částečné“ a „zdroj neodpovídá“.
- Neposuzovat úplnost podle toho, zda jsou piny rovnoměrně rozloženy. Řídce osídlená oblast může být správně prázdná.
- Při chybě ponechat předchozí data s informací o jejich stáří.
- Zrušený dotaz nezobrazovat jako chybu.
- Poskytnout také nenápadnou akci „Obnovit aktivní vrstvy“ pro vynucené ověření již pokrytého výřezu.

### D. Server: rychlá odpověď před doplněním pomalých zdrojů

Uživatel nesmí čekat, než se dokončí import všech chybějících buněk.

- Nejprve odpovědět z uložených nebo cacheovaných dat.
- Chybějící data doplňovat sdílenou frontou na serveru.
- První odpověď musí přiznat částečné pokrytí a uvést revizi probíhajícího doplnění.
- Doplnění oznamovat krátkým kontrolním dotazem pouze pro aktuálně sledovanou oblast; polling ukončit při dokončení, změně výřezu nebo uzavření.
- Sdílet stejnou úlohu mezi více klienty, kteří žádají stejnou buňku.
- Filtrování vlastníka, vrstvy, výřezu a atributů provádět v databázi.
- Limit a výběr sloupců aplikovat před sestavením odpovědi.
- Deduplikaci více POI poskytovatelů provádět nad dostupnými daty; pomalý doplňkový zdroj nesmí blokovat základní odpověď.
- Základní OSM přehled postupně převést na předzpracované evropské výřezy. Veřejný Overpass ponechat pro cílené doplnění.

U tematických dlaždic opravit prostorový dotaz tak, aby využíval existující prostorový index. Současná transformace geometrie uvnitř podmínky vyžaduje ověření plánem dotazu; preferovat transformaci hledaného obdélníku nebo samostatně indexovanou připravenou geometrii.

### E. Cache a RAM

Výchozí rozpočty řízených aplikačních cache:

| Cache                   | Běžný režim | Úsporný režim |
| ----------------------- | ----------: | ------------: |
| Přehledová data         |      16 MiB |         8 MiB |
| Detaily míst            |       8 MiB |         4 MiB |
| Sdílené surové dlaždice |      32 MiB |        16 MiB |

Jde o rozpočty vlastních cache, nikoli slib celkové spotřeby prohlížeče. MapLibre, workery, dekódované obrázky a GPU se měří zvlášť.

Implementace:

- LRU řídit velikostí položek, nejen jejich počtem.
- Používat stabilní prostorové buňky/dlaždice, místo ukládání mnoha téměř stejných bbox odpovědí.
- Respektovat TTL konkrétního zdroje, `Cache-Control`, `ETag`, `Expires` a `no-store`.
- U sdíleného požadavku počítat odběratele; síťovou práci zrušit, když ji už nikdo nepotřebuje.
- Neskladovat plnou kopii stejných dat současně v React stavu, globálním store, mapových properties a několika cache.
- Při vypnutí vrstvy odstranit její listenery, animace a nepotřebné zdroje.
- Statické vrstvy nesmějí udržovat nepřetržitou vykreslovací smyčku.
- U animovaného počasí držet aktuální a nejvýše jeden sousední snímek.
- U obrázků uvolňovat vlastní dekódované objekty a dočasné URL.
- Velké importy GeoJSON, Parquet, NetCDF či HDF5 nesmějí probíhat v prohlížeči.

Počet zapnutých vrstev automaticky neomezovat tichým vypínáním. Úsporný režim sníží animace, přednačítání a některé renderovací detaily.

### F. Optimalizované overlays

- Statické rozsáhlé polygony a sítě: **MVT/PMTiles**.
- Plošné obrazové produkty: **WMTS nebo cacheované rasterové dlaždice**.
- Živé jednotlivé objekty: **malé bbox odpovědi a změny jednotlivých prvků**.
- Geometrie jedné oblasti se sdílí mezi jejími tematickými zobrazeními.
- Stejný zdroj se nepřipojuje opakovaně jen kvůli jinému stylu.
- WMS vrstvy ze stejné služby lze sloučit do jednoho požadavku pouze tehdy, pokud mají slučitelné pořadí, čas a nastavení.
- Nastavit skutečné min/max zoomy, rozsah pokrytí a přiměřený rozměr dlaždic.
- Rozlišovat stav „zdroj připojen“ od „viditelné dlaždice načteny“.
- Po změně podkladu obnovit centrálně definované pořadí vrstev.
- Nepřidávat další WebGL kontext pro každou datovou vrstvu.

PMTiles lze obsluhovat ze stávajícího serveru i objektového úložiště. Nasazení musí správně podporovat čtení částí souborů, CORS a verzování. [Požadavky na hosting PMTiles](https://docs.protomaps.com/pmtiles/cloud-storage)

### G. Discover: předgenerované evropské hranice

**Předgenerovat hranice na serveru; do prohlížeče načítat pouze viditelné dlaždice.** Neposílat celý evropský GeoJSON.

Zdroje:

- GISCO NUTS pro statistické regiony.
- GISCO LAU pro obce tam, kde je pokrývá.
- Národní otevřené administrativní sady pro podrobnější nebo chybějící úrovně.
- geoBoundaries `gbOpen` jako další zdroj mimo pokrytí GISCO.
- Natural Earth pro hrubý přehled států.

NUTS není ve všech zemích ekvivalent správního kraje a ADM2 není automaticky obec. Tyto hierarchie ukládat odděleně a propojit jen ověřenými vazbami. GISCO má podmínky konkrétních datasetů; nepřebírat současný obecný štítek „CC BY“ bez kontroly. [GISCO LAU](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/local-administrative-units), [geoBoundaries API](https://www.geoboundaries.org/api.html)

**Datová pipeline:**

1. Vytvořit katalog evropských zemí a dostupných úrovní, včetně zemí mimo EU.
2. Pro každý dataset evidovat vydání, zdroj, licenci, geografické pokrytí a podporované úrovně.
3. Stáhnout a zpracovat data po zemích, nikoli jedním neomezeným evropským procesem v RAM.
4. Opravit neplatné geometrie a zachovat ostrovy, díry a stabilní identifikátory.
5. Zjednodušovat společné hranice topologicky, aby mezi sousedními oblastmi nevznikaly mezery.
6. Vygenerovat dlaždice s odpovídajícím detailem pro jednotlivé zoomy.
7. Samostatně uložit lehká metadata názvu, hierarchie, středu a odkazu na detail.
8. Ověřit nové vydání ve stagingu a zveřejnit je atomickou změnou manifestu.
9. Při neúspěšném importu ponechat poslední funkční vydání.

**Výchozí zoomové úrovně Discoveru:**

| Zoom      | Preferovaná úroveň                    |
| --------- | ------------------------------------- |
| Pod 4     | Státy                                 |
| 4–7       | První správní úroveň                  |
| 7–10      | Druhá správní úroveň                  |
| 10 a více | Obce/města podle skutečné dostupnosti |

Na hranicích pásem použít hysterézi 0,25 zoomu, aby zóny při drobném pohybu nepřeskakovaly. Statistické vrstvy si zachovají vlastní úrovně NUTS.

Další pravidla:

- Odstranit limit 16 oblastí z mapového vykreslení.
- Hover používá pouze načtenou geometrii a lokální změnu stavu prvku. **Žádný HTTP požadavek.**
- Kliknutí vybere skutečné ID polygonu; detail oblasti nesmí vznikat jen reverzním hledáním středu mapy.
- Průvodce, statistiky a AI se načítají samostatně.
- Hranice fungují i při zavřeném panelu a při výpadku průvodce.
- Pokud chybí jemnější úroveň, zachovat označenou dostupnou nadřazenou oblast.
- Nevydávat pokrytí celé Evropy na úrovni obcí za hotové, dokud neprojde kontrola jednotlivých zemí.

### H. Počasí: přenos, skutečné rozlišení a vzhled

Rozdělit práci do tří kroků.

**1. Okamžitá úspora přenosu**

- Pro aktuální mapový čas stahovat malé časové okno, například šest hodin, místo celé vícedenní řady.
- Cache klíč obsahuje prostorovou buňku, model, vydání modelu, veličinu a časové okno.
- Přepínání hodin uvnitř načteného okna nevolá poskytovatele znovu.
- Směr a rychlost větru získávat společně.
- Vícedenní detailní předpověď načítat až v detailu místa.
- Nezaměňovat jeden HTTP požadavek s automaticky jednou jednotkou providerové kvóty.

Open-Meteo podporuje časové omezení odpovědi i více souřadnic. [Dokumentace API](https://open-meteo.com/en/docs)

**2. Jemnější bloky**

Požadavek interpretuji jako **přibližně poloviční plochu buněk v současném blokovém zobrazení**, nikoli poloviční šířku i výšku, která by znamenala čtyřnásobek buněk.

- U středních zoomů snížit cílovou plochu sektoru na polovinu.
- Oddělit počet vykreslených buněk od počtu skutečných meteorologických vzorků.
- Interpolované sektory nepředstavovat jako nová nezávislá měření.
- Na nejmenších zoomech ponechat plynulé pole; čísla zobrazovat až tam, kde jsou čitelná.
- Mřížku ukotvit geograficky, aby při malém posunu mapy nepřeskládávala buňky.

**3. Lepší meteorologická data**

- Pro ČR využít ALADIN CZ, pro jeho dostupné okolí ALADIN CE.
- Pro další oblasti vybírat model podle geografického pokrytí, dostupných veličin a času.
- Open-Meteo dokumentuje ALADIN CZ **1 km**, CE **2,3 km**, hodinové kroky a třídenní horizont. [ALADIN API](https://open-meteo.com/en/docs/chmi-api)
- DWD ICON-D2 poskytuje regionální 2km model; není to jednotné pokrytí celé Evropy. [DWD API](https://open-meteo.com/en/docs/dwd-api)
- U vrstvy uvádět model, čas platnosti a skutečné prostorové rozlišení.
- Pozorovaný radar, modelovou předpověď srážek a interpolovaný obraz zobrazovat jako odlišné produkty.
- Pro rozsáhlejší plošné produkty následně zavést serverový převod modelových rastrů na dlaždice. Nestavět evropské jemné počasí na tisících nezávislých bodových dotazů.

---

## 3. UX a rozšíření funkcí

### Galerie médií

Vytvořit jeden společný fullscreen lightbox pro hlavní fotografii i záložku Fotky.

- Otevření kliknutím na obrázek, viditelná ikona zvětšení.
- Fotografie přes dostupnou obrazovku, zachovaný poměr stran.
- Šipky předchozí/další, počítadlo, Esc a zavírací tlačítko.
- Swipe na mobilu.
- Obnova fokusu na původní náhled po zavření.
- Při otevřené galerii klávesové šipky přepínají média, nikoli sousední piny.
- Načíst aktivní zobrazovací variantu a nejvýše jednu následující fotografii předem; v úsporném režimu jen aktivní.
- Originál až na explicitní otevření nebo stažení.
- Zobrazit autora, licenci, popisek a odkaz na zdroj.
- Video bez autoplay; při opuštění zastavit.
- Chyba jednoho obrázku nesmí zavřít celý detail.
- Galerii identifikovat stabilním ID média, aby dodatečně načtené fotografie nezměnily právě otevřený obrázek.

### Clustery a styl pinů

- Výchozí clustering běžných POI do zoomu 14, poloměr přibližně 48 px.
- Kliknutí na cluster přiblíží mapu na úroveň jeho rozbalení.
- Shodné souřadnice na maximálním zoomu otevřou seznam konkrétních míst.
- Vybraný pin zůstane samostatně čitelný.
- Měřicí stanice, zemětřesení a jiné specializované vizualizace neslučovat automaticky do obecných POI clusterů.
- Napříč vrstvami sjednotit pravidla kolizí symbolů a priority popisků.
- Cluster různých kategorií nebarvit tak, aby vypadal jako jediná kategorie.
- Zavést společnou definici ikony, barvy a názvu pro mapový sprite, drawer, legendu i detail.

U vrstvy obsahující více kategorií zobrazit v draweru několik reprezentativních ikon a počet dalších kategorií.

### Panel filtrů nad přepínačem režimů

- Zobrazovat pouze aktivní vrstvy, které mají použitelné filtry.
- Kompaktní chipy vrstev; zvolená vrstva otevře své ovládání.
- Minimalizace zachová hodnoty a zobrazí počet aktivních filtrů.
- Reset jedné vrstvy i všech aktivních filtrů.
- Drawer a panel používají stejnou definici filtrů a společný stav.
- Filtry rozlišují lokální změnu zobrazení a nový datový dotaz.
- Textové a rozsahové vstupy mají krátké zpoždění; potvrzená volba se projeví ihned.
- U nepodporovaných filtrů nevytvářet nefunkční ovladače.

Například rastrové Waymarked Trails nelze filtrovat podle povrchu jednotlivých cest. Pro `surface`, obtížnost, sjízdnost nebo typ sítě jsou potřeba vektorová routová data.

### Podklady

- Zachovat malé statické náhledy; nevytvářet živou mapu pro každou kartu.
- Vytvořit manifest dostupných náhledů místo zjišťování chybějících souborů pomocí 404.
- Srovnatelné podklady zobrazovat nad stejným místem a zoomem.
- Nabídnout oblíbené a nedávné podklady.
- Jasně označit typ: ulice, outdoor, satelit, reliéf.
- Průhlednost nastavovat jednotlivým overlayům, nikoli nečekaně celé skupině.
- Sjednotit zbývající směs českých a anglických textů.

### Plánování a spojnice

**Okamžitá oprava draweru:**

- Odstranit starou `.planner-stops::before`.
- Zachovat pouze spojnice jednotlivých zastávek a úseků.
- Kolečkům dát neprůhledný podklad se současným jemným barevným vzhledem.
- Jedna prezentace úseku určuje barvu a styl spojnice v seznamu i na mapě.
- Ověřit dlouhé seznamy, rozbalené formuláře a mobilní zobrazení.

**Příprava různých úseků:**

- Doplnit volitelné nastavení způsobu dopravy a routovací politiky pro konkrétní úsek.
- Výchozí nastavení úsek dědí z celého plánu.
- Změna jednoho úseku přepočítá pouze tento úsek.
- Nastavení navázat na dvojici stabilních ID zastávek.
- Při změně pořadí zachovat nastavení pouze pro dvojice, které zůstaly stejné.
- Rozlišit vypočtenou trasu, přímé spojení, čekající výpočet, chybu a alternativu.
- Zachovat undo, ukládání, načtení a export smíšených profilů.
- Kliknutí na zastávku má přednost před výběrem linie pod ní.
- Po změně podkladu a overlayů ověřit pořadí: linie tras → stop kolečka → čísla.

### Časovou osu výletu nyní skrýt

Současná osa používá obecné časové okno kolem dneška; neukazuje skutečné příjezdy, pobyty a průběh výletu. **Samotné zadání data výletu proto nemá vytvářet spodní časovou osu.**

- Ponechat časové ovládání počasí a událostí.
- Zachovat datum odjezdu, časy příjezdů a užitečné informace v itineráři.
- Vypnutí meteorologického kontextu nesmí smazat datum odjezdu.

Jako pozdější náhradu navrhuji konkrétní funkci **„Kdy vyrazit“**:

- Porovná tři odjezdy.
- Ukáže rozdíl v příjezdu, počasí, denním světle a otevírací době, pokud jsou údaje dostupné.
- Uživatel jedním kliknutím vybere variantu.

Skutečnou osu výletu vrátit až tehdy, když zobrazuje zastávky a pobyty v časovém rozsahu daného plánu.

### Produktové rozšíření

| Oblast             | Další použitelná funkce                                                          | Podmínka                                                        |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Univerzální mapa   | Uložené pracovní sestavy: vrstvy, pořadí, filtry, čas, podklad, legenda          | Stabilní stav a sdílení sestavy                                 |
| Prostorový průzkum | Hledání uvnitř oblasti, v okolí bodu a podél trasy                               | Dotazy nad skutečným datasetem, nikoli jen 100 zobrazenými piny |
| Porovnávání        | Dva časy nebo dvě vrstvy vedle sebe či posuvníkem                                | Srovnatelné jednotky, čas a pokrytí                             |
| Vlastní data       | Import tabulek a geodat s náhledem, mapováním sloupců a informací o chybách      | Dokončená integrační cesta od importu až po mapu                |
| Discover           | Okamžitý název oblasti, lokální přehled, následně zdrojový průvodce a statistiky | Hranice nezávislé na textovém obsahu                            |
| Průvodce           | Krátké tematické průvodce podle aktivních vrstev, s přidáním míst do plánu       | Citace, stáří podkladů a cache                                  |
| Plánování          | Smíšené úseky, hledání podél trasy, alternativy, dosažitelnost                   | Providerové schopnosti a částečné výsledky                      |
| Terénní použití    | Stažení vybrané oblasti, plánu, detailů a průvodce                               | Povolení offline distribuce u konkrétních dat                   |
| Osobní             | Uložené sestavy, sbírky míst, navštívená místa a cestovní deník                  | Sdílená identita míst                                           |
| Komunita           | Oprava údajů, příspěvky, návrhy míst a sdílené sestavy                           | Jasné autorství a moderace                                      |

Další hlavní režimy nyní nepřidávat jen kvůli novému datasetu. „Porovnat“ a „Analyzovat oblast“ budou nástroje nad mapou; „Na cestě“ bude stav aktivního plánu. Samostatný režim má vzniknout až pro odlišný pracovní postup.

### AI

Navázat na existující AI infrastrukturu:

- Převést přirozený dotaz na výběr vrstev, prostorové omezení a podporované filtry.
- Ukázat, které zdroje byly skutečně prohledány.
- Rozlišit výsledek nad úplným datasetem od výsledku nad omezeným vzorkem.
- Vrátit mapový výsledek a stručné vysvětlení.
- U složitějšího dotazu nabídnout uložit výslednou sestavu nebo vrstvu.
- U plánování připravit změnu s náhledem rozdílů a možností vrátit ji.
- Průvodce sestavovat z dostupných podkladů a cache; nové dohledávání dělat cíleně.
- AI nesmí být podmínkou zobrazení pinů, hranic ani základních statistik.
- Modelové odpovědi musí přiznat chybějící pokrytí a stáří údajů.
- Náklady řídit rozpočtem úloh a účtu; neopakovat syntézu při každém posunu mapy.

### Hra

První etapa:

1. Quest má cíl, vzdálenost, stav a konkrétní podmínku splnění.
2. Výběr questu nabídne přidání do trasy nebo krátký okruh.
3. Splnění přinese jasný výsledek: XP, odznak, postup sbírkou.
4. Questy využijí navštívení míst, poznávání oblasti, fotografie a dobrovolné ověřování údajů.
5. Simulovaný pohyb se oddělí od reálného postupu.
6. Hra sdílí prostorovou cache a má funkční 2D úspornou variantu.
7. Vypnutá hra neudržuje animaci ani herní síťové dotazy.

Další etapa rozšíří stávající 3D/Aavegotchi plán o avatary, vybavení, minihry a společné výpravy. Multiplayer a finanční ekonomiku ponechat jako samostatné pozdější projekty; nejsou podmínkou užitečné základní hry.

---

## 4. Katalog datových integrací a registrací

Níže je rozsáhlý katalog proveditelných integračních rodin. Není to tvrzení, že každý produkt pokrývá celou Evropu ve stejném rozlišení.

**Význam adaptéru:**

- **WMS:** základ existuje; doplnit časové dimenze, legendu a dotaz na hodnotu.
- **WMTS/XYZ/TileJSON:** dokončit obecné adaptéry.
- **MVT/PMTiles:** úsporná distribuce geometrií.
- **REST:** serverový adaptér s cache, filtry a odděleným detailem.
- **Import:** periodické zpracování do PostGIS/dlaždic.
- **STAC/COG:** katalog snímků a serverová distribuce výřezů.
- **P1:** první rozšiřující vlna po opravě jádra; **P2:** následující vlna.

### Velká tabulka vrstev

| P   | Vrstva / použití                                       | Kde získat data                                                                                                                                                   | Pokrytí a omezení                                      | Adaptér a nastavení                                                          |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| P1  | Sucho, půdní vlhkost, stres vegetace                   | [Copernicus EDO/GDO](https://drought.emergency.copernicus.eu/data/wms-service)                                                                                    | Evropa a vybrané globální indikátory                   | WMS; indikátor, publikovaný čas, legenda. Endpoint `/api/wms`.               |
| P1  | Požární nebezpečí a spálená území                      | [EFFIS](https://forest-fire.emergency.copernicus.eu/downloads-instructions)                                                                                       | Rozsah podle produktu                                  | WMS-T; produkt a čas; cache podle vydání.                                    |
| P1  | Aktivní požáry                                         | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)                                                                    | Globální satelitní detekce, nikoli přesný obvod požáru | Rozšířit existující REST; bbox, čas, satelit; větší přehled agregovat.       |
| P1  | Povodňová předpověď                                    | [CEMS-Flood](https://confluence.ecmwf.int/spaces/CEMS/pages/247897119/Accessing%2BCEMS-Flood%2BWMS%2Bvia%2Bweb%2Bbrowser)                                         | GloFAS globální, EFAS Evropa; část přístupů omezená    | WMS-T; model, čas a typ produktu.                                            |
| P1  | Pozorované zaplavené plochy                            | [Global Flood Monitoring](https://extwiki.eodc.eu/GFM/PUM/DataAccess)                                                                                             | Závisí na satelitních pozorováních                     | WMS/STAC; čas snímku a metadata detekce.                                     |
| P1  | Hladiny a průtoky řek                                  | [ČHMÚ hydrologie](https://opendata.chmi.cz/hydrology/)                                                                                                            | ČR, měřicí profily                                     | Import stanic; malé aktuální hodnoty; časová řada až v detailu.              |
| P1  | Jemnější radar ČR                                      | [ČHMÚ radarová data](https://opendata.chmi.cz/meteorology/weather/radar/)                                                                                         | ČR, radarové produkty                                  | Serverový převod HDF5 na časované rasterové dlaždice.                        |
| P1  | Meteorologické výstrahy                                | [Meteoalarm](https://api.meteoalarm.org/edr/v1/authentication)                                                                                                    | Evropské národní výstrahy                              | EDR/CAP; jev, závažnost, platnost; uložené oblasti.                          |
| P1  | Lokální předpověď                                      | [ALADIN přes Open-Meteo](https://open-meteo.com/en/docs/chmi-api)                                                                                                 | CZ 1 km, CE 2,3 km; regionální produkt                 | Weather provider; model, vydání a časové okno.                               |
| P1  | Regionální předpověď Evropy                            | [DWD přes Open-Meteo](https://open-meteo.com/en/docs/dwd-api)                                                                                                     | ICON-D2 2 km v jeho doméně; ICON-EU 7 km               | Weather provider s geografickou volbou modelu.                               |
| P2  | Alternativní bodová předpověď                          | [MET Norway](https://api.met.no/weatherapi/locationforecast/2.0/documentation)                                                                                    | Globální souřadnice, regionální rozdíly                | REST compact; identifikační User-Agent a HTTP cache.                         |
| P1  | Pyl a kvalita ovzduší                                  | [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api)                                                                                          | Evropské a globální modelové produkty                  | Weather provider; veličina, čas, informace o modelu.                         |
| P2  | Plošné znečištění ovzduší                              | [CAMS Europe](https://ads.atmosphere.copernicus.eu/datasets/cams-europe-air-quality-forecasts?tab=overview)                                                       | Evropa, přibližně 10km model                           | Import GRIB/NetCDF → raster tiles; výběr látky a času.                       |
| P1  | Měřicí stanice ovzduší                                 | [OpenAQ](https://docs.openaq.org/)                                                                                                                                | Skutečné stanice, různá hustota pokrytí                | Existující REST; látka, stáří měření; historie na klik.                      |
| P1  | Vlny, proudy a teplota moře                            | [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api)                                                                                            | Rozlišení a pokrytí závisí na veličině                 | Weather provider; rozlišovat vlny, proudy a příliv.                          |
| P1  | Hloubka evropských moří                                | [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry)                                                                                                  | DTM 2024 přibližně 115 m, místně podrobnější produkty  | WMTS/WMS; hloubková legenda, produkt, vertikální reference.                  |
| P2  | Globální oceánská batymetrie                           | [GEBCO](https://www.gebco.net/data-products/gebco-web-services/web-map-service)                                                                                   | Globální, regionálně různá kvalita podkladů            | WMS; širší přehled mimo EMODnet.                                             |
| P1  | Jezera, plocha, objem a průměrná hloubka               | [HydroLAKES](https://www.hydrosheds.org/products/hydrolakes)                                                                                                      | Globální jezera od 10 ha; hloubka je odhad průměru     | Import evropského výřezu → MVT; údaje do detailu jezera.                     |
| P2  | Skutečné dno vybraných jezer                           | [swissBATHY3D](https://www.swisstopo.admin.ch/en/height-model-swissbathy3d)                                                                                       | Vybraná švýcarská jezera                               | Import/modelové dlaždice; přesný katalog pokrytí.                            |
| P1  | Kvalita koupání                                        | [EEA Bathing Water](https://www.eea.europa.eu/en/datahub/datahubitem-view/c3858959-90da-4c1b-b9ca-492db0e514df)                                                   | Evropská koupací místa; roční hodnocení                | Import POI; rok, kvalita, sladká/mořská voda.                                |
| P2  | Sněhová pokrývka                                       | [Copernicus Fractional Snow Cover](https://land.copernicus.eu/en/products/snow/fractional-snow-cover)                                                             | Evropská satelitní data 20 m; oblačnost a mezery       | STAC/COG → raster tiles; datum a maska chybějících dat.                      |
| P1  | Lavinové bulletiny                                     | [Lawinen.report](https://lawinen.report/more/open-data)                                                                                                           | Konkrétní alpské regiony                               | CAAML JSON/XML; mikroregion, výška, expozice, problém.                       |
| P1  | Krajinný pokryv                                        | [CLCplus Backbone](https://land.copernicus.eu/en/products/clc-backbone?tab=technical_summary)                                                                     | Evropský raster 10 m, 11 tříd                          | WMS/ArcGIS nebo import COG; třída a vydání.                                  |
| P2  | Stromy, zástavba a mokřady                             | [Copernicus Land produkty](https://land.copernicus.eu/en/products)                                                                                                | Samostatné produkty s různými roky a rozlišením        | WMS/COG; společná infrastruktura, oddělená metadata produktů.                |
| P1  | Natura 2000                                            | [EEA Natura služby](https://image.discomap.eea.europa.eu/arcgis/rest/services/Natura2000)                                                                         | EU; základ už integrován                               | Doplnit detail a filtry typu ochrany.                                        |
| P1  | Ochrana přírody ČR                                     | [AOPK otevřená data](https://data.aopk.gov.cz/ds/1)                                                                                                               | ČR, více tematických sad                               | ArcGIS/WMS; typ území, detail a odkazy na pravidla.                          |
| P2  | Chráněná území světa                                   | [Protected Planet v4](https://api.protectedplanet.net/documentation)                                                                                              | WDPA/OECM, přístup nekomerční                          | REST/import; token, licence, datum aktualizace.                              |
| P1  | Hluk dopravy                                           | [EEA Noise](https://noise.discomap.eea.europa.eu/arcgis/rest/services/Noise/Noise_Dyna_LAEA/MapServer)                                                            | Reportované evropské oblasti, ne souvislé pokrytí      | ArcGIS raster; zdroj hluku, indikátor, rok.                                  |
| P2  | Satelitní snímky, NDVI a NDWI                          | [Copernicus Data Space](https://documentation.dataspace.copernicus.eu/APIs.html)                                                                                  | Sentinel a další kolekce                               | STAC + serverové výřezy; datum, oblačnost, index.                            |
| P2  | Aerosoly, noční světla, sníh a další globální produkty | [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)                                                                                             | Široký katalog, každý produkt má jiné parametry        | WMTS/XYZ/WMS; čas, produkt a podporovaná projekce.                           |
| P1  | Reliéf, sklon a expozice ČR                            | [ČÚZK DMR5G](https://geoportal.cuzk.gov.cz/Default.aspx?lng=EN&menu=3128&metadataID=CZ-CUZK-WMS-DMR5G&metadataXSL=metadata.sluzba&mode=TextMeta&side=wms.verejne) | ČR                                                     | WMS; stínování/sklon/orientace, vlastní legenda.                             |
| P1  | Cyklotrasy, povrch a obtížnost                         | [OSM přes Geofabrik](https://www.geofabrik.de/data/download.html)                                                                                                 | Evropa, průběžně obnovované výřezy                     | Import PBF → MVT; `surface`, `smoothness`, `mtb:scale`, `network`.           |
| P1  | Pěší trasy, přístřešky, voda a outdoor služby          | [OSM výřezy](https://www.geofabrik.de/data/download.html)                                                                                                         | Pokrytí podle komunitních dat                          | Stejný import; `sac_scale`, typ trasy, přístup, vybavení.                    |
| P1  | Značené trasy jako rychlé doplnění                     | [Waymarked Trails](https://waymarkedtrails.org/)                                                                                                                  | Pěší, cyklo, MTB a další aktivity                      | Zachovat raster; pro podrobné filtry přejít na vlastní vektory.              |
| P1  | Biodiverzita a výskyt druhů                            | [GBIF Maps API](https://techdocs.gbif.org/en/openapi/v2/maps)                                                                                                     | Globální body a agregované buňky                       | MVT/agregace; taxon, rok, dataset; detail occurrence na klik.                |
| P2  | Přírodovědná pozorování a fotografie                   | [iNaturalist API](https://api.inaturalist.org/v1/docs/)                                                                                                           | Komunitní data, někdy znepřesněné souřadnice           | Rozšířit REST; taxon, období, kvalita; licence médií individuálně.           |
| P1  | Sdílená kola a koloběžky                               | [GBFS](https://gbfs.org/get-started/)                                                                                                                             | Jednotlivá města a operátoři                           | GBFS; metadata odděleně od stavu, dostupnost a typ vozidla.                  |
| P1  | PID, zastávky a živé polohy                            | [Golemio Public Transport](https://api.golemio.cz/pid/docs/openapi/)                                                                                              | Praha a PID                                            | GTFS + GTFS-RT; klientovi jen viditelné polohy a změny.                      |
| P1  | Parkování, mikroklima a městské senzory                | [Golemio](https://api.golemio.cz/docs/openapi/)                                                                                                                   | Veřejně označené pražské datasety                      | REST; bbox, typ senzoru; časová řada na detailu.                             |
| P2  | MHD dalších měst                                       | [Mobility Database](https://github.com/MobilityData/mobility-feed-api)                                                                                            | Katalog jednotlivých GTFS/GBFS feedů                   | Import vybraných feedů; licence a aktualizace po operátorech.                |
| P1  | Nabíječky                                              | [OpenChargeMap](https://www.openchargemap.org/develop/api)                                                                                                        | Globální, rozdílná hustota a stáří                     | Existující REST; konektor, výkon, operátor.                                  |
| P2  | Ceny paliv                                             | [Tankerkönig](https://creativecommons.tankerkoenig.de/)                                                                                                           | Německo                                                | REST; palivo a známá ID stanic; respektovat podmínky přístupu.               |
| P1  | Památky a památkové zóny                               | [NPÚ katalog služeb](https://geoportal.npu.cz/arcgis/rest/services/Tematicke)                                                                                     | ČR, publikované tematické služby                       | ArcGIS/WMS; druh památky, identifikátor a detail.                            |
| P1  | Fotografie ulic a sekvence                             | [Panoramax](https://docs.panoramax.fr/backend/dev/STAC_compatibility/)                                                                                            | Federované instance, nerovnoměrné pokrytí              | MVT `/api/map/{z}/{x}/{y}.mvt`; STAC detail a média až klik.                 |
| P1  | POI, budovy, adresy a dopravní síť                     | [Overture](https://docs.overturemaps.org/getting-data/cloud-sources/)                                                                                             | Globální měsíční vydání                                | PMTiles pro ověření; vlastní omezený import pro produkci; zachovat GERS ID.  |
| P2  | Další obchodní POI                                     | [Foursquare OS Places](https://docs.foursquare.com/data-products/docs/access-fsq-os-places)                                                                       | Otevřený dataset, účet/token pro přístup               | Import Iceberg → PostGIS/PMTiles; deduplikace s dalšími POI.                 |
| P1  | Události                                               | [Ticketmaster Discovery](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)                                                             | Podle trhu a poskytovatele                             | Rozšířit existující REST; čas, kategorie, vzdálenost.                        |
| P1  | Regionální statistiky                                  | [Eurostat API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access)                                                                        | Úroveň a rok podle konkrétní řady                      | Existující statistický import; join na uložené oblasti.                      |
| P2  | Srovnání států                                         | [World Bank Indicators](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)                                  | Převážně národní údaje                                 | Statistický import; země, rok, ukazatel; nepřenášet národní průměr na města. |

**První balík nových použití:** sucho EDO, batymetrie EMODnet, detail jezer HydroLAKES, koupací vody EEA, výstrahy Meteoalarm, ALADIN, GBIF dlaždice, Panoramax a filtrovatelné OSM cyklovektory.

### Jak se má přidávat nový adaptér

Současný registr skutečně obsahuje WMS, ArcGIS a PMTiles. Další typy uvedené v TypeScript unionu samy o sobě neznamenají hotovou integraci.

Pořadí rozšíření:

1. Dokončit vykreslování importovaných feature zdrojů.
2. Implementovat XYZ/TileJSON a WMTS.
3. Rozšířit WMS o čas, legendu a dotaz na hodnotu.
4. U ArcGIS doplnit výběr polí, stránkování, více podvrstev, filtry a polygonové geometrie.
5. Přidat OGC API Features a omezený čtecí WFS adaptér.
6. Přidat serverovou STAC/COG cestu.
7. Specializované formáty GTFS, CAAML, GRIB/NetCDF/HDF5 zpracovávat přes konkrétní importní adaptéry.

Každý zdroj musí projít celou cestou:

**Rozpoznat URL → načíst schopnosti → vybrat data → uložit manifest → zobrazit → reagovat na pohyb → filtrovat → otevřít detail.**

Povinné údaje manifestu: pokrytí, licence, časová platnost, jednotka, skutečné rozlišení, legenda, podporované filtry, distribuce a stav přístupových údajů. Rozlišovat pozorované, modelované a odhadované hodnoty.

### Aktualizované bezplatné registrace

Ověřeno podle dostupných oficiálních podkladů k 4. 9. 2026. Bezplatný účet neznamená neomezené použití.

| Priorita | Kde se registrovat                                                                          | Co získáš                                | Napojení                                                             |
| -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Vysoká   | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/)                             | Aktivní požáry                           | Existující `NASA_FIRMS_MAP_KEY`                                      |
| Vysoká   | [OpenAQ](https://explore.openaq.org/register)                                               | Měřicí stanice ovzduší                   | Existující `OPENAQ_API_KEY`                                          |
| Vysoká   | [OpenChargeMap](https://openchargemap.org/develop)                                          | Nabíječky a konektory                    | Existující `OPENCHARGEMAP_API_KEY`                                   |
| Vysoká   | [Golemio](https://api.golemio.cz/api-keys)                                                  | PID a městská otevřená data              | Doplnit `GOLEMIO_API_KEY`                                            |
| Vysoká   | [Copernicus Data Space](https://dataspace.copernicus.eu/)                                   | Satelitní data a zpracování v kvótách    | Serverový přístup podle použité služby                               |
| Vysoká   | [openrouteservice](https://openrouteservice.org/log-in/)                                    | Pěší/cyklo routing a isochrony           | Doplnit provider a klíč                                              |
| Vysoká   | [Mapy.com](https://developer.mapy.com/rest-api-mapy-cz/how-to-start/)                       | Mapy, geocoding a routing                | Existující `MAPY_API_KEY`                                            |
| Střední  | [Meteoalarm](https://api.meteoalarm.org/edr/v1/authentication)                              | Rozšířený přístup k výstrahám            | Token podle procesu poskytovatele                                    |
| Střední  | [Foursquare OS Places](https://docs.foursquare.com/data-products/docs/access-fsq-os-places) | Otevřený POI dataset                     | Samostatný importní token                                            |
| Střední  | [Ticketmaster](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/)  | Události                                 | Existující `TICKETMASTER_API_KEY`; starší plán uvádí již dodaný klíč |
| Střední  | [Copernicus ADS](https://ads.atmosphere.copernicus.eu/)                                     | Atmosférické modelové datasety           | Přístup pro serverové importy                                        |
| Střední  | [Global Flood Monitoring](https://portal.gfm.eodc.eu/register)                              | Pokročilý přístup k záplavovým produktům | Samostatný účet                                                      |
| Později  | [OpenSky](https://opensky-network.org/about/faq)                                            | Vyšší limity leteckých dat               | OAuth2 client ID/secret                                              |
| Později  | [Tankerkönig](https://onboarding.tankerkoenig.de/)                                          | Ceny paliv DE                            | Manuálně posuzovaná žádost                                           |
| Později  | [Polar AccessLink](https://www.polar.com/accesslink-api/)                                   | Import vlastních aktivit                 | OAuth klient a souhlas uživatele                                     |
| Později  | [Protected Planet](https://api.protectedplanet.net/)                                        | Globální chráněná území                  | Token; nekomerční podmínky                                           |

Podklady s bezplatnou nabídkou:

| Registrace                                              | Aktuálně podstatná podmínka                                                 | Existující konfigurace  |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| [MapTiler](https://www.maptiler.com/cloud/pricing/)     | Free pro osobní/nekomerční použití a vývoj; podmínky atribuce               | `MAPTILER_API_KEY`      |
| [Thunderforest](https://www.thunderforest.com/pricing/) | Hobby tarif s kvótou; hromadné offline použití není automaticky zahrnuto    | `THUNDERFOREST_API_KEY` |
| [Stadia Maps](https://stadiamaps.com/pricing/)          | Free nekomerční nabídka, registrace bez karty                               | `STADIA_API_KEY`        |
| [HERE](https://www.here.com/get-started/pricing)        | Rozlišit omezenou nabídku a tarif s účtováním; ověřit při registraci        | `HERE_API_KEY`          |
| [TomTom](https://docs.tomtom.com/pricing)               | Bezplatné měsíční limity podle API; neopakovat staré denní kvóty z projektu | `TOMTOM_API_KEY`        |
| [Geoapify](https://www.geoapify.com/pricing/)           | Free bez karty, omezené komerční použití                                    | `GEOAPIFY_API_KEY`      |

Důležité opravy starého seznamu:

- Mapy.com Basic poskytuje **250 000 kreditů měsíčně**. Zvýhodněných 10 milionů má podmínky včetně výhradního používání jejich podkladů; současný MapOS s více podklady na tom nelze automaticky stavět. [Podmínky Mapy.com](https://developer.mapy.com/cs/cena/)
- Open-Meteo free hostovaná nabídka vyhovuje nynějšímu nekomerčnímu směru. Komerční provoz je samostatné rozhodnutí. [Tarify](https://open-meteo.com/en/pricing)
- Foursquare OS Places a placené Places API jsou odlišné produkty. Bezplatný otevřený dataset automaticky nepřidá bezplatné fotografie a tipy. [Přístup k OS Places](https://docs.foursquare.com/data-products/docs/access-fsq-os-places), [ceník](https://foursquare.com/pricing/)
- U OKAPI, eBird, Mapillary, Wheelmap a OpenTripMap zůstává potřeba ověření konkrétního registračního procesu nebo přístupu po přihlášení. Nevydávat staré odkazy za potvrzenou novou kapacitu.
- OSM OAuth, Wikimedia OAuth, Panoramax upload a iNaturalist OAuth přidávají především možnost **zapisovat**, nikoli více veřejných dat ke čtení.
- Reown, RPC služby a další peněženkové registrace patří do pozdější herní etapy.
- Objektové úložiště/CDN je infrastruktura. Nenahrazuje datový zdroj.
- Google a partnerství typu GoOut nejsou předpokladem dokončení první vlny.

---

## 5. Zadání implementující AI, rozhraní a ověření

### Změny rozhraní a datových smluv

Rozšiřovat existující SDK v2; nevytvářet druhý konkurenční systém.

| Rozhraní       | Požadovaná změna                                                                             |
| -------------- | -------------------------------------------------------------------------------------------- |
| Dotaz vrstvy   | Podpora zoomu, prostorového rozsahu, filtrů, času, projekce přehled/detail, limitu a kurzoru |
| Odpověď vrstvy | Zachovat metadata úplnosti, pokrytí, stáří, revize a pokračování výsledků                    |
| Stav vrstvy    | Samostatně požadovaný výřez, přijatá revize, načítání, částečnost a chyba                    |
| Identita prvku | Stabilní zdrojové ID; kompatibilní řešení starých referencí                                  |
| Média          | Skutečné varianty thumbnail/display/original, rozměry, autorství a licence                   |
| Hranice        | Verzovaný manifest dlaždic, metadata podle ID a katalog dostupných úrovní                    |
| Počasí         | Model, vydání modelu, čas platnosti, rozlišení a malé sdílené časové okno                    |
| Plán           | Volitelná politika jednotlivého úseku a příkaz pro její změnu                                |
| Adaptér        | Jednotné schopnosti filtrů, časových dimenzí, stránkování a způsobu distribuce               |

Soukromá data nesmějí vstoupit do veřejně distribuovaných PMTiles ani sdílené veřejné cache. Klíče cache pro neveřejná data musí respektovat oprávnění uživatele.

### Implementační pořadí

| Etapa                                 | Práce                                                                                                            | Podmínka dokončení                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **0 — Měřitelný výchozí stav**        | Zachytit aktuální revizi, načítací trasy, objemy, počty zápisů do mapy, paměť a dlouhé úlohy                     | Opakovatelný scénář a zpráva odlišující fixture od skutečných providerů |
| **1 — Opravy jádra**                  | Jediný commit dat, ochrana proti starým odpovědím, cílené změny vrstev, okamžité připojení rastrů, hover cleanup | Žádné násobné zápisy a žádné čekání rasterového attach na POI frontu    |
| **2 — Spolehlivý viewport**           | Stav po vrstvách, „Hledat zde“, skutečné pokrytí, částečné výsledky                                              | Pohyb, souběžné načítání i chyby fungují bez vypínání/zapínání vrstvy   |
| **3 — Data a paměť**                  | Přehled/detail, serverové projekce a indexy, bounded cache, lehčí POI přehled                                    | Menší přenosy a stabilní paměť v opakovaném scénáři                     |
| **4 — Okamžité UX opravy**            | Galerie, clustery, společné ikony, panel filtrů, náhledy podkladů, spojnice, skrytí trip timeline                | Funkční desktop/mobil, klávesnice, light/dark                           |
| **5 — Evropský Discover**             | Verzované importy hranic, PMTiles/MVT, společná zoomová pravidla, oddělený obsah                                 | Lokální hover bez HTTP a doložené pokrytí po zemích                     |
| **6 — Počasí**                        | Menší časové odpovědi, jemnější sektory, modelové pokrytí, ALADIN/DWD                                            | Časové přepínání využívá cache a rozlišení je uváděno pravdivě          |
| **7 — Adaptéry a první datový balík** | Dokončení feature importu, WMTS/WMS-T, ArcGIS a vybrané vrstvy P1                                                | Každá vrstva projde celou integrační cestou                             |
| **8 — Pracovní nástroje a plánování** | Uložené sestavy, prostorové filtry, porovnání, smíšené úseky, „Kdy vyrazit“                                      | Použitelné úlohy nad skutečnými daty                                    |
| **9 — Průvodce, AI a questy**         | Rozšířit existující nástroje nad stabilním datovým jádrem                                                        | Rychlá mapa nezávislá na AI, doložené výsledky a funkční herní smyčka   |

Etapy 4 a příprava importů v etapě 5 mohou probíhat souběžně po zavedení rozhraní z etap 1–2. Další poskytovatele plošně nezapínat před splněním výkonových podmínek.

### Výkonnostní cíle

Následující čísla jsou **akceptační cíle**, nikoli naměřené vlastnosti dnešní aplikace.

| Metrika                                           | Cíl                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Reakce tlačítka a otevření lokálního náhledu pinu | Do 100 ms                                                                         |
| Hover načtené oblasti                             | p95 pod 50 ms, bez sítě                                                           |
| Zobrazení cacheovaného výřezu                     | Do 150 ms                                                                         |
| Připojení nové rasterové vrstvy při hotovém stylu | Do 100 ms; síťové stažení měřit zvlášť                                            |
| Serverový přehled z připravených dat              | p95 do 500 ms                                                                     |
| První částečná odpověď při chybějících datech     | Do 1,5 s bez čekání na všechny poskytovatele                                      |
| Změna průhlednosti                                | Nula feature požadavků a nula přepisů GeoJSON                                     |
| Změna filtru jedné vrstvy                         | Nula požadavků nesouvisejících vrstev                                             |
| Přijatá odpověď nezávislé vrstvy                  | Nejvýše jeden commit změněné kolekce                                              |
| Paměť po návratu do stejného stavu                | Po ustálení a GC nárůst nejvýše větší z 15 % nebo 25 MiB proti ustálenému základu |

Paměťový scénář: šest aktivních různých vrstev, 50 posunů, deset vypnutí/zapnutí a deset změn podkladu. Vedle JS heapu sledovat workery, počet listenerů, mapových zdrojů a dostupné údaje o GPU. Doplnit náročnější scénář s dvanácti vrstvami.

Srovnávat stejný prohlížeč, zařízení, rozměry, DPR a data. Síťové testy používat s pevně nastavenými podmínkami; nepoužívat náhodnou odezvu veřejného serveru jako jediný CI limit.

### Povinné testovací scénáře

- Pozdní odpověď nikdy nepřepíše nový výřez.
- Vypnutá vrstva se sama znovu nevykreslí.
- Dvě reálné datové factory vyvolají dva potřebné commity, nikoli pět.
- Úspěch jedné vrstvy neschová chybu nebo neúplnost jiné.
- Pohyb během „Hledat zde“ zachová požadavek pro nový výřez.
- Prázdná, ale kompletně prohledaná oblast se neobnovuje donekonečna.
- Cache respektuje TTL, `no-store`, velikost a zrušení všech odběratelů.
- Velký bbox nevrací tiše pouze jeden okraj mapy.
- Přepínání podkladů nenásobí listenery.
- Cluster lze rozbalit a vybrat konkrétní místo.
- Galerie funguje pro jednu i mnoho fotografií, chybu média, klávesnici a mobil.
- Filtry draweru a mapového panelu zůstávají synchronní.
- Spojnice neprochází číslem zastávky; funguje i dlouhý seznam.
- Změna jednoho routového úseku nepřepočítá celý plán.
- Vypnutí časového kontextu nemaže odjezd.
- Discover zobrazuje více než 16 oblastí a funguje bez průvodce.
- Hranice mají stabilní hover na švech dlaždic a při změnách zoomu.
- Počasí neopakuje stejný providerový požadavek při změně hodiny uvnitř cacheovaného okna.
- Vrstvy s časem mění data i legendu pro správné vydání.
- Každý nový adaptér má fixture test i samostatný smoke test skutečného poskytovatele.
- Výpadek klíče, 429 a timeout se liší od výsledku „nic nenalezeno“.

### Migrace, nasazení a předání

- Zachovat uložené vrstvy, plány, reference míst a kompatibilitu manifestů.
- Datové importy publikovat verzovaně a atomicky; předchozí vydání ponechat pro návrat.
- Změny engine a Discoveru nasazovat za samostatnými přepínači, aby bylo možné vrátit konkrétní část.
- Měřit počet požadavků, přenesené bajty, cache hit rate, dobu do prvního použitelného výsledku, částečné pokrytí a chyby po poskytovatelích.
- Nezaznamenávat do provozních metrik tajné klíče ani soukromý obsah.
- Aktualizovat dokumentaci skutečných schopností adaptérů a registrací.
- U staré roadmapy rozlišit **hotovo / částečně / chybí / odloženo / nahrazeno tímto plánem**. Staré checkboxy nepovažovat za důkaz funkčnosti.
- Každou etapu uzavřít výsledkem testů, krátkým srovnáním výkonu a relevantními screenshoty.
- Nový celoplošný redesign, změna frontendového frameworku ani přepis mapového enginu nejsou součástí tohoto plánu.
