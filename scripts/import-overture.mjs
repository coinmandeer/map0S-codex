#!/usr/bin/env node
/**
 * Imports a bounded Overture extract as self-hosted PMTiles.
 *
 * Overture's global PMTiles are built for data inspection, not cartography: one z14 places tile
 * over central Prague is ~8.5 MB and carries over 10 000 features, which cannot be drawn live
 * without stalling the map. The plan's answer is a curated extract, and that is what this makes.
 *
 * Chain: DuckDB reads only the requested bounding box out of the global GeoParquet release (the
 * predicate is pushed into the scan, so the release is never downloaded whole) and writes GeoJSON;
 * tippecanoe turns that into a small PMTiles archive our origin serves at `/overture/`.
 *
 * Requires: `duckdb` (with the spatial and httpfs extensions) and `tippecanoe` v2, which writes
 * PMTiles directly. Nothing here runs at request time.
 *
 * Usage:
 *   node scripts/import-overture.mjs --theme places --bbox 12.0,48.5,18.9,51.1 \
 *     --out apps/web/public/overture/places.pmtiles
 *
 * `--bbox` is west,south,east,north. Run once per theme.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const RELEASE = process.env.OVERTURE_RELEASE ?? "2026-08-19.0";
const S3 = `s3://overturemaps-us-west-2/release/${RELEASE}`;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const theme = arg("theme", "places");
const bbox = arg("bbox", "12.0,48.5,18.9,51.1");
const out = resolve(repo, arg("out", `apps/web/public/overture/${theme}.pmtiles`));
const maxFeatures = Number(arg("max-features", "200000"));
const maxZoom = Number(arg("max-zoom", "14"));

const values = bbox.split(",").map(Number);
if (values.length !== 4 || !values.every(Number.isFinite)) {
  console.error(`--bbox must be west,south,east,north (got "${bbox}")`);
  process.exit(1);
}
const [west, south, east, north] = values;

const SOURCES = {
  places: {
    parquet: `${S3}/theme=places/type=place/*.parquet`,
    /** Tile layer name; the web layer's `sourceLayer` reads this exact string. */
    layer: "place",
    // `category` is the top-level taxonomy value, which is what the layer colours by; the specific
    // `basic_category` is kept alongside so a future popup can be more precise than the colour.
    select: `
      id,
      coalesce(names.primary, names.common.cs, names.common.en) AS name,
      taxonomy.hierarchy[1] AS category,
      coalesce(basic_category, 'other') AS basic_category,
      confidence
    `
  },
  buildings: {
    parquet: `${S3}/theme=buildings/type=building/*.parquet`,
    layer: "building",
    select: `
      id,
      names.primary AS name,
      class,
      height
    `
  }
};

const source = SOURCES[theme];
if (!source) {
  console.error(`Unknown theme "${theme}". Known: ${Object.keys(SOURCES).join(", ")}`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
// Intermediates are dot-files beside the archive and are removed afterwards either way.
const geojsonPath = resolve(dirname(out), `.${theme}.geojson`);
const pmtilesTmp = resolve(dirname(out), `.${theme}.tmp.pmtiles`);

// The bbox predicate is pushed into the Parquet scan: only intersecting row groups are read.
const exportSql = `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
SET s3_region='us-west-2';
SET http_timeout=300000;
-- Coordinates are lon/lat throughout; pinning the axis order stops the GDAL driver from
-- interpreting EPSG:4326 as lat/lon and writing swapped geometry.
SET geometry_always_xy = true;

COPY (
  SELECT
    ${source.select},
    ST_Point(
      bbox.xmin + (bbox.xmax - bbox.xmin) / 2,
      bbox.ymin + (bbox.ymax - bbox.ymin) / 2
    ) AS geom
  FROM read_parquet('${source.parquet}', hive_partitioning=1)
  WHERE bbox.xmin >= ${west} AND bbox.xmax <= ${east}
    AND bbox.ymin >= ${south} AND bbox.ymax <= ${north}
  LIMIT ${maxFeatures}
) TO '${geojsonPath}' WITH (FORMAT GDAL, DRIVER 'GeoJSON');
`;

console.log(`Importing Overture "${theme}" for bbox ${bbox}`);
console.log(`  release ${RELEASE}, cap ${maxFeatures} features -> ${out}`);

function run(command, args, missing) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: repo });
  if (result.error?.code === "ENOENT") {
    console.error(missing);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run(
    "duckdb",
    ["-c", exportSql],
    "duckdb is not installed. See https://duckdb.org/docs/installation/"
  );

  // tippecanoe v2 writes PMTiles directly. `-l` names the tile layer exactly as the web layer's
  // `sourceLayer` expects; --drop-densest keeps the file small, which is the point of the extract.
  run(
    "tippecanoe",
    [
      "-o",
      pmtilesTmp,
      "-l",
      source.layer,
      "-zg",
      `-z${maxZoom}`,
      "--drop-densest-as-needed",
      "--extend-zooms-if-still-dropping",
      "--quiet",
      "--no-progress-indicator",
      "--force",
      geojsonPath
    ],
    "tippecanoe is not installed. See https://github.com/felt/tippecanoe"
  );

  // Move into place only once the archive exists, so a failed run never leaves a half-written
  // archive where the server would serve it.
  rmSync(out, { force: true });
  spawnSync("mv", [pmtilesTmp, out], { stdio: "inherit" });

  const size = statSync(out).size;
  console.log(`\nDone: ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`Serve it at /overture/${theme}.pmtiles and set OVERTURE_ENABLED=1 on the API.`);
} finally {
  rmSync(geojsonPath, { force: true });
  rmSync(pmtilesTmp, { force: true });
}
