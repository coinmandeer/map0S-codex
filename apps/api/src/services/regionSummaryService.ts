import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { regionSummaries } from "../db/schema.js";
import { getRegion } from "./regionService.js";

function fallbackText(name: string): string {
  return `${name} je region Česka plný míst k objevování. Přibliž mapu, zapni kategorie v Vrstvách a koukni na hrady, vyhlídky i příspěvky lidí.`;
}

export async function getRegionSummary(
  regionId: string
): Promise<{ text: string; model: string | null; cached: boolean }> {
  const region = getRegion(regionId);
  const name = region?.name ?? regionId;
  const [cached] = await db
    .select()
    .from(regionSummaries)
    .where(eq(regionSummaries.regionId, regionId))
    .limit(1);
  if (cached) return { text: cached.text, model: cached.model, cached: true };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    const text = fallbackText(name);
    await db
      .insert(regionSummaries)
      .values({ regionId, text, model: "fallback" })
      .onConflictDoNothing();
    return { text, model: "fallback", cached: false };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Jsi stručný cestovatelský průvodce. Piš česky, 2–3 věty, bez markdownu a bez odrážek."
          },
          {
            role: "user",
            content: `Napiš krátký souhrn regionu ${name} v Česku: příroda, kultura, jídlo, co stojí za návštěvu.`
          }
        ]
      }),
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim() || fallbackText(name);
    await db
      .insert(regionSummaries)
      .values({ regionId, text, model: "gpt-4o-mini" })
      .onConflictDoNothing();
    return { text, model: "gpt-4o-mini", cached: false };
  } catch {
    const text = fallbackText(name);
    return { text, model: "fallback", cached: false };
  }
}
