# MapOS: ovládání, počasí, stav vrstev a objevitelné detaily

Stav: připravený implementační plán podle kontroly aktuálního zdrojového kódu 6. 9. 2026. Tento dokument neoznačuje navržené změny ani výkonnostní cíle za implementované nebo změřené. Navazuje na vydání `20260906-boundary-navigation-final`.

## 1. Výsledné chování

Mapa reaguje na vědomé gesto. Ve městě ukazuje jednotlivá místa, v přehledu srozumitelné souhrny. U každé zapnuté vrstvy je vidět, zda čeká, načítá, zobrazuje výsledky, nebo potřebuje zásah. Počasí má jemnější kresbu a nízkou časovou lištu. Detail nabízí fotografie, pohled do ulice a fakta před AI a doplňkovými widgety.

Zachovat předgenerované hranice, návrat mezi jejich úrovněmi, přesné prostorové filtrování, existující galerii, omezení dotazů při malém zoomu, Low Data a rušení zastaralých požadavků. Nepřepisovat herní pravidla ani přidávat nové poskytovatele do tohoto rozsahu.

## 2. Co je potvrzené v kódu

| Oblast          | Současný stav                                                                                                                                                                                                         | Důsledek                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dotazový bod    | `world/socialMap.ts`: `mousemove` spouští `openPoint` po 1 800 ms. Dotyk má samostatné podržení 650 ms.                                                                                                               | Bod opravdu vzniká i bez stisku tlačítka; levé tlačítko nemá odpovídající dlouhé podržení.                                                                |
| Clustery        | `layers/pinsLayer.ts`: společné pevné `clusterMaxZoom: 14`, `clusterRadius: 48`. `MapCore.tsx` při rozbalovacím zoomu nad 14 nebo bez očekávaného posunu otevírá `cluster-list`.                                      | Clustery přetrvávají hluboko do města a seznam může nahradit přirozené přiblížení. Nastavení jednotlivých manifestů je nutné propojit s tímto rendererem. |
| Počasí          | `weather/strategy.ts`: pod 6,5 souvislé pole, 6,5–10,5 buňky bez čísel, od 10,5 nejvýše 48 čísel. Počet vykreslovaných buněk klesá při přechodu na lokální režim z 240 na 120.                                        | Chybějící čísla jsou částečně záměr strategie; přechod může vizuálně zvětšit buňky.                                                                       |
| Obnovení počasí | `weatherLayer.ts` volá `field.render` až po dokončení `loadGrid`; `GlobalTimeline.tsx` posunuje přehrávání po 700 ms bez potvrzení připraveného snímku.                                                               | Překreslení je navázané na síť a pomalé snímky mohou být opakovaně rušeny. To je kandidát příčiny zasekávání, nikoli hotové měření výkonu.                |
| Střed popisku   | `adaptiveOverlay.ts`: krajní buňky jsou oříznuté bboxem, jejich `center` však zůstává na původním vzorkovacím bodě na okraji.                                                                                         | U krajních buněk popisek nemusí být uprostřed skutečně vykreslené plochy.                                                                                 |
| Stav načítání   | `PoiLayerRow.tsx` neodebírá stav dotazu. `MapStatus.tsx` skládá informaci z booleanů a textových oznámení. `LayerEngine` spouští task až při odbavení fronty; může zaznamenat `succeed` i při odpovědi `unavailable`. | Řádek vrstvy nedává okamžitou zpětnou vazbu a „hotovo“ nemusí znamenat dostupná data. Připojení rastrového zdroje také není dokončení jeho dlaždic.       |
| Náhledy         | Ve `public/basemaps` chybí `opnvkarte`, `carto-positron`, `esri-imagery`, `esri-topo`. Generátor Positron nezahrnuje, Esri záměrně vynechává.                                                                         | Fallback hledá neexistující obrázky; je potřeba opravit způsob dodání, nikoli pouze CSS.                                                                  |
| Obsah detailu   | Wikipedia, Wikidata, ulice, Windy a odkazy mají v `info/builtins.ts` `surface: more`. `PanelGroup` připojí jen vybraný panel. `PlaceAiBrief` je v `PinDetail` před `InfoEngine`.                                      | Podstatný obsah je dvojitě skrytý a AI se může objevit před zdrojovými fakty.                                                                             |

Aktivní časovou plochou je `TimelineHost` v `ui/GlobalTimeline.tsx`. Starý `WeatherTimeline.tsx` nemá v kontrolovaných místech hosta použití; před úpravami potvrdit importy v celém projektu. Nevytvářet třetí časovou osu.

