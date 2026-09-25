# Discover statistics: implementation and remaining coverage

Deployed: `20260905-statistics-discover` at https://mapos.promptstudio3000.com on 2026-09-05. Backup and restore drill, migration/old-image compatibility and all 7 public smoke checks passed. Production browser verified country → municipality resolution changes.

## What was wrong

Only three World Bank country series were published. The catalogue also advertised unimported datasets, and selection could prefer an empty finer source. A mode notification during activation could restore the previous statistic. Municipal geometry editions are immutable per-country hashes, not the literal year `2024`.

## Implemented

- One active statistic, normal switches, cancellation of pending activation and generation checks. Ignore intermediate layer notifications during activation; do not re-enter Discover when already there.
- One compact catalogue request replaces eager detail requests for every statistic. Coverage refreshes after settled movement, cancels stale requests and uses a bounded server cache. Dots describe **latest available data at the current resolution and viewport**, not whether a provider merely exists.
- Exact LAU code + immutable edition joins. Existing published GISCO LAU boundaries are reused, without importing a new geography or enabling the general noncommercial/NUTS flag. Attribution and the existing GISCO usage terms remain applicable; this work does not change those terms.
- Population and density use country data in the overview and LAU data from zoom 8. Metadata, tiles, legend and the visible-territory table use the same resolution. Missing municipal observations stay missing; national averages are never painted as municipal measurements.
- Municipal statistics: pinned GISCO LAU 2024 attributes, with Spanish 2024 annual census totals from INE table 68065 joined by official municipality code. Ignore gender/nationality/age subsets. GISCO zero placeholders become null; genuine INE zero totals are preserved. Density = population / GISCO AREA_KM2.
- 97,987 municipal identities, 62,260 measured populations/densities; all 8,132 Spanish municipalities. Rest are null. La Selva del Camp ES_43145: 5,839 people in 2024. Publication checks exact country edition hashes; 0 unmatched identities in staging.
- Added validated country imports for senior share, doctors, beds, homicide, road deaths, population density, births, deaths, GDP/person, unemployment, poverty, life expectancy, renewable energy and tourism nights. Together with existing country population, PM2.5 and forest cover: 17 themes with data, 19 datasets including the two municipal publications.
- Statistics tile cache now also has a 16 MiB byte budget. Browser never downloads continental geometry or raw source files. Boundary hover does not add a second popup over the statistical value popup.

## Reproducing the municipal publication

Download the pinned GISCO file and the INE JSON with metadata:

- https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2024_4326.geojson
- https://servicios.ine.es/wstempus/js/es/DATOS_TABLA/68065?nult=2&tip=AM
- Source documentation: https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736176992&idp=1254735572981&menu=resultados

Run `scripts/prepare-municipal-statistics.mjs GISCO_FILE INE_FILE output/performance/lau-2024-manifest.json OUTPUT_FILE`. It verifies the source hash against the already published boundary manifest and strips geometry. Set `MAPOS_MUNICIPAL_INPUT` to that output for the existing `stats:import` command, with dataset IDs `lau-population-2024 lau-population-density-2024`.

This is deliberately offline preparation: the normal API retains its 16 MiB upstream limit. The prepared input is bounded to 64 MiB. Import both datasets into staging first; inspect measured counts, country coverage and unmatched identities before production. The publisher replaces only the requested dataset inside a transaction. Keep the input and manifest for a reproducible refresh. If INE no longer returns 2024 among the last two years, the parser fails instead of silently switching years; use an explicitly archived 2024 response or revise the source/edition workflow.

## Validation

- API: 654 passed, 1 skipped. Web: 473 passed, 7 skipped. Adapter SDK: 83 passed. Builds passed.
- Parser regressions: official-code joins, total-only dimension selection, pinned year, missing values, duplicate rejection, derived density.
- Service regressions: fallback from unpublished finer sources, matching legend/tile resolution, explicit missing years, no empty latest tiles.
- Real browser found and verified the mode/layer reactivation race. Population → homicide → population now leaves only population active. Disabling during a pending response stays disabled. A small browser hover check recorded 9 frames at 4.9–21.1 ms and zero statistics/Discover HTTP requests; this is not a full p95 benchmark.
- `output/performance/statistics-stage-verification.json`: staging over SSH from the development machine, including network overhead. Example municipal tile 16,464 bytes; repeated request 223 ms. Catalogue 8,709 bytes. Initial metadata 1,239 ms. These are request samples, not a p95 benchmark or server-only timings.

## Still needed — do not mark as complete

1. Regional/provincial statistics between country and municipality. ADM1/ADM2, NUTS and LAU are not interchangeable. Import compatible official regional series and versioned geometries/crosswalks; never use name/nearest-centre guesses or repeat a country rate into children. Existing general GISCO/NUTS usage gate remains unchanged.
2. Municipal population gaps, especially France and other missing countries. Red at municipality zoom is intentional even when country data exist. Extend with official code-based national adapters, pinned to the relevant geometry edition.
3. Local crime, health, incomes and environmental statistics. The tourism import also retains one `EA` aggregate without a country boundary; it is excluded from map/table joins, and a future parser cleanup should remove aggregate codes at ingestion. Current imported values for these themes are country-level; the UI says so. A green country-level dot does not promise street-level data.
4. Prepared raw-source archive and a scheduled refresh workflow with alerts, source hashes, publication review and rollback receipts. No recurring automation was silently created.
5. More responsive first metadata load: benchmark database-only work and consider a publication-time inventory/classification cache. Current caches are bounded and expire after 60 seconds.
6. Full cross-device p95 interaction/memory benchmark and comprehensive municipality drill paths, beyond the browser scenarios and request samples recorded here.

## Production receipts

- `output/performance/statistics-production-inventory.txt`: 19 ready datasets. Both municipal publications have 0 unmatched identities; 62,260 measured municipalities, including 8,132 ES and 6,254 CZ.
- `output/performance/statistics-production-verification.json`: public endpoint samples and exact municipal values. Cold metadata/rows were about 2.2/2.1 seconds in this run including network overhead, so first-load performance still has room for improvement.
- `output/performance/statistics-browser-verification.json`: rapid switching, cancellation, local hover and mobile checks.
- Production preparation archive: `/opt/ps3000/apps/mapos-v3/statistics-inputs/lau-2024/input.json`.
- Existing database backup: `/opt/ps3000/apps/mapos-v3/backups/20260905-statistics-discover`.
