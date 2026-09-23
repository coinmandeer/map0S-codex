# MapOS — Fáze 0: inventář a převodní tabulka

Stav k 2026-09-14 na větvi `ui-redesign-v3`. Tabulka zachycuje **současný prvek → nový
logický řádek → zdroj/plugin → zachované nastavení → detail**. Slouží jako závazný podklad pro
Fáze 1–10: nic zde nesmí zmizet bez výslovného vyřazení.

Pojmy:

- **Stavitelé katalogu** = `apps/web/src/ui/layers/catalogModel.ts` (`CATALOG_GROUPS`).
- **Registr pluginů** = `apps/web/src/layers/{builtins,registry,plugins/*}.ts`.
- **Aktivní stav** = `mapStore.activeLayers[id] = { visible, selected?, opacity, filters }`
  (`apps/web/src/store/mapStore.ts`).

## A. Již hotové základy (ověřeno v kódu)

| Oblast                                                   | Kde                                                                          | Stav   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Výběr vs. zobrazení                                      | `activeLayers.selected` / `visible`, `toggleLayer`, `removeLayer`            | hotovo |
| Logický katalog                                          | `catalogModel.ts` (`CATALOG_GROUPS`, `catalogItemState`, `catalogItemPatch`) | hotovo |
| Aktivní seznam + souhrn „vybrané · zapnuté“              | `ui/layers/UnifiedLayers.tsx`                                                | hotovo |
| Oddělení zapnout / pozastavit / odebrat / nastavení      | `toggleLayer`, `setLayerVisible`, `removeLayer`, `setLayerFilters`           | hotovo |
| Appearance v2 (vrstvy + podklad + popisky + 3D + zdroje) | `store/mapAppearance.ts`, `captureAppearance`/`restoreAppearance`            | hotovo |
| Session v2, bez limitu 64 vrstev                         | `store/layerSessionState.ts` (`MAX_LAYERS = 1024`)                           | hotovo |
| Migrace starých ID a filtrů (v1 klíč)                    | `readLayerSessionState` čte `mapos:layer-session-v1`                         | hotovo |
| Staré sdílené odkazy (`?layers=`, `?mode=`)              | `parseUrlState`                                                              | hotovo |

## B. Katalog vrstev (závazné pořadí řádků)