V kontrolovaném detailu existuje widget Mapillary „Ulice“. Samostatný komponent pojmenovaný Panorama nalezen nebyl. Implementace má využít tento existující vstup a dohledat případný další widget; nesmí tvrdit, že konkrétní místo má panoramu, dokud to zdroj nepotvrdí.

## 3. Dotazový bod: jen pravé tlačítko nebo skutečné podržení

### Chování

- Pravé tlačítko otevře bod a kontextové menu okamžitě. Na macOS ověřit i Ctrl+klik a kontextové gesto trackpadu.
- Levé tlačítko / jeden prst: aktivace po 650 ms nepřerušeného podržení. Doba se počítá od stisku, nikoli od zastavení kurzoru.
- Pohyb přes 8 CSS px, puštění před limitem, druhý prst, drag/zoom, `pointercancel`, ztráta zachycení, opuštění okna nebo skrytí stránky časovač ruší.
- Hover zůstává pouze lokální vizuální nápovědou. Deset sekund nehybného kurzoru nesmí vytvořit bod ani HTTP požadavek.
- Jedno podržení vytvoří právě jeden dočasný bod. Uvolnění nevygeneruje další běžný klik, výběr hranice ani druhé kontextové menu.
- Klik na existující pin nadále otevírá pin. Ovládací prvky a panely se nikdy nestanou místem mapového gesta; režimy editace a aktivního pickeru mají vlastní prioritu. Herní pravidla zachovat.
- Menu je přístupné klávesnicí, vejde se do mapového výřezu a zavírá se křížkem, Escape nebo kliknutím mimo. Zavření zruší nepoužívaný geokódovací požadavek a dočasný bod.

### Implementace

Vyjmout rozpoznávání gesta ze `world/socialMap.ts` do malého modulu mapových gest. Použít jeden stavový automat nad pointer událostmi canvasu; nedržet souběžně nezávislé mouse/touch časovače. Nenarušit posun mapy před dosažením limitu. Navázat na `contextGesture.ts` a `MapPlaceContext.tsx`, kde zůstanou současné akce „Zanechat zprávu“, „Přidat do trasy“, „Uložit místo“. Suppression navázat na dokončené gesto, aby neblokovala libovolné další klikání po dlouhý pevný interval.

## 4. Jednotný a pravdivý stav vrstev

### Sdílený model stavu

Rozšířit existující `LayerEngine`, `TaskRegistry`, store a browserové informace o poskytovatelích. Drawer a logo musí používat stejný odvozený stav, ne vlastní nezávislé časovače nebo odhad z textu chyby.

| Stav vrstvy                              | Zobrazení u ikony                        | Krátký text / akce                                            |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Vypnuto                                  | běžná neaktivní ikona                    | bez spinneru                                                  |
| Čeká ve frontě                           | jemný prstenec / hodiny                  | „Čeká na načtení“                                             |
| Načítá data                              | spinner kolem zachované ikony            | „Načítám…“                                                    |
| Připravuje mapu                          | stejný prstenec                          | „Vykresluji…“ jen při skutečně trvajícím kroku                |
| Aktuální                                 | malá zelená značka                       | „126 míst“ nebo „Dlaždice připravené“                         |
| Platná prázdná odpověď                   | neutrální značka                         | „V této oblasti 0 výsledků“                                   |
| Částečné / starší výsledky               | žlutá značka                             | „126 míst · částečné“ / „Starší data“                         |
| Chyba                                    | červený vykřičník                        | „Zdroj neodpověděl“ + Opakovat                                |
| Mimo zoom / pokrytí / čeká na Hledat zde | neutrální nebo žlutá značka podle důvodu | „Přibližte mapu“ / „Mimo pokrytí“ / „Obnovit pro tento výřez“ |

Barva není jediný nositel významu. Zachovat původní ikonu a barvu kategorie, spinner překryje její okraj. Stav je dostupný tooltipem i klepnutím; detail otevře krátký popover s opakováním konkrétní vrstvy. Přepínač stále znamená zapnutí vrstvy, nikoli úspěch poskytovatele. Aktualizace stavu nesmí měnit pořadí řádků, filtry ani scroll draweru.

Použít společný indikátor pro `PoiLayerRow`, kategorie OSM v `CategorySection`, počasí, statistiky, rastrové overlaye a zdrojové řádky `WorldSection`. Stav dostupnosti statistických dat nezaměňovat s chybou načítání. U kategorie filtrované uvnitř společného OSM dotazu zobrazit sdílený stav požadavku a její vlastní počet; nevytvořit nový dotaz na každou ikonu.

### Správné dokončení a zneplatnění

