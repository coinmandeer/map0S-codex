import { writeFile, mkdir } from "node:fs/promises";
import { allLayerPlugins } from "../apps/web/src/layers/index.ts";
import { CATALOG_GROUPS } from "../apps/web/src/ui/layers/catalogModel.ts";
import { catalogEvidence } from "../apps/web/src/ui/layers/catalogEvidence.ts";
import type { ServerCapabilities } from "@mapos/layer-sdk";

const origin = "https://mapos2.promptstudio3000.com";
const caps = process.argv.includes("--live-config")
  ? await fetch(`${origin}/api/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`config ${r.status}`);
        return r.json();
      })
      .then((body) => {
        const source = body.capabilities ?? body;
        // Never serialize public provider tokens or configuration secrets into the audit.
        return Object.fromEntries(
          Object.entries(source).filter(([, value]) => typeof value === "boolean")
        ) as unknown as ServerCapabilities;
      })
  : null;
const rows = CATALOG_GROUPS.flatMap((group) =>
  group.items.map((item) => ({
    id: item.id,
    layer: item.layer,
    name: item.cs,
    category: group.cs,
    filters: item.facet ? { [item.facet]: item.values } : {},
    ...catalogEvidence(item.layer, caps, item.facet ? { [item.facet]: item.values } : undefined)
  }))
);
const known = new Set(rows.map((r) => r.layer));
for (const plugin of allLayerPlugins())
  if (!known.has(plugin.manifest.id))
    rows.push({
      id: plugin.manifest.id,
      layer: plugin.manifest.id,
      name: plugin.manifest.name,
      category: "Doplňkový zdroj / runtime",
      filters: {},
      ...catalogEvidence(plugin.manifest.id, caps)
    });
await mkdir("docs/audits", { recursive: true });
await writeFile(
  "docs/audits/2026-09-20-layer-inventory.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      target: origin,
      configurationChecked: caps !== null,
      caveat:
        "Configuration and code inventory; status limited does not assert a successful live fetch. Runtime statistics and user imports are registered dynamically and expose the same source details in the panel.",
      rows
    },
    null,
    2
  ) + "\n"
);
console.log(
  JSON.stringify({
    catalogRows: rows.length,
    plugins: allLayerPlugins().length,
    configurationChecked: caps !== null,
    unavailable: rows.filter((r) => r.status === "unavailable").length
  })
);
