# Otevřené katalogy webkamer mimo Windy

Ověřeno8.9.2026. Otevřený software, licence databáze a práva k jednotlivým snímkům jsou odlišné. Nebylo doloženo, že by samotný kompletní seznam Windy byl otevřenou databází; takový závěr nepřebíráme.

| Zdroj                                                                          | Otevřenost a účet                                                                          | Co lze převzít                                                                    | Stav MapOS                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [CartoCams / WebcamMap](https://github.com/wvanderp/WebcamMap)                 | Kód MIT, OSM databáze ODbL, bez API klíče                                                  | Publikovaný raw.json a původní OSM reference; vlastní filtr, atribuce a verzování | Importován konkrétní snapshot, místní index9451záznamů; bez runtime dotazů na Overpass                                                   |
| [OpenStreetMap webcam](https://wiki.openstreetmap.org/wiki/Webcams)            | ODbL; contact:webcam je odkaz na kameru                                                    | Regionální aktualizace nebo obnovování snapshotu                                  | Zdroj identity katalogu; obecné surveillance bez webcam odkazu se nezobrazují                                                            |
| [Open Data Hub WebcamInfo](https://tourism.opendatahub.com/swagger/index.html) | Veřejný Content API bez účtu; per-record LicenseInfo                                       | Turistická metadata, souřadnice a Webcamurl                                       | Importována2místa s doloženou otevřenou licencí metadat a použitelnou polohou; ostatní mají chybějící licenci/polohu nebo neplatný odkaz |
| [Digitraffic](https://www.digitraffic.fi/en/road-traffic/)                     | Oficiální finská silniční data [CC BY4.0](https://www.digitraffic.fi/en/terms-of-service/) | Station GeoJSON, presets, časy a snímky                                           | Importováno764aktivně sbírajících stanovišť z811;406 vyřešeno povinnou gzip kompresí                                                     |
| [TfL JamCams](https://tfl.gov.uk/info-for/open-data-users/our-open-data)       | TfL open data pod vlastními podmínkami; doporučený registrovaný token                      | Londýnské dopravní kamery, popisy, datované obrázky                               | Kandidát: ověřit klíč, podmínky a /Place typ JamCam; neaktivováno                                                                        |
| [Switzerland Tourism](https://developer.myswitzerland.io/)                     | Open Data API vyžaduje klíč                                                                | Turistické objekty a jejich publikované odkazy                                    | Kandidát; [podmínky](https://developer.myswitzerland.io/terms-and-conditions) výslovně oddělují obrazové URL od licence datasetu         |

U Open Data Hub [licence](https://docs.opendatahub.com/licensing/) platí pro metadata rodiče; Webcamurl/Streamurl nemusí mít stejná práva. Přímé galerie mají vlastní licenční pole. Neodvozovat právo na embed z CC0 na rodičovském záznamu. Digitraffic uvádí kontrolu state/collectionStatus a preset.inCollection a snímky přibližně po10minutách; nepřejmenovat je na souvislé živé video. TfL uvádí datované obrazy a výpadky během údržby nebo operativního řízení dopravy.

## Implementace nyní

`webcams` je výchozím stavem vypnutá vrstva ve stávajícím katalogu. Odzoom7, výřez do150km, nejvýše300výsledků po prostorovém filtrování. Zdrojem je pouze místní snapshot; žádné API klíče, obrazové fetch, streamy ani Nominatim enrichment při načítání mapy.

Importované vydání: WebcamMap commit `7d24fd1e536e47479836e5151157a8000509a548`, soubor data/raw.json;10024vstupníchzáznamů →9451použitelnýchzáznamů. Převzata data, nikoli Leaflet aplikace. Manifest obsahuje URL zdroje, SHA256, revizi, datum přípravy, licenci a popis úprav. Žádná uživatelská jména/OSM editors/contact databáze nejsou převzata. Zachováno původní OSM ID, název, bod/center, provozovatel a explicitní contact:webcam.

Vylučují se označené private/no/indoor kamery a URL s credentials, IP adresou, lokálním hostname či nepodporovaným schématem. Backend URL kamery nikdy nestahuje. Samotný odkaz z OSM však nezaručuje veřejný funkční stream: některé vedou jen na informační stránku provozovatele. UI to výslovně uvádí. Střed way/relation je přibližná poloha objektu, ne ověřené umístění kamery.

Živý regionální Overpass sloužil pouze pro kontrolu dat před zvolením místního snapshotu. Praha11, Tarragona/Calafell1záznam; stejné počty dal místní index. První načtení+parse indexu v testu cca325ms na místním serveru, následný výřez cca4ms. Nejde o browser p95 ani produkční benchmark. Kompletní index5,86MB zůstává na serveru a načte se až při první aktivaci; není součást webového bundle. Výsledky chybějících oblastí nejsou tvrzením, že tam žádné kamery neexistují.

## Aktualizace a další implementace

1. Periodicky připravit nové vydání z konkrétního commit raw.json, nikoli na každém mapovém dotazu. Spustit `node --import tsx scripts/import-webcams-catalog.mts RAW_JSON COMMIT_SHA`. Ověřit původ vstupu z přesné source URL a porovnat checksum manifestu. Skript nesmí navštěvovat webcam URL.
2. Před vydáním porovnat počet a ztracené identity s aktivním katalogem; prázdný import skript odmítne. Publikace s aplikací zachovává předchozí edici pro rollback. Automatický stahovač/cron nyní není nasazen.
3. ODbL notice a dostupnost odvozené databáze zachovat při veřejné distribuci. `apps/api/data/webcams-catalog.json` je distribuovatelný odvozený katalog pod ODbL, nikoli nová proprietární databáze. Obrázky v něm nejsou.
4. Open Data Hub a Digitraffic jsou nyní součástí stejné vrstvy; samostatné source:id, atribuce a filtr zdroje. Shody mezi katalogy zatím nejsou automaticky sloučené.
5. Digitraffic řešit jako první ověřený snapshotový player: station metadata denně, čas/preset až explicitní otevření; image pouze na povoleném hostu s atribucí. Katalog a povinná gzip komprese ověřeny; lazy player zbývá.
6. Teprve u ověřeného provozovatele přidat tlačítko načtení snímku/embedu do současného detailu. Low Data bez preload, hover0HTTP, jeden aktivní přehrávač, close/hidden jej odpojí. Obecné odkazy zatím otevírají provozovatele.
7. Windy ponechat volitelné obohacení, nikoli nutný základ. Foursquare aktivace nezávislá podle existujícího runbooku. AI může použít metadata kamer; záběry se automaticky neposílají modelu.

## Rozšíření 8.9.2026: Fintraffic a Open Data Hub

Celkem **10 217 záznamů** ve třech oddělených serverových souborech: OSM9451, Fintraffic764, ODH2. Společný viewport/limit300 a provider filtr před limitem. Žádný nový stream, obrázek ani vzdálený katalog se nestahuje při pan/zoom; importy jsou dávkové a zatím ruční. Nejde o počet ověřených fungujících přenosů. Podrobnosti uvádějí zdroj a datum změny metadat, nikoli smyšlený čas snímku.

### Fintraffic aktualizace

1. Stáhnout oficiální katalog `https://tie.digitraffic.fi/api/weathercam/v1/stations` pomocí `curl --compressed` s identifikační hlavičkou `Digitraffic-User: MapOS/0.1`. Bez podpory gzip server vrací406. Současný import používá lokálně dekódovaný JSON; nepoužívat neověřenou dekompresi v obecném transportu.
2. Spustit `node --import tsx scripts/import-digitraffic-webcams.mts LOCAL_JSON`.
3. Ověřit počet, checksum, revizi a změny identit. Import přijímá jen GATHERING stanoviště, použitelný stav a aktivní preset. Vybraný je první aktivní pohled, nikoli všechny úhly jako duplicitní piny.
4. Detail nabízí oficiální JPG jako odkaz. Vložený přehrávač s časem snímku, explicitním spuštěním a zastavením při skrytí je další krok. Licenci a atribuci Fintraffic zachovat.

### Open Data Hub aktualizace

`node --import tsx scripts/import-odh-webcams.mts` načte omezený katalog z oficiálního Content API (aktivní objekty, explicitní pole,500na stránku, nejvýše20stránek,20s timeout). Kontroluje úplnost a stabilní počet během importu; žádné načítání obrazových URL. Aktuální1546aktivních záznamů:1530bez přijatelné explicitní licence,14bez použitelné polohy/odkazu,2použitelné. Nulová zeměpisná souřadnice v jihotyrolském katalogu je chybějící poloha, nikoli kamera u rovníku. Licence rodiče nepřenáší práva na obrázky.

Manifesty oddělují checksum normalizovaného vstupního JSON (u ODH pořadí stránek) a revizi odvozených features; nejde o checksum komprimovaného síťového přenosu. Publikují se spolu s aplikací, rollback vrací i předchozí soubory. Automatické denní obnovování a široké evropské turistické pokrytí zatím nejsou hotové.

Kontrolní HEAD jednoho oficiálního finského snímku (`C0150301.jpg`) dne8.9.2026 v08:54UTC vrátilHTTP200 aimage/jpeg, Content-Length272787. Obrazové tělo se nestahovalo. Jde o jeden kontrolní endpoint; HTTP Last-Modified není vydáván za ověřený čas pořízení ani za kontrolu všech764kamer.
