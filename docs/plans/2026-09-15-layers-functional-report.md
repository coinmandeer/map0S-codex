# Report: stav vrstev — co načítá data, co komunikuje, co je opravené

K 2026-09-15. Předchozí audity řekly „chybí zdroj" u šesti řádků, což bylo nepřesné: tři z nich
měly zdroj, který jsem nenapojil. Tento report shrnuje skutečný stav po nápravě.

## Co bylo opraveno v této vlně

| Řádek                           | Dřívější stav                         | Nyní                                               | Zdroj dat                                                           |
| ------------------------------- | ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Dočasné zprávy                  | „zdroj zatím není"                    | **funkční vrstva** `temporary-messages`            | existující `POST /v2/world/threads/search` (GeoThread kind `place`) |
| Dopravní značky                 | placeholder s ikonou                  | **facet vrstvy** `street-objects` (`signs`)        | Mapillary vector tiles `/street-objects/sign/…`                     |
| Přechody a řízení dopravy       | placeholder s ikonou                  | **facet** `street-objects` (`crossings`)           | Mapillary `/street-objects/point/…`                                 |
| Vybavení veřejného prostoru     | placeholder s ikonou                  | **facet** `street-objects` (`furniture`)           | Mapillary `point`                                                   |
| Elektřina / Sítě / Voda (řádky) | odkaz na neexistující `mapillary-*`   | **facety** `street-objects` pod `openinframap`     | Mapillary `point`                                                   |
| Cyklistická infrastruktura      | odkaz `mapillary-cycle` (neexistoval) | **facet** `street-objects` (`cycle`) pod `cyclosm` | Mapillary `point`                                                   |
| Námořní mapa a lodě             | odkaz na neexistující `marine`        | odkaz odstraněn                                    | —                                                                   |
| Tajná místa                     | placeholder                           | placeholder (vědomý)                               | Followable, plánováno samostatně                                    |
| Foursquare Places               | placeholder                           | placeholder (vědomý)                               | jen doplňuje detail místa                                           |

## Jak Mapillary napojení funguje

- **Kontrakt ověřen** proti oficiálnímu API demu Mapillary: dva vektorové tile sety
  `mly_map_feature_point` (source layer `point`) a `mly_map_feature_traffic_sign`
  (`traffic_sign`), každý feature nese `object_value`.
- **Token zůstává na serveru.** Prohlížeč žádá vlastní origin `/street-objects/:source/:z/:x/:y`;
  server přidá klíč. Token se tak neobjeví v URL, v `Referer` ani v logu — na rozdíl od přímého
  `?access_token=` z prohlížeče. Route ani transport URL nelogují.
- **Gate:** bez `MAPILLARY_ACCESS_TOKEN` server hlásí `mapillary: false`, vrstva se v katalogu
  vůbec neobjeví a route vrací poctivou 503. Nic se nepředstírá.
- **Jeden zdroj, víc řádků:** řádky jsou facety jedné vrstvy, takže se stejné dlaždice nestahují
  vícekrát (§2.4 „shared control, one datasource"). Kategorie se filtrují podle prefixu
  `object_value`.
- **Cache:** dlaždice na týden; objekty a značky se nemění.

## Ověřený stav jednotlivých částí

| Vrstva                           | Registrace        | Data                               | Komunikace                       | Poznámka                                                |
| -------------------------------- | ----------------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `street-objects`                 | OK (`raster`)     | Mapillary tiles (gate `mapillary`) | server proxy `/street-objects/…` | živě neověřeno bez tokenu; kontrakt a gate ověřen testy |
| `temporary-messages`             | OK (`pins`)       | world threads                      | `worldCall /threads/search`      | endpoint ověřen živě: 200 se session, 401 bez           |
| `satellites`                     | OK (`custom-gl`)  | CelesTrak OMM                      | `/satellites/elements`           | 53 družic staženo živě, SGP4 propagace ověřena          |
| `roads`                          | OK (`raster`)     | OpenFreeMap OpenMapTiles           | přímé tiles                      | ověřeno živě                                            |
| `land-cover`                     | OK (`raster`)     | NASA GIBS MODIS IGBP               | přímé tiles                      | ověřeno živě                                            |
| `snow-cover`                     | OK (`raster`)     | NASA GIBS                          | přímé tiles                      | ověřeno živě                                            |
| `overture-places` / `-buildings` | OK (`raster`)     | vlastní PMTiles výřez              | `pmtiles:///overture/…`          | gate `overture`; import ověřen (Praha → 0,21 MB)        |
| `panoramax`                      | OK (pins + panel) | Panoramax STAC                     | `/info/panorama/panoramax`       | ověřeno živě                                            |
| `mapillary` (snímky)             | OK (pins + panel) | Mapillary images                   | `/info/panorama`                 | token na serveru                                        |

## Zbývající vědomé mezery

- **Tajná místa**: patří do Followable, řeší se samostatně.
- **Foursquare Places**: zdroj jen doplňuje detail, bulk vrstva není v plánu.
- **Marine (vlnobití/proudy)**: bez keyless zdroje, řádek zůstává jen `openseamap`.
- **Mapillary živé ověření**: v tomto prostředí není token; ověřena je smlouva API, gate a proxy.
  Na nasazeném serveru stačí `MAPILLARY_ACCESS_TOKEN` a vrstva se objeví.

## Ověření

- typecheck celého monorepa prochází; produkční build prochází.
- architektura, secrets a source-rights audit (7/7) procházejí.
- API **760/762** (2 přeskočené), 0 selhání.
- Web má 7 předexistujících selhání z WIP větve (netýkají se této práce).
- Katalog: **0 řádků s generickou ikonou**, **0 visících odkazů**, 94 řádků celkem.
