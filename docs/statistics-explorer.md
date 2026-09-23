# European statistics explorer

The implementation adds Discover → Data, a shared statistics catalogue, annual selection,
territory details and comparison (up to four territories), a table, and CSV export with source
URLs. Activating a statistic selects Discover and replaces the previous statistical fill.
Compatible layers remain active. Leaving Discover suspends statistical fills; returning restores
them without deleting the plan. The statistical year is independent of the weather cursor.

## Data and publication

The local import audit on 5 September 2026 found **37 populated indicators in 12 categories,
from eight providers**: Eurostat, World Bank, ČSÚ, Statistics Finland, GUS, CBS, INE and
Statistics Denmark. The current machine's database contains the actual imported values.
The data are not embedded into the frontend or replaced with demo values.

```
npm run build:shared
npm run geo:units -w @mapos/api -- natural-earth-countries
npm run stats:import -w @mapos/api
npm run stats:report -w @mapos/api
```

Run the API normally first to apply database migrations. Imports can also be limited to a list
of dataset IDs. Failed providers do not prevent the others from being published; each dataset,
coverage index and publication receipt commit in one transaction. A failed publication retains
the previous data. Import exit status is nonzero if any requested dataset fails.

`GET /v2/themes/operations` returns the operational report, including actual periods, measured
values, territories, unmapped codes, attribution, value licence, and last publication/failure.
The local report is `output/statistics/operations.json`.
For repeatable endpoint checks, use `node --import tsx scripts/statistics-source-smoke.mjs`.
This smoke check limits Eurostat history to 2020 onward; the normal import requests 2000 onward
where supported. National providers expose their actual available periods (for example, the
selected historical CBS table ends in 2022 and the INE series ends in 2021).

A dataset ID represents exactly one measure/unit/dimension selection. Unselected dimensions,
unexpected selected categories, duplicate normalized territory/year keys and incomplete World
Bank or GUS/CBS pages are rejected. Selected national cubes use the same JSON-stat parser.
Zero, missing values and provider flags remain separate. No percentages or rates are added
across territories. A manually chosen year never borrows another year's value; “latest” uses
the latest nonmissing measurement per territory and displays the periods actually used.

## Geometry and interpretation

The default map uses Natural Earth country boundaries (public domain). Regional values remain
available in the table by excluding the country series. NUTS codes are never joined to ADM
codes. Configured Eurostat regional series require the stated NUTS edition. Region imports with
no matching geometry are included in the operational report.

`MAPOS_ALLOW_NONCOMMERCIAL_DATA=1` opts into the regional geometry profile. It does not import
boundaries itself. GISCO boundaries have separate conditions from Eurostat values; this option
must only be enabled for a deployment permitted to use those boundaries. Matching editions
remain required. The current implementation does not automatically crosswalk historical NUTS
editions or equate administrative boundaries with statistical regions.

National sources are exposed under the corresponding indicator's sources, rather than as
multiple duplicate indicator switches. Source selection stays explicit. They do not silently
replace the harmonised European rate. GDP in PPS (`PPS_EU27_2020_HAB`) is correctly labelled as
an index, EU27 = 100. Country exposure to PM2.5 is a World Bank population-weighted series,
not a street-level monitor or the discontinued Eurostat `sdg_11_50` endpoint.

## Validation and remaining scope

The targeted suite passed 109 tests. Tests cover ambiguous dimensions, selected categories, duplicate codes, missing versus zero,
publication batching, explicit years, source exclusion, geometry profiles, renderer replacement,
and Planning → Discover → Planning with overlay preservation. There is a bounded tile cache
keyed by dataset publication, geometry import, resolution, period and tile.

This is **not the complete original plan**. In particular:

- Parliamentary vote-result maps, the production CHES party crosswalk, exact election dates,
  winning parties and bloc colours are not yet connected to the explorer. The election domain
  module and tests implement validation, dated classifications, uncertain/unclassified outcomes,
  coalition handling and as-of-year semantics; this is not a claim that electoral results have
  been imported. The EP turnout adapter is present but its direct HTTPS import failed on this
  machine; the empty indicator is not counted in the populated catalogue.
- OECD, EEA, GHSL, Slovak, German, French, Italian, Austrian, Swedish, UK and additional detailed
  national adapters remain to be implemented. The existing eight providers do not yet all have
  two or three regionally detailed measures. NO₂, facilities, water, household electricity
  prices and several other requested series are not connected.
- Cross-indicator comparison, country/European reference values, a full custom filter UI,
  restoration of every previous indicator’s settings across a browser restart, the generic reversible basemap
  compatibility stack, and automated scheduled refresh are still pending.
- Regional geometry needs verified releases and explicit historical crosswalks. Numeric
  statistics do not by themselves establish map coverage.
- The final desktop/mobile and keyboard pass was interrupted by concurrent workspace changes:
  `App.tsx` imports unfinished `world/WorldSocial` and `world/world.css` modules; the global API
  typecheck also reports concurrent World/avatar changes outside this implementation. Earlier desktop
  checks opened Discover → Data and its territory table. A real-data API check confirmed matching
  map, table and detail values for Czech GDP, population, robbery and PM2.5. A cached tile took
  317 ms; its first rendering took 7.3 seconds on this development machine. No production
  performance SLA or completed mobile acceptance is claimed here.

Primary sources: [Eurostat API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/sdmx2.1),
[World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392),
[ČSÚ](https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu),
[Finland](https://stat.fi/en/services/statistical-data-services/open-data-and-interfaces/interface-use-of-databases),
[GUS](https://api.stat.gov.pl/Home/BdlApi?lang=en),
[CBS](https://www.cbs.nl/en-gb/our-services/open-data/statline-as-open-data),
[INE](https://ine.es/dyngs/DAB/es/index.htm?cid=1099),
[Denmark](https://www.dst.dk/en/Statistik/hjaelp-til-statistikbanken/api),
[GISCO terms](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units),
[Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/),
[EP exports](https://results.elections.europa.eu/en/tools/download-datasheets/),
[CHES](https://www.chesdata.eu/ches-europe/).
