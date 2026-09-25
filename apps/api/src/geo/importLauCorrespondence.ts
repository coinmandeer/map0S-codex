import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sql } from "../db/index.js";
const officialUrl =
  "https://ec.europa.eu/eurostat/documents/345175/501971/EU-27-LAU-2024-NUTS-2024.xlsx/12971f56-c035-dbab-4d9f-ff1dcc617bb3";
export function validateLauCorrespondence(data: unknown): {
  sha256: string;
  sourceUrl: string;
  rows: { country: string; lau: string; nuts3: string }[];
} {
  const d = data as {
    schema: number;
    lauYear: string;
    nutsEdition: string;
    sha256: string;
    sourceUrl: string;
    rows: { country: string; lau: string; nuts3: string }[];
  } | null;
  if (
    d?.schema !== 1 ||
    d.lauYear !== "2024" ||
    d.nutsEdition !== "2024" ||
    d.sourceUrl !== officialUrl ||
    !/^[a-f0-9]{64}$/.test(d.sha256) ||
    !Array.isArray(d.rows) ||
    !d.rows.length ||
    d.rows.length > 150000
  )
    throw new Error("Invalid pinned correspondence manifest");
  const seen = new Set<string>();
  for (const r of d.rows) {
    const prefix = ({ GR: "EL", GB: "UK" } as Record<string, string>)[r.country] ?? r.country;
    if (
      !/^[A-Z]{2}$/.test(r.country) ||
      !new RegExp(`^${prefix}_[A-Za-z0-9_.-]+$`).test(r.lau) ||
      !new RegExp(`^${prefix}[A-Z0-9]{3}$`).test(r.nuts3) ||
      seen.has(r.lau)
    )
      throw new Error("Invalid/duplicate official territorial code");
    seen.add(r.lau);
  }
  return d;
}
export async function importLauCorrespondence(path: string) {
  const bytes = await readFile(path);
  if (bytes.length > 24 * 1024 * 1024) throw new Error("Input exceeds limit");
  const data = validateLauCorrespondence(JSON.parse(bytes.toString()));
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('mapos:lau-correspondence:2024'))`;
    await tx`CREATE TEMP TABLE incoming_lau_crosswalk(country TEXT,lau TEXT,nuts3 TEXT) ON COMMIT DROP`;
    for (let i = 0; i < data.rows.length; i += 500)
      await tx`INSERT INTO incoming_lau_crosswalk ${tx(data.rows.slice(i, i + 500), "country", "lau", "nuts3")}`;
    // Only editions actually installed in this application participate. No boundary is created or relabelled.
    await tx`CREATE TEMP TABLE matched_lau_crosswalk ON COMMIT DROP AS
      SELECT DISTINCT a.source_id,a.level source_level,a.code source_code,a.edition source_edition,
        g.source_id target_source_id,g.level target_level,g.code target_code,g.edition target_edition
      FROM incoming_lau_crosswalk i JOIN geo_units a ON a.country=i.country AND a.code=i.lau
        AND a.level='lau' AND a.source_id='gisco-lau-'||lower(i.country) AND a.edition LIKE '2024:%'
      JOIN geo_units g ON g.source_id='gisco-nuts' AND g.edition='2024' AND
        ((g.level='nuts3' AND g.code=i.nuts3) OR (g.level='nuts2' AND g.code=left(i.nuts3,4)) OR (g.level='nuts1' AND g.code=left(i.nuts3,3)))`;
    const conflicts =
      await tx`SELECT 1 FROM matched_lau_crosswalk n JOIN geo_unit_correspondences o USING(source_id,source_level,source_code,source_edition,target_source_id,target_level,target_edition) WHERE o.target_code<>n.target_code LIMIT 1`;
    if (conflicts.length)
      throw new Error(
        "Published correspondence conflicts: create a new edition; existing mapping was preserved"
      );
    const inserted = await tx`INSERT INTO geo_unit_correspondences
      SELECT n.*,'part_of',${data.sourceUrl},${data.sha256},NOW() FROM matched_lau_crosswalk n ON CONFLICT DO NOTHING RETURNING source_code`;
    const coverage =
      await tx`SELECT left(source_code,2) country,target_level,count(DISTINCT source_code)::int count FROM matched_lau_crosswalk GROUP BY 1,2 ORDER BY 1,2`;
    if (!coverage.length) throw new Error("No installed editions match; nothing published");
    return {
      sourceSha256: data.sha256,
      inputRows: data.rows.length,
      inserted: inserted.length,
      coverage
    };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  importLauCorrespondence(process.argv[2] ?? "")
    .then((result) => console.log(JSON.stringify(result)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