- Každá generace dotazu má identitu zahrnující vrstvu, bbox/pokrytí, filtry, zdroje, čas, oblast a revizi hranic. Starší odpověď nesmí přepsat data ani zelený/červený stav novější generace.
- Zařazení do fronty se projeví ihned po zapnutí. Rušení při vypnutí nebo novém dotazu není chyba služby.
- U POI rozlišit přijaté záznamy, deduplikovaná místa a výsledky aktuálního filtru. Při stránkování nesčítat opakované záznamy.
- `unavailable` nesmí být úspěšný výsledek tasku. Platné prázdno je úspěch s nulou; částečný výsledek zůstává označený.
- U rastru/MVT stav vychází ze skutečného načítání zdroje a potřebných dlaždic aktuálního výřezu. Samotné `addSource`/`update(): null` není zelený stav. Jedna úspěšná dlaždice nesmaže chybu ostatních.
- Při změně stylu odstranit staré listenery a znovu připojit nové source ID. Částečná chyba se nesmí držet navždy kvůli dlaždici výřezu, který už uživatel opustil.

MapLibre přímo používá workerové rozbalení clusteru v [oficiálním příkladu](https://maplibre.org/maplibre-gl-js/docs/examples/create-and-style-clusters/). Konkrétní API událostí zdrojů a jeho payload ověřit proti **nainstalované verzi**; tento rozsah není důvod k upgradu celé mapové knihovny.

### Kompaktní Map status v logu

Nahoře např. „8 vrstev · 6 aktuálních · 1 načítá · 1 částečná“. Pod tím jeden řádek na aktivní vrstvu, rozbalitelný na poskytovatele. Například:

| Vrstva                 | Stav       | Poslední načtení                         |
| ---------------------- | ---------- | ---------------------------------------- |
| Místa / OSM            | 126 míst   | 0,8 s · 84 kB · síť                      |
| Počasí / zvolený model | připraveno | 0,3 s · mezipaměť                        |
| Cyklotrasy             | částečné   | 18 tras · 1 zdroj neodpověděl · Opakovat |

Čísla v této tabulce jsou návrh UI, nikoli naměřený výsledek. Posledních nejvýše 100 událostí uchovávat lokálně v omezeném bufferu; výchozí pohled zobrazuje současný stav a nejvýše několik posledních událostí. Existující limity `TaskRegistry` využít.

Telemetrie potřebuje doplnit přenosové bajty a počty záznamů/dlaždic do typů, schématu, validátoru i adaptérových odpovědí. Rozlišit:

- dobu požadavku a čekání ve frontě;
- přenos do prohlížeče a přenos poskytovatel → API; neprezentovat je jako stejnou veličinu;
- skutečně měřené přenosové bajty, velikost dekódovaného payloadu a nedostupné měření;
- cache hit a skutečný síťový přenos. Chybějící `Content-Length` nebo omezené Resource Timing znamená „nezměřeno“, nikoli 0 B;
- počty pinů oproti počtům buněk/dlaždic počasí. Počasí nemá hlásit „0 pinů“ jako výsledek.

Sdílený požadavek započítat do celkového přenosu jen jednou. Log neprovádí dodatečné health pingy: stav je „poslední odpověď před…“, ne nepodložené „služba právě funguje“. Nezapisovat URL s klíči, přesné soukromé souřadnice, vyhledávání nebo obsah poznámek. UI publikovat seskupeně nejvýše 4× za sekundu, ne při každé dlaždici do celého React stromu.

## 5. Počasí: jemnější pole a nízká časová lišta

### Vykreslení oddělené od vzorkování

Zachovat limit 144 vstupních bodů na dotaz a běžné rozpočty 48/80/120 bodů, dokud měření neprokáže potřebu jiného zdroje. Jemnější kresbu vytvářet na klientovi z již načteného pole. Interpolace nepřidává meteorologickou přesnost; název modelu a čas platnosti proto zůstávají dostupné.

Výchozí nastavení pro první implementaci:

| Zoom     | Výsledné zobrazení                                        | Rozpočet kresby    |
| -------- | --------------------------------------------------------- | ------------------ |
| Pod 6    | souvislé pole, volitelně řídké hodnoty bez čar mřížky     | nejvýše 24 popisků |
| 6–8,5    | jemnější buňky a čísla uprostřed dostatečně velkých buněk | nejvýše 320 buněk  |
| 8,5–10,5 | plynule navazující jemnější buňky                         | nejvýše 480 buněk  |
| Od 10,5  | hodnoty ve stejném typu buněk, bez skoku na hrubší mřížku | nejvýše 480 buněk  |

Tyto hodnoty jsou start pro porovnání na desktopu a telefonu. Cílová hrana buňky přibližně 70–110 CSS px, řízená skutečnou plochou mapy; telefon nepotřebuje stejný počet buněk jako desktop. Nejvýše 96 čísel na desktopu / 48 na telefonu, bez překryvu. Hodnota se centruje do vykresleného čtverce/obdélníku, včetně oříznutých krajních buněk. Příliš malé buňky mohou být bez čísla, detail je dostupný lokálním tapem.

Poloviční strana čtverce znamená čtyřnásobek polygonů, ne dvojnásobek. Proto nepřepsat jen konstantu „počet vzorků“. Oddělit `sampleGrid` a `displayGrid`; vizuální mřížku ukotvit ke stabilnímu geografickému/Web Mercator rastru dané úrovně, aby se neposouvala při každém panování. Resampling nesmí vyplňovat neznámé hodnoty přes díry ani extrapolovat za dostupné pokrytí.

### Plynulý zoom a čas

- Uchovat poslední platný grid v handle. Změna vizuální úrovně v jeho pokrytí přepočítá kresbu lokálně bez čekání na `loadGrid`.
- Rozpočet kresby měnit přes stabilní pásma s hysterézí přibližně ±0,25 zoomu. Během gesta používá mapa stávající geometrie; neprovádět interpolaci/canvas pixelovou smyčku na každém `zoom` eventu.
- Nový dotaz pouze pro jiné datové pokrytí, čas, model, veličinu nebo skutečně potřebnou vzorkovací úroveň. Sloučit stejné požadavky a zachovat existující snap/cache na serveru.
- Při obnově ponechat poslední pole se správně uvedeným starším časem a stavem načítání. Při změně veličiny nezobrazovat starou teplotu jako nový déšť; použít označený přechod nebo starou veličinu skrýt.
- Nový snímek přepnout až po připravení celého příslušného renderu. Nejvýše dva přechodové snímky, přechod 120–180 ms; reduced-motion bez přechodu. Nevytvářet neomezené image/GeoJSON zdroje.
- Profilovat 320×320 canvas a generování GeoJSON. Prvním krokem je odstranění opakované práce a alokací. Worker pro interpolaci přidat, pokud profil ukáže main-thread blokování; nevyžaduje změnu poskytovatele.
- Jeden foreground grid dotaz. Playback čeká na potvrzení zobrazeného snímku; při chybě se pozastaví s Opakovat. Volitelně připravit nejvýše jeden následující snímek při volné kapacitě; Low Data bez prefetch.
- Zajistit skutečně použitelné fonty hodnot po každé změně podkladu; testovat rastr, satelit i vektor. Již existující výběr fontu ze stylu zachovat a doplnit o obnovu vrstvy při změně stylu.
- Hover nad buňkou nevytváří bod, negeokóduje, nespouští fetch a nepřestavuje časovou lištu. Drobný tooltip používá hodnotu už v mapě; tap může detail připnout.

### Časová lišta

Upravit současný `TimelineHost`. Cíl: jedna nízká plocha, přibližně 52–64 px na desktopu, nejvýše 80 px na telefonu včetně popisků dnů.

Návrh pořadí: **Teplota · út 14:00 → posuvník s dny → Play/Pause → ×**. Play je jediná transportní akce na konci posuvníku. „Teď“ je jednoduchý dosažitelný bod/reset, nemusí tvořit další řádek. Vybraná hodina se ukáže nad jezdcem; dny se nezkracují do nečitelnosti.

- Odstranit medián výřezu z výchozí mapové plochy.
- Odstranit velkou legendu. Barevná stupnice, jednotky, model, čas platnosti a vysvětlení interpolace jsou v malém informačním popoveru u názvu veličiny; krátký model/čas může zůstat v jedné podpůrné řádce.
- Všechna zavírání v upravovaných plochách používají existující `IconButton` s ikonou `close` a srozumitelným aria-label. Nepoužívat text „Skrýt“ ani `close_fullscreen` jako zavírací křížek.
- Křížek lištu minimalizuje, pozastaví playback a ponechá počasí na posledním zobrazeném čase. Malý časový chip ji znovu otevře; vypnutí počasí zůstává v přepínači vrstvy.
- Rozsah a kroky odpovídají dostupným datům. Radar pracuje se skutečnými snímky historie, nenabízí sedmidenní radarovou předpověď. Model bez hodnot pro určitý den jej označí jako nedostupný.
- Posuvník při tažení mění lokální náhled času; commit po puštění nebo po existujícím debouncu, ne dotaz na každý pixel. Při ovládání klávesnicí musí commit fungovat také.
- Zachovat jediný společný časový stav a kompatibilitu se statistickými obdobími/událostmi. Kompaktní počasí nesmí znovu otevřít skrytou neužitečnou trip timeline.

## 6. Podklady: opravit zdroj náhledu

- Odstranit chip „Follow light/dark“ z karet. Nezaměnit tuto úpravu za změnu globálního tématu aplikace. Aktivní název, zvýraznění a náhled musí odpovídat skutečně vykreslenému stylu po `resolveBasemap`.
- CARTO Positron: doplnit do generování a vytvořit skutečný WebP Berlína stejného výřezu. ÖPNV-Karte: doplnit chybějící výstup a ověřit současnou dostupnost původních dlaždic.
- Esri Imagery/Topo: využít skutečný náhled z nakonfigurované služby obdobně jako Mapy, podle pravidel provozu konkrétního endpointu; neprohlašovat automaticky oprávnění k redistribuci statického screenshotu. Ověřit pořadí `{z}/{y}/{x}`. Stávající Mapy náhledy zachovat.
- Společná definice preview: zdroj, bbox Berlína, zoom, crop, atribuce a fallback. Pozor: samotná dlaždice obsahující Berlín a screenshot kamery nad středem Berlína nejsou totožný výřez; sjednotit podle bbox/crop, ne pouze názvu města.
- Jeden malý lazy obrázek na viditelnou kartu. Nepouštět jednu živou instanci MapLibre na každou kartu. URL s klíčem zůstávají na serveru; proxy přijímá jen známé poskytovatele/typy.
- Kontrola buildu: každá karta má existující soubor nebo ověřitelný resolver. Browser smoke ověřuje `img.decode()`, nenulové rozměry a vizuálně skutečný obsah, ne jen HTTP 200. Při chybě jasný fallback a omezené opakování po dalším otevření pickeru.

## 7. Clustery, které přibližují a vysvětlují obsah

### První část: odstranit agresivní shlukování

Výchozí měřítko města stanovit na zoom 12: od něj jednotlivé piny, pod ním lehčí proximity clustering. Začít s `clusterMaxZoom: 11`, poloměrem 32–36 px; přesnou hranici ověřit na Tarragoně, Praze, malé obci a mobilu. V respektovaných specifických manifestech může být jiná strategie, například osobní uložená místa. Změnu aplikovat na společný renderer, ne jen na deklaraci manifestu, kterou renderer nepoužívá.

- Běžný klik na cluster, včetně 2–3 bodů, nejprve přiblíží. Odstranit pevný přechod do seznamu při rozbalovacím zoomu nad 14.
- U malého clusteru načíst listy ze stávajícího workerového indexu a přiblížit na jejich bbox s paddingem pro panely. U velkého použít `getClusterExpansionZoom`; nekopírovat tisíce listů jen pro animaci kamery.
- Když body mají stejné nebo téměř totožné souřadnice, dočasně je rozevřít kolem místa v kruhu/vějíři, s krátkou spojnicí do původního bodu. Obsloužit překryvy i napříč vrstvami po vypnutí běžného clusteringu.
- Rozevření mění pouze obrazovou polohu interakčních ikon; původní GPS, detail, ukládání a trasy používají původní místo. Max. 12 rozevřených položek; větší skutečný souběh nabídne navazující seznam jako fallback. Tři body nikdy nevynutí dialog.
- Změna výřezu/pinu, Escape a klik mimo rozevření zavře. Asynchronní listy starého indexu se zahodí po změně zdroje nebo filtru. Hover/rozevření nepotřebuje HTTP.
- Kategorie zůstávají rozlišitelné ikonou i barvou. Ikony vykreslit přes GPU vrstvy, ne tisíce DOM markerů. V detailním měřítku neukrývat piny kolizním algoritmem, omezovat především textové názvy.
- Zobrazení jednotlivých pinů neznamená požadavek na všechny evropské POI. Zachovat viewport, oblast, filtry, deduplikaci a rozpočty stránkování. Je-li výsledek omezený, stav vrstvy to výslovně uvádí.

### Druhá část: souhrny podle obcí

Pro regionální pohled připravit kompaktní symbol obce: název, počet míst vybraných vrstev, nejvýše dvě hlavní kategorie; po hoveru lokální rozpad „restaurace 18 · bary 4 · hrady 1“. Při přiblížení do obce přejít k jednotlivým bodům. Velká města lze dál členit pouze podle skutečně dostupných městských částí. Bez nich použít prostorový přehled, ne vymyšlené čtvrti.

Toto není vlastnost pouhého pixelového clusteru. Vyžaduje stabilní přiřazení POI k `AreaSelection`/revizi hranic a dotaz na souhrny:

- Lokálně indexovaná data přiřadit k obci v importu nebo cache tabulce; zachovat ID a nové dopředné migrace. Body na hranici přiřadit deterministicky pouze jednou, respektovat díry/ostrovy; prostorově otestovat.
- Souhrnný dotaz filtruje aktivní zdroje, kategorie, oblast, čas i oprávnění **před agregací**, vrací `areaId`, `revision`, název, bbox, bod uvnitř oblasti, `countsByCategory`, počet jedinečných míst, stav úplnosti a čas dat.
- Počty napříč poskytovateli odvodit od kanonických ID. Jeden podnik ve třech katalozích není třikrát tolik míst; počet kategorií nemusí být automaticky součtem jedinečných míst.
- Pro poskytovatele bez lokálního úplného indexu agregovat jen už načtené výsledky a označit „z načtených míst“ / „částečné“. Nestahovat všechny detaily obcí ani všechny externí POI pro získání hezkého čísla.
- Sdílená veřejná cache neobsahuje soukromé výsledky. Soukromé části se doplní odděleně podle identity uživatele; nepřidávat je do veřejných MVT.
- Klik na souhrn obce přibližuje; nesmí potají změnit aktivní vrstvy nebo výběr oblasti. Výběr hranice nadále používá současná explicitní pravidla. Ověřit priority klikání mezi piny, souhrny a polygony.
- Rozpočet nejvýše 300 souhrnných symbolů výřezu. Když je obcí více, použít přehled další úrovně se správným názvem nebo označenou prostorovou agregaci. Nevyřadit náhodně přebytečné obce.

Tuto část evidovat jako samostatný krok dokončení: snížení cluster zoomu samo o sobě ještě neplní požadavek „jeden souhrn za obec“.

## 8. Levý panel: užitečný obsah rovnou

### Pořadí v jednom scrollu

1. Název, typ a fotografie; galerie a jasný vstup „Ulice / panorama“ hned vedle nebo pod fotografiemi. Fotografie už dostupné v přehledu se zobrazí okamžitě.
2. Základní akce místa: uložit, trasa, přidat do plánu, zpráva.
3. Krátký úvod Wikipedie a přehled nejdůležitějších Wikidata faktů s označením zdroje. Další text lze rozbalit uvnitř konkrétní sekce, nikoli přes obecné „Více“.
4. AI souhrn pod zdrojovými fakty; doplní se později do svého místa. Nečekat s fotografií a fakty na AI, ani spouštět dva různé souhrny stejného místa.
5. Praktické údaje a odkazy: adresa, dostupné otevírací hodiny, kontakty, web, případné vstupné a další data povolená manifestem.
6. Dostupné další informace, například geologie a okolí, jako pojmenované sekce.
7. Počasí / Windy samostatně níže.
8. Recenze poskytovatele a komentáře MapOS jako viditelně pojmenované oddělené bloky; soukromá poznámka jasně označená.

Panely nejsou výchozím stavem schované v záložce „Více“. Malá řádka odkazů může scrollovat k Fotkám / Faktům / Komentářům, ale obsah nezakrývá. Sekce s dostupnými daty mají být otevřené. Chybějící volitelné údaje nesmějí zanechat řadu obřích prázdných karet.

### Odhalení obsahu bez laviny požadavků

- Registry a existující komponenty zachovat. Nahradit podmínku „mount pouze vybraný tab“ prioritou a vzdáleností sekce od viditelného výřezu panelu.
- Ihned vykreslit lokální údaje, potom souběžně s omezením nejvýše 3 lehké požadavky: detail/fakta/náhled. Sdílet identitu místa, wiki/foto resolvery a jejich cache. Neopakovat stejný Wikidata lookup pro hero a fakta.
- Fotky načítat jako náhledy správné velikosti; originál až ve stávajícím fullscreen prohlížeči. Low Data zachová výslovné načtení médií a vypne sousední prefetch.
- Ulice/panorama má viditelnou kartu nahoře. Dostupný bezpečný náhled načíst levně; interaktivní Mapillary/360 widget až po aktivaci karty. Není-li pro místo ověřené pokrytí, uvést to místo prázdného obřího iframe.
- Windy karta a komentáře jsou viditelné v toku stránky. Lehké komentáře načíst při přiblížení k jejich sekci; těžký iframe Windy aktivovat až při viditelnosti sekce, v Low Data po kliknutí. Pouhé vytažení nadpisu nesmí okamžitě spustit všechny embed probe a widgety.
- Zachovat `EmbedFrame`, jeho sandbox a fallback. Opravit jeho rozlišení „zdroj nedovoluje vložení“ versus „ověření se nepovedlo“; nynější společný text tyto situace zaměňuje.
- `PlaceAiBrief` a `BriefPanel` mají mít jedno místo v detailu. Pro pin shrnovat tento pin a jeho ověřená data; pro Discover oblast shrnovat vybranou oblast se správnou identitou. Neslévat automaticky dva odlišné kontexty.
- Každá sekce má vlastní loading/empty/error a retry. Změna pinu zruší staré požadavky, resetuje starý obsah a nepřepíše nový detail. Aktualizovat `useInfoData` i foto resolver: signal/počet odběratelů, ochrana proti pozdnímu výsledku a omezená cache chyb.
- Rezervovat rozumný poměr stran médií a místo pro souhrn. Pozdní AI nebo snímek nesmí odsunout právě čtený text mimo viewport. Nepřidávat stovky pixelů skeletonu pro widget, který se ještě nenačítá.

Sjednotit zásady také s `DiscoverPanel.tsx`, který má vlastní skládání regionálního průvodce a accordion. Nenutit jej zobrazovat pole určená jen konkrétnímu POI.

ADR 0004 dnes přikazuje pět povrchů detailu. Nový uživatelský požadavek mění jejich prezentaci; aktualizovat ADR na jednotný scroll a ponechat oddělení vlastnictví obsahu, validaci polí a médií. Nezachovávat „Více“ jen kvůli starému návrhu a nevytvářet vedle `InfoEngine` druhý detail.

## 9. Pořadí realizace a předání

| Krok | Obsah                                                              | Závislost / výstup                                     |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| 0    | Zaznamenat současné browser scénáře, přenosy, zdroje a výkon       | stejné zařízení, data a viewporty pro kontrolu před/po |
| 1    | Oprava gest, křížků, chybějících náhledů a chipů tématu            | malé samostatně ověřitelné změny                       |
| 2    | Jednotný stav dotazů včetně fronty, partial, rastrů a chyb         | základ pro spinner u vrstev, logo a readiness počasí   |
| 3    | Indikátory v draweru a kompaktní diagnostika                       | stav souhlasí s reálnými požadavky a mapou             |
| 4    | Jemnější počasí, oddělený lokální render, kompaktní čas a playback | žádné navýšení odběru jen kvůli hustotě kresby         |
| 5    | Dřívější konec proximity clusterů, přiblížení a rozevření souběhů  | ve městě jednotlivé piny, 2–3 body bez dialogu         |
| 6    | Lineární detail, fotografie/ulice/fakta před AI, lazy widgety      | informace viditelné bez záložky Více                   |
| 7    | Administrativní souhrny obcí a kategorií                           | přesná identita, deduplikace a pravdivá úplnost        |
| 8    | Porovnání měření, veřejná kontrola a nasazení standardní cestou    | release report s výsledky a skutečně zbývajícími úkoly |

Kroky mají být oddělené tak, aby případný problém agregačního dotazu neblokoval opravu gest. Všechny však patří do tohoto plánu; dokončení kroku 5 není vydáváno za dokončení kroku 7. Nové migrační změny pouze dopředně, zachovat staré identity, manifesty a rollout kompatibilitu.

## 10. Akceptační scénáře a měření

### Funkčnost

- Gesta: hover 10 s bez bodu/HTTP; krátký klik; podržení myši; pravý klik/Ctrl+klik; touch 650 ms; pohyb 9 px; dva prsty; zrušení; gesto nad ovládacím prvkem; žádný dvojitý výběr po uvolnění.
- Počasí: teplota/vítr/srážky na zoomech 5,5 / 6,5 / 8,5 / 10,5 / 12; pomalý i rychlý zoom tam a zpět; hodnoty uprostřed buněk; null data bez vymyšlených hodnot; změna modelu a času; stará odpověď se zahodí.
- Počasí playback: server 200 ms, 2 s, timeout a 429; přehrávání nehoní čas rychleji než připravené snímky. Radar nepředstírá budoucnost. Křížek pozastaví a umožní vrátit lištu.
- Podklady: všechny čtyři opravené náhledy v light/dark; img decode a vizuální kontrola; mapa i vybraný náhled odpovídají stejnému stylu; během scrollu pickeru nevznikají mapové instance.
- Stavy vrstev: fronta, cache, 0 výsledků, průběžná stránka, částečné upstreamy, neodpovídající dlaždice, vypnutí během požadavku, rychlá změna filtrů/oblasti. U kategorií a zdrojů správné přiřazení ke sdílenému dotazu.
- Clustery: 2, 3, 20 a 1 000 bodů; přesné souběhy a souběhy napříč vrstvami; panely při fitBounds; jednotlivé piny od městského zoomu; viditelný stav při limitu výsledků.
- Obecní souhrny: filtr před agregací, deduplikace více providerů, bod na hranici/díra/ostrov, přesná revize, částečný upstream a oddělení soukromých dat. Změna vrstvy okamžitě změní souhrn.
- Detail: místo s fotkou a QID, místo bez QID, bez fotografie, nedostupné wiki, chyba AI, nedostupný embed, rychlé přepínání pinů, fotografie/fullscreen/ulice, komentáře a soukromé poznámky.
- Tarragonsko, Praha a malá obec; mobil 390×844 a desktop 1440×900; satelit/Mapy/CARTO; česká/anglická lokalizace, reduced-motion, Low Data, pomalá síť.

### Výkonnostní brány

Zaznamenat model zařízení, browser/verzi, DPR, viewport, aktivní vrstvy, počet skutečných POI a teplou/studenou cache. Použít stejné uložené odpovědi pro render test a zvlášť živé poskytovatele pro síťový test. Nelze odvozovat odezvu UI z rychlosti loopback HTTP na VPS.

- Hover a rozevření již načtených bodů: **0 HTTP**. Změna opacity, číslic a vzhledové hustoty počasí: **0 dodatečných grid dotazů**, pokud stávající grid pokrývá výřez.
- Cíl lokálního hoveru p95 do 50 ms; kladně potvrdit měřením, ne pouze malým počtem prvků.
- V porovnání 6/12 vrstev musí nový render počasí snížit nebo alespoň nezhoršit hlavní blokující práci. Cíl bez úloh nad 50 ms způsobených opakovaným přepočtem počasí při plynulém zoomu; při nesplnění profil a worker/omezení aktualizací.
- Po 30 cyklech zapnutí/vypnutí, změně podkladu a otevření detailu se počet zdrojů a listenerů vrací na výchozí hodnoty. Paměť se po uvolnění ustálí, neroste s každým cyklem. Zveřejnit naměřená čísla, ne univerzální slib pro všechny telefony.
- Detail zobrazí lokální snapshot nejpozději v následujícím renderu; fotografie a fakta nejsou blokované dokončením AI. Žádný Windy/Mapillary iframe mimo stanovenou aktivaci.
- Bajty počasí nad stejnými vzorky se nezvýší kvůli jemnější kresbě. Bajty detailu porovnat pro první obrazovku a zvlášť po otevření galerie/widgetů.
- Telemetrie se nesmí stát novým zdrojem full-tree renderů nebo další síťové zátěže. Funkční testy doplnit krátkým profilem při 12 vrstvách.

Výstup implementace: nasazená verze po standardních kontrolách zálohy/obnovy/kompatibility, screenshoty mobilu a desktopu, výsledky scénářů a tabulka před/po. Nedokončené administrativní souhrny, nedostupné panoramy, neúplné pokrytí nebo nezměřené bajty musí zůstat výslovně označené.

## 11. Implementační doplněk 2026-09-06

- Environmentální bodové zdroje iNaturalist, GBIF a Sensor.Community dostaly minimální zoomové
  prahy. Na kontinentálním výřezu už nevyvolávají odmítnuté dotazy; po přiblížení se načtou jako
  body a stav „přibližte mapu“ je viditelný v Map status.
- EMODnet Bathymetry má číselný grid přes nový serverový adapter. Ten vzorkuje GetFeatureInfo,
  drží nejvýše 48 vzorků, cacheuje 15 minut a v prohlížeči vykreslí barevné buňky s hodnotou v
  metrech; nad pevninou ponechá hodnotu prázdnou. Původní barevná WMS dlaždice se tím nepřekrývá
  s druhým nepřeložitelným významem.
- Události mají vlastní sekci v draweru a zachovávají existující filtry kategorií, ceny,
  vzdálenosti a místa. Bezpečné toalety jsou v kategorii Komunitní služby se zachovanými filtry.
- Kliknutí na logo otevře Map status včetně přepínače světů. Logo mění barvu a drobný symbol podle
  zvoleného světa; přepnutí zapne jeho doporučené vrstvy a při návratu z Aavegotchi vypne herní
  renderer.
- Náhledy podkladů pro ÖPNV, CARTO Positron a Esri World Imagery/Topo používají skutečnou berlínskou
  dlaždici; rušivý text „Follow light/dark mode“ byl z karty odstraněn. Počasí má jemnější popisky,
  menší legendu a časová lišta už nevynáší medián celého výřezu.

Zbývá ověřit na veřejném vydání, že aktivní statistické importy odpovídají očekávané zemi a že
dlaždice WMS nejsou blokovány konkrétní sítí. Chybějící statistické série se nemají maskovat
syntetickými hodnotami; jejich doplnění patří do importní pipeline.