| Sekce                          | Řádek                                                              | Plugin / zdroj                                                | Zachované nastavení                | Detail                           |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------- | -------------------------------- |
| Moje vrstvy                    | Uložená místa                                                      | `my-saved-places` (user-data)                                 | —                                  | soukromá data                    |
| Moje vrstvy                    | Moje vrstvy                                                        | `user-layers`                                                 | tag, země                          | vlastní piny                     |
| Komunita                       | Poznámky v mapě                                                    | `game-quests` facet `sources:osm-notes`                       | výběr zdrojů                       | quest                            |
| Komunita                       | Tajná místa                                                        | `secret-places`                                               | —                                  | zatím bez zdroje                 |
| Komunita                       | Geocachingové keše                                                 | `game-quests` facet `sources:opencaching`                     | výběr zdrojů                       | quest                            |
| Komunita                       | Dočasné zprávy                                                     | `temporary-messages`                                          | —                                  | zatím bez zdroje                 |
| Komunita                       | Herní questy                                                       | `game-quests` facet `sources:wlm-photo,turf-zones`            | výběr zdrojů                       | quest                            |
| Komunita                       | 3D svět                                                            | `game` (custom-gl, lazy)                                      | —                                  | herní HUD                        |
| Počasí                         | Počasí                                                             | `weather` (raster)                                            | veličina/model/zdroj, průhlednost  | `WeatherSection`                 |
| Události                       | Události                                                           | `events` (server-adapter v2)                                  | kategorie, období, stav, zdarma    | `EventPinDetail`                 |
| Místa → Příroda a historie     | Vyhlídky…Pomníky (12)                                              | `osm-poi` facet `categories`                                  | výběr kategorií, zdroje, barvy     | `PoiLayerRow`                    |
| Místa → Jídlo a pití           | Bary…Pitná voda (6)                                                | `osm-poi` facet `categories`                                  | totéž                              | totéž                            |
| Místa → Cestování              | Parkování…Přístřešky (10)                                          | `osm-poi` facet + `charging-stations`, `refuge-restrooms`     | zdroje, filtry                     | POI + Refuge                     |
| Místa → Sport                  | Turistické trasy                                                   | `waymarked-trails` facet `activity:hiking`                    | aktivita                           | legenda WT                       |
| Místa → Sport                  | Cyklistická infrastruktura                                         | `cyclosm` + `waymarked-trails:cycling,mtb`                    | aktivita                           | CyclOSM legenda                  |
| Místa → Sport                  | Lyžařské areály a trasy                                            | `opensnowmap` (+`waymarked-trails:slopes`)                    | —                                  | OpenSnowMap                      |
| Místa → Sport                  | Jezdecké trasy                                                     | `waymarked-trails` facet `activity:riding`                    | aktivita                           | legenda WT                       |
| Místa → Sport                  | Ferraty, Lezení, Disc golf, Golf, Skateparky, Koupání, Sportoviště | `osm-poi` facet `categories`                                  | výběr kategorií                    | `PoiLayerRow`                    |
| Místa → Sport                  | Fitness (stezky + posilovny)                                       | `osm-poi` facet `fitness_trail`,`fitness_centre`              | varianty                           | `PoiLayerRow`                    |
| Doprava a provoz               | Silnice a dálnice                                                  | `roads`                                                       | třídy komunikací                   | nové, Fáze 9                     |
| Doprava a provoz               | Sdílená kola a koloběžky                                           | `shared-mobility` (server-adapter)                            | —                                  | GBFS                             |
| Doprava a provoz               | Dopravní značky                                                    | `mapillary-signs` (Mapillary objects)                         | skupiny značek                     | Fáze 6                           |
| Doprava a provoz               | Železnice                                                          | `openrailwaymap` (raster overlay)                             | —                                  | legenda ORM                      |
| Doprava a provoz               | Letecká infrastruktura                                             | `aviation`                                                    | —                                  | nové, Fáze 9                     |
| Doprava a provoz               | Námořní mapa a lodě                                                | `openseamap` (raster overlay)                                 | —                                  | legenda                          |
| Doprava a provoz               | Družice                                                            | `satellites`                                                  | skupiny (ISS default)              | Fáze 9                           |
| Doprava a provoz               | Přechody a řízení dopravy                                          | `mapillary-traffic`                                           | —                                  | Fáze 6                           |
| Infrastruktura                 | Elektřina / Sítě / Ropa a plyn / Voda                              | `openinframap` facet `network`                                | výběr sítě, průhlednost            | legenda kV                       |
| Infrastruktura                 | Vybavení veřejného prostoru                                        | `mapillary-furniture`                                         | —                                  | Fáze 6                           |
| Země a příroda → Události      | Aktivní požáry                                                     | `active-fires` (dní)                                          | období                             | NASA FIRMS                       |
| Země a příroda → Události      | Zemětřesení                                                        | `earthquakes` (USGS v2)                                       | dní, min. magnituda                | detail magnituda/hloubka         |
| Země a příroda → Události      | Bouře/Sopky/Povodně/Prach/Teplotní extrémy/Sesuvy/Člověk           | `eonet` facet `category`                                      | kategorie, období                  | EONET                            |
| Země a příroda → Události      | Sucho                                                              | `europe-drought` (CDI WMS)                                    | —                                  | legenda Watch/Warning/Alert      |
| Země a příroda → Prostředí     | Ovzduší a měřicí stanice                                           | `cams-air-quality` + `air-quality` + `openaq`                 | veličina (PM2.5/PM10/AQI)          | oddělené legendy                 |
| Země a příroda → Prostředí     | Geologie                                                           | `geology` (Macrostrat MVT)                                    | průhlednost                        | legenda věk                      |
| Země a příroda → Prostředí     | Chráněná území                                                     | `natura2000` (EEA WMS)                                        | směrnice, průhlednost              | legenda Natura                   |
| Země a příroda → Prostředí     | Sněhová pokrývka                                                   | `snow-cover`                                                  | datum                              | nové, Fáze 9 (NASA GIBS)         |
| Země a příroda → Prostředí     | Hloubka vody                                                       | `emodnet-bathymetry` (WMS)                                    | —                                  | jen mořská batymetrie            |
| Země a příroda → Flóra a fauna | Zvířata/Ptáci/Hmyz/Rostliny/Houby/Obojživelníci                    | `inaturalist` facet `taxon` + `gbif`, `gbif-density`, `ebird` | taxon, zdroje                      | nález s fotkou                   |
| Fotografie a média             | Webkamery                                                          | `webcams` facet `provider` (osm/odh/digitraffic)              | zdroj kamer                        | katalog kamer                    |
| Fotografie a média             | Fotografie                                                         | `commons-photos`                                              | —                                  | autor/licence                    |
| Fotografie a média             | Snímky ulic                                                        | `mapillary` (+`panoramax`)                                    | 360°, sekvence, datum              | Fáze 6                           |
| Statistiky a společnost        | tématické řádky (`theme-*`)                                        | runtime registr z `/v2/themes`                                | ukazatel, období, vyloučené zdroje | `StatisticsDialog`               |
| Externí integrace              | Park4Night                                                         | `park4night` (capability)                                     | kategorie, služby, min. hodnocení  | rating, vybavení, odkaz          |
| Externí integrace              | Foursquare Places                                                  | `foursquare-places`                                           | kategorie                          | Foursquare panel                 |
| Externí integrace              | Geocaching                                                         | `game-quests` facet `sources:opencaching`                     | sdílené s Komunitou                | jedna položka v aktivním seznamu |

