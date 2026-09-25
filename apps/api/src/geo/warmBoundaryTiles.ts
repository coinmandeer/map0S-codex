/** Offline, resumable generator using imported local geometry, never external providers. */
import { boundaryRepository, type DiscoverBoundaryLevel } from "./discoverBoundaries.js";
import { cachedBoundaryTile } from "./boundaryTileCache.js";
import { sql } from "../db/index.js";
const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) =>
  Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
async function main() {
  const revision = await boundaryRepository.manifest!();
  if (!revision) {
    console.log("No published local boundaries; warmup skipped");
    return;
  }
  const detailed = process.argv.includes("--all");
  const levels: Array<[DiscoverBoundaryLevel, number]> = [
    ["country", 3],
    ["adm1", 5],
    ...(detailed
      ? ([
          ["adm2", 7],
          ["lau", 9]
        ] as Array<[DiscoverBoundaryLevel, number]>)
      : [])
  ];
  let total = 0;
  // Includes Europe and adjacent islands; other coordinates remain available on demand.
  for (const [level, hi] of levels)
    for (let z = level === "lau" ? 6 : level === "adm2" ? 4 : 0; z <= hi; z++) {
      const jobs: Array<[number, number]> = [];
      for (let x = tileX(-32, z); x <= tileX(45, z); x++)
        for (let y = tileY(72, z); y <= tileY(34, z); y++) jobs.push([x, y]);
      let index = 0;
      const worker = async () => {
        while (index < jobs.length) {
          const [x, y] = jobs[index++]!;
          await cachedBoundaryTile([revision, level, z, x, y, null], () =>
            boundaryRepository.tile(level, z, x, y, revision)
          );
          if (++total % 100 === 0) console.log(JSON.stringify({ revision, level, z, total }));
        }
      };
      // Two workers leave room for interactive traffic and do not overload PostgreSQL.
      await Promise.all([worker(), worker()]);
      console.log(JSON.stringify({ revision, level, z, total, complete: true }));
    }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
