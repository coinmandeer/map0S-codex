/**
 * Manual smoke check against the real upstreams: `npx tsx src/services/dataSources/live-check.ts`
 * from apps/api. Not part of `npm test` — these are third-party services, and a CI run that
 * fails because someone else's server is down teaches everyone to ignore CI.
 */

import type { Bbox } from "@mapos/layer-sdk";
import { dataSourceProviders } from "./index.js";

const PRAGUE: Bbox = [14.38, 50.06, 14.47, 50.11];

for (const provider of dataSourceProviders) {
  const started = Date.now();
  try {
    const result = await provider.features!({ bbox: PRAGUE, query: {} });
    const took = Date.now() - started;
    const sample = result.features[0]?.properties.name ?? "—";
    console.log(
      `${provider.id.padEnd(18)} ${String(result.features.length).padStart(4)} features` +
        ` ${String(took).padStart(6)}ms  ${result.notice ? `notice: ${result.notice}` : sample}`
    );
  } catch (err) {
    console.error(`${provider.id.padEnd(18)} FAILED  ${(err as Error).message}`);
  }
}
