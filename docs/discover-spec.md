# Objevuj — specifikace pro plnou implementaci (Evropa)

Tento dokument je zadání pro další fázi. Základ (Česko: země → kraj → okres, AI souhrn s cache, počty OSM/uživatelských pinů) je už v kódu. Níže je implementačně připravený kontrakt, aby agent mohl pracovat bez dalšího produktového rozhodování.

## Cíl

Objevuj je hierarchický průvodce územím: uživatel se proklikává z kontinentu přes stát, NUTS/kraj, okres až na část obce. Každá úroveň má:

- polygon na mapě (fill + obrys),
- počet míst (OSM POI + veřejné user piny),
- AI souhrn v jazyce UI,
- ikony regionálních témat (víno, hory, lázně…),
- sociální vrstvu (veřejné piny, feed, sdílení).

## Datový model regionů (Evropa)

### Identifikátory

- `region_id` — stabilní string, preferenčně NUTS 2024 (`CZ032`, `DE21`) nebo OSM `admin_level` + `wikidata` když NUTS chybí (městské obvody, části obcí).
- `parent_id` — o úroveň výš; `EU` je kořen.
- `iso_country` — ISO 3166-1 alpha-2.
- `admin_level` — OSM: 2 stát, 4 NUTS-2/kraj, 6 NUTS-3/okres, 7 ORP, 8 obec, 9–10 části obce.
- `nuts_code` — nullable.
- `name_i18n` — `{ cs, en, de, … }`.
- `bbox` `[west, south, east, north]`.
- `geom` — MultiPolygon WGS84, zjednodušení Douglas-Peucker ~200–400 m (cíl < 8 MB pro celou Evropu v MBTiles/PMTiles, ne v Postgres řádcích).

Tabulka `regions`:

```
id TEXT PK
parent_id TEXT
iso_country TEXT
admin_level INT
nuts_code TEXT
name_i18n JSONB
bbox JSONB
geom GEOMETRY(MultiPolygon, 4326)
theme_tags TEXT[]          -- wine, spa, mountains, coast, castle-country
icon TEXT                  -- klíč pro symbol layer
updated_at TIMESTAMPTZ
```

Indexy: GIST(geom), (iso_country, admin_level), (parent_id).

Zdroje geometrie (priorita): Eurostat GISCO NUTS → OSM admin boundaries (Overpass/Geofabrik extract, jednorázový import) → národní open data (ČÚZK RÚIAN, IGN, BKG). Import job `scripts/import-regions.ts` zapisuje PMTiles `regions-eu.pmtiles` + metadata do `regions`.

## API kontrakty

### `GET /discover/regions?country=&parent=&lang=cs`

Odpověď:

```json
{
  "regions": [
    {
      "id": "CZ032",
      "name": "Plzeňský kraj",
      "level": 4,
      "parent": "CZ0",
      "bbox": [12.4, 49.0, 13.9, 50.1],
      "osmPois": 1840,
      "userPins": 12,
      "themeTags": ["beer", "castles"],
      "icon": "hops"
    }
  ]
}
```

Počty: `ST_Within` OSM + `user_pins` kde `user_layers.is_public = 1`. Cache 24 h v Redis/tabulce `region_stats`.

Vektorové dlaždice: `GET /discover/tiles/{z}/{x}/{y}.pbf` z PMTiles (ne GeoJSON v JSON odpovědi nad z7).

### `GET /discover/summary?region=&lang=cs`

```json
{ "text": "…", "model": "gpt-4o-mini", "cached": true, "updatedAt": "2026-08-01T00:00:00Z" }
```

Tabulka `region_summaries (region_id, lang, text, model, created_at)` UNIQUE(region_id, lang). TTL 90 dní; regenerace batch jobem.

Bez `OPENAI_API_KEY` vrať fallback 2 věty z `theme_tags` + jména.

### `GET /discover/feed?region=&cursor=`

Veřejné user piny v geom, řazené `created_at desc`, stránka 30.

### `POST /discover/share` (auth)

Vytvoří shortlink `/o/{slug}` na region + volitelný pin.

## Pre-analýza AI (batch)

Job `apps/api/src/jobs/precomputeSummaries.ts`:

1. Iteruje `regions` kde `admin_level <= 8`.
2. Prompt: 2–4 věty, jazyk `cs|en|de|pl|sk`, fakta jen z whitelistu (OSM counts, wiki extract, theme_tags). Žádné vymyšlené otevírací doby.
3. Model: `gpt-4o-mini` (nebo ekvivalent), `max_tokens=250`, `temperature=0.4`.
4. Rate limit 60 req/min, retry 429.
5. Uložit do `region_summaries`.

### Náklady a limity

- Evropa ~ 2 000 NUTS + ~1 500 extra admin ≈ 3 500 regionů × 5 jazyků = 17 500 completionů.
- ~300 tokenů výstupu + 200 vstupu ≈ 500 tok × 17 500 ≈ 8.75 M tokenů.
- gpt-4o-mini řádově jednotky USD za plný batch; strop v env `OPENAI_MONTHLY_USD_CAP=20`.
- Runtime `GET /discover/summary` volá model jen při cache miss a jen pokud `OPENAI_LIVE=1`; jinak fallback.
- Nikdy negenerovat souhrn při panování mapy, jen při otevření panelu / drill-down.

## Mapová vrstva

- `discover-fill` / `discover-line` z PMTiles source-layer `regions`, filtr `parent_id = current`.
- Symbol layer `discover-icons` — `icon-image` z `theme_tags` (sprite: wine-glass, mountain, spa, hops, castle). Ikona ve centroidu, minzoom podle levelu (stát z2, kraj z5, okres z8, obec z11).
- Klik do polygonu = drill-down; breadcrumb zpět. Zoom animace `fitBounds(bbox, padding: 48)`.
- Části obcí (admin_level ≥ 9) až od z13, jinak příliš husté.

UX zoom flow:

1. Evropa — státy.
2. Stát — NUTS-2 / kraje.
3. Kraj — okresy.
4. Okres — obce (lazy load).
5. Obec — části + POI + user piny.

## Sociální vrstva

- Veřejné piny (`kind: place|route|task`) filtrované `ST_Within(region.geom)`.
- Feed v panelu pod AI souhrnem, karty se jménem autora a tagy.
- Sdílení regionu: OG image (static map + název), URL `/objevuj/{country}/{region_id}`.
- Report/hide endpoint (auth), rate limit.
- Žádné DM, žádný follow graph v této fázi — jen veřejný obsah.

## UI

- Header v módu Objevuj: CountryPicker + Moje poloha (nastaví zemi z reverse geocode).
- Panel: breadcrumb, AI souhrn, karty podregionů s počty, Nejzajímavější místa (OSM+Wiki), Příspěvky lidí.
- Mobil: panel jako bottom sheet nad BottomNav.
- Prázdný stav: „V této úrovni zatím nemáme data — přibliž nebo přepni zemi.“

## Mimo rozsah této fáze (neimplementovat teď)

- Generování souhrnů pro celou Evropu.
- PMTiles pipeline a symbol layer ikon.
- Sociální feed API a OG image.
- Části obcí a ORP.

Tyto body staví na existujících endpointech `/discover/regions` a `/discover/summary` a tabulce `region_summaries`.