## C. Strukturální překryvy: přesun z Podkladů do Vrstev

`STRUCTURAL_TILE_OVERLAY_IDS` (`plugins/tileLayers.ts`) se nesmí ovládat v záložce Podklady.
Cílové zařazení:

| ID                 | Cílový řádek                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `cyclosm`          | Místa → Sport → Cyklistická infrastruktura                           |
| `waymarked-trails` | Místa → Sport → Turistické / Cyklistické / Jezdecké / Lyžařské trasy |
| `openrailwaymap`   | Doprava a provoz → Železnice                                         |
| `openseamap`       | Doprava a provoz → Námořní mapa a lodě                               |
| `opensnowmap`      | Místa → Sport → Lyžařské areály a trasy                              |

## D. Podklady (záložka Podklady)

- Obecné volby: Názvy míst, 3D budovy, 3D terén (`basemapLabels`, `buildings3d`, `terrain3d`).
- Katalog `BASEMAPS` beze změny, skupiny `Základní / Turistické / Letecké / Terén / Historické /
Národní` (`basemapGroups.ts`, `BASEMAP_GROUP_LABELS`).
- `DEFAULT_BASEMAP_ID = "carto-voyager"`; tmavý protějšek přes `darkVariantId`.
- CyclOSM jako plný podklad zůstává v Podkladech; CyclOSM **Lite** (`cyclosm` overlay) jen ve
  Vrstvách.
- Přepínače překryvů (`groupStructuralOverlays`) se z Podkladů **odstraní**.

## E. Výslovně vyřazené položky

| Položka                    | Zdroj                      | Rozhodnutí                            | Důvod         |
| -------------------------- | -------------------------- | ------------------------------------- | ------------- |
| Mořský a jezerní led       | `eonet` volba `seaLakeIce` | **Nezobrazovat** v nabídce            | dle dohody    |
| Změny barvy vody           | `eonet` volba `waterColor` | **Nezobrazovat** v nabídce            | dle dohody    |
| Změna barvy vodních rastrů | obecně                     | Nenabízet, pokud ji neumíme vykreslit | pravdivost UI |

Katalog `catalogModel.ts` tyto dvě volby již neobsahuje; plugin `eonet` je stále má v `filters`
(server je umí načíst), ale UI je nesmí nabízet. Při úpravách nabídky to zachovat.

## F. Dynamicky vznikající položky (musí zůstat dostupné)

| Zdroj                     | Kde vzniká                                                | Cíl                                                |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| AI výsledky               | `layers/aiMapResults.ts` (`AI_RESULT_PREFIX`)             | dočasná inline vrstva, nikdy ne do presetů/session |
| Vlastní importy / tabulky | `user-layers`, `AddSourceDialog`, `AddTableDialog`        | Moje vrstvy                                        |
| Vrstvy per experience     | `store/worldLayerState.ts` (`mapos:world-layers-v1:<id>`) | samostatný zásobník světů                          |
| Statistiky z dat          | `layers/themes/themeLayers.ts`                            | Statistiky a společnost                            |
| Komunitní obsah           | `game-quests`, `social-world`                             | Komunita                                           |

## G. Známé chyby a mezery před Fází 1

1. `withUserPreset` už nezahazuje nejstarší sadu, ale test ještě čeká staré chování
   (`USER_PRESET_LIMIT`) — srovnat test a kód.
2. Volba presetu ani jeho baseline se neukládá trvale, takže po reloadu ruční změna nemusí
   přepnout výběr na **Custom**.
3. Aktivní seznam se v `UnifiedLayers` řadí podle katalogu, ne podle pořadí přidání.
4. `saveCategories`/`loadPresetCategories` (legacy `mapos:preset-cats`) zůstávají jen pro
   kompatibilitu; nové presety ukládají úplný `MapAppearance`.
