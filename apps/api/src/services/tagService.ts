import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export async function getTopTags(query?: string, limit = 20) {
  const rows = await db.execute<{ tag: string; count: number }>(sql`
    SELECT lower(trim(tag.value)) AS tag, count(*)::int AS count
    FROM user_pins up,
    LATERAL jsonb_array_elements_text(coalesce(up.tags, '[]'::jsonb)) AS tag(value)
    WHERE trim(tag.value) <> ''
    ${query ? sql`AND lower(trim(tag.value)) LIKE ${"%" + query.toLowerCase() + "%"}` : sql``}
    GROUP BY lower(trim(tag.value))
    ORDER BY count DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as { tag: string; count: number }[]).map((r) => ({
    tag: r.tag,
    count: Number(r.count)
  }));
}
