# Foursquare aktivace a webkamery — rozšíření master plánu

Stav 8.9.2026: Foursquare a Windy čekají na aktivaci. Otevřený místní katalog kamer je implementovaný. Navazuje na T07/T09 a přidává T11b; nepřidává druhý katalog, request manager ani galerii.

## Foursquare: konkrétní cesta ke spuštění

Implementace Pro záložky a persistentního rozpočtu je nasazena. Chybí ověřený zůstatek účtu, aktuální oprávnění a náhradní serverový klíč. Použít [existující provozní postup](2026-09-07-provider-budget-activation.md), ne druhou implementaci.

1. V Developer Console otevřít organizaci MapOS, aktuální Places API projekt a billing/usage. Zaznamenat skutečné období, dosavadní spotřebu a sdílení s dalšími projekty. Oficiální [oznámení cen](https://docs.foursquare.com/developer/reference/upcoming-changes) uvádí od června2026 prvních500Pro volání zdarma; dostupný zůstatek konkrétního účtu tím není doložen.
2. Ověřit token pro nové Places API, vytvořit náhradní serverový klíč a uložit jen do VPS secret konfigurace. Klíč z konverzace nekopírovat do plánu, bundle ani logů. Starý zrušit po ověření přechodu.
3. Přidělit ověřený zůstatek přes stávající allocate CLI: nejvýše450za období a15denně, Premium0. Pokud už byly spotřebovány jednotky jinde, grant snížit. Bez ověření/DB/grantu zůstane služba vypnutá. Nové období neobnovovat naslepo.
4. Nastavit existující FSQ_API_KEY, FSQ_BUDGET_ACCOUNT a FSQ_PLACES_ENABLED podle runbooku, restartovat pouze potřebnou službu. Nezapínat žádný automatický enrichment.
5. Ověřit v prohlížeči: start/hover/jiná záložka0volání; otevření Foursquare záložky jeden Pro požadavek. Neznámé ID hledá nejvýše3kandidáty v200m; výběr už vráceného kandidáta nesmí vytvářet další detail call. Nejednoznačnost musí vyřešit uživatel.
6. Každý skutečný aktivační test započítat do rozpočtu. Synteticky ověřit vyčerpání, restart, souběh a nedostupnou DB bez vyčerpávání účtu. Zkontrolovat absenci Premium polí a tajemství v logu/exportu.
7. Při problému vypnout flag; vlastní a otevřená místa fungují dál. Do tabulky zapsat datum aktivace, oprávnění, ověřený grant a živý výsledek, bez tajemství.

Otevřený FSQ OS Places je samostatná práce: Places Portal/Iceberg token a regionální import ES/CZ. Jeho import neřešit procházením Pro API. API data neslévat do otevřené databáze. Přístup: [FSQ OS Places](https://docs.foursquare.com/data-products/docs/access-fsq-os-places).

## T11b: veřejné webkamery nad mapou

**Aktualizace8.9.:** Vrstva nyní spojuje místní katalogy CartoCams/OSM, Fintraffic a ověřený malý výběr Open Data Hub bez klíče.10217záznamů, samostatné filtry zdrojů; snímky se automaticky nenačítají. [Výzkum, import a rozvoj](../research/2026-09-08-open-webcams.md). Windy níže je volitelný doplňkový poskytovatel, ne podmínka použití vrstvy.

### Produkt a zdroje

Překryv znamená kategorii pinů s ikonou kamery, ne video roztažené přes geografický povrch. Georeferencované video/frustum odložit: chybí kalibrace kamery a povrch. Kategorie ve stávajícím draweru „Webkamery“, výchozí vypnuto; pláže, hory, města, doprava a ostatní podle skutečných kategorií zdroje. Nezaměňovat s počasím/Windy widgetem ani panoramatem.

Volitelný doplňkový poskytovatel: [Windy Webcams API v3](https://api.windy.com/webcams/docs). Vyžaduje samostatný Webcams API klíč; současný weather embed jej nenahrazuje. Aktivovat pouze Free variantu, bez nákupu Professional. [Ceník](https://api.windy.com/webcams/pricing) dovoluje omezené obrázky s odkazem a vložený timelapse přehrávač. Neoznačovat timelapse jako živé video. Zobrazovat skutečný čas pořízení a provozovatele.

Doplňkové městské/turistické/dopravní oficiální feedy až po jednotlivém ověření distribučního endpointu, licence, pokrytí a stáří. OSM odkaz není důkaz streamu ani oprávnění vložení. Žádné hledání soukromých kamer, skenování IP ani archivování záběrů. Neprovádět rozpoznávání osob nebo předávat záběry automaticky AI.

### Navazující implementace volitelného Windy a přehrávače

1. Existující adaptér `webcams` a společný katalog rozšířit o volitelný provider Windy; nevytvářet druhou vrstvu se stejným ID. Klíč v serverovém headeru `x-windy-api-key`, nikdy URL nebo klient. Konfigurace defaultoff, capability se zapne až s ověřeným přístupem.
2. Dotaz bbox + kategorie + aktivita; zpočátku odzoom9, maximální šířka výřezu200km. Větší výřez vrací „Přibližte mapu“. Jeden požadavek nejvýše50kamer, žádné automatické stránkování. Více výsledků označit částečné; uživatel přiblíží nebo výslovně načte další stránku. Parametry bbox a include odvodit z aktuálního v3 kontraktu, ověřit fixture proti playgroundu. Kategorie spojit OR explicitně, v3 může jinak použít AND.
3. Transport použije současný AbortSignal, sdílení a generace. Náročná vrstva po posunu čeká na „Hledat zde“; filtr spustí bounded dotaz hned. Seznam nenačítá obrázky ani playery. Do overview jen stabilní provider:id, název, bod, kategorie, dostupnost, čas a atribuce.
4. Metadata cache omezená na128výřezů/4MiB; TTL a uchovávání potvrdit podle podmínek před aktivací. Neschovávat podepsané media URL do dlouhodobé cache/uložených míst. Backend nesmí být obecný relay libovolných adres.
5. Hover využívá současný PinPreview a lokální ikonu; nula HTTP. Klik otevře stávající detail s oddělenou sekcí Kamera. Až akce „Načíst snímek“ nebo „Přehrát“ načte čerstvý detail zdroje a povolený embed. Jeden aktivní přehrávač; close, přepnutí pinu, skrytí stránky a vypnutí vrstvy jej odpojí. Low Data žádné preload ani automatické aktualizace snímků.
6. Windy dokumentace uvádí expiraci free obrazových tokenů10minut, aktuální ceník15minut. Rozpor nezamaskovat fixním slibem. Pracovat s doručenou expirací, jinak konzervativně kratší; po401 obnovit detail nejvýše jednou na explicitně otevřené kameře, pak srozumitelná chyba. Neměnit podepsanou URL ani velikost obrázku nad dovolený originál.
7. Stav kamery oddělit od úspěchu API: čas snímku, offline/neznámý, snapshot/timelapse/live pouze podle zdroje. „Aktivní“ neznamená právě živý přenos. Zastaralý snímek označit; žádný nekonečný spinner.
8. Přes existující embedService zavést úzký allowlist ověřených player hostů a CSP, sandbox dle potřeb přehrávače. Libovolné user URL nejprve validovat; server nesmí stahovat interní/private adresy ani následovat redirect mimo schválený zdroj. Neopravovat embed blokaci skrytou proxy.
9. Finančně žádný auto-upgrade. Provozní startovní strop100serverových callů/den globálně a10/min je interní ochrana, nikoli tvrzení o kvótě Windy. Využít současnou persistentní bránu s odděleným produktem až po ověření pravidel Free účtu; neodvozovat bezplatnost z těchto čísel. HTTP429 respektuje Retry-After a nevyvolává automatickou retry bouři.

### Akceptace a aktivace

- Bez klíče konkrétní „Vyžaduje aktivaci“, žádný request. Veřejný klíč ani podepsané URL se neobjeví v logu.
- Start/hover/posun se skrytou vrstvou0provider requests; žádné iframe nebo obrazové fetch při seznamu.
- Test bbox/kategorií,50limit/partial, unknown/offline/time,401jednaobnova,429,timeout,abort,rychlé přepnutí kamer a expirovaný token.
- Browser desktop/mobil/Low Data/reduced motion; opakovaně20otevření/zavření nezvyšuje počet iframe/listenerů a nehrají dvě kamery současně.
- Pilot Tarragona a Praha se skutečným časem a atribucí. Prázdný výřez neznačí rozbitou vrstvu, ale neexistenci vrácených kamer. Pokrytí celé Evropy neslibovat.
- Nejdříve fixture implementace a vypnutý flag; živá aktivace po získání Webcams klíče a ověření podmínek. Vydání přes existující zálohu/smoke postup. T12 AI může použít metadata kamery jako citovaný zdroj, ne automaticky analyzovat obrazy.

Podmínky zdroje: [Windy Webcams terms](https://account.windy.com/agreements/windy-api-webcams-terms-of-use), ověřeno8.9.2026. API není určeno k hromadnému skenování ani archivaci obrazové historie.
