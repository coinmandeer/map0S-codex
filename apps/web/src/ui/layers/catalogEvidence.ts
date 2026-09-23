import { getLayerManifestV2, getLayerPlugin, layerUnavailableReason } from "../../layers/registry";
import type { ServerCapabilities, FilterValues } from "@mapos/layer-sdk";
import { CZECH_LAYERS } from "../../layers/plugins/czechSources";

const CONTEXT: Record<string, { coverage: string; period: string; geometry?: string }> = {
  "live-aircraft": {
    coverage: "Přijímače ADS-B; nejvýše 250 NM od středu dotazu a 400 letadel",
    period: "Živé zprávy, kontrolujte stáří polohy",
    geometry: "Bodový symbol letadla"
  },
  "live-vessels": {
    coverage: "AISstream podle přijímačů; bez klíče pouze finské vody; nejvýše 600 lodí",
    period: "Živé AIS zprávy, bez záruky úplnosti",
    geometry: "Bodový symbol lodi"
  },
  "overture-places": {
    coverage: "Pouze provozovatelem importovaný výřez",
    period: "Stav posledního importu; datum poskytuje provozovatel",
    geometry: "Bodové piny ve vektorových dlaždicích"
  },
  "overture-buildings": {
    coverage: "Pouze provozovatelem importovaný výřez",
    period: "Stav posledního importu; datum poskytuje provozovatel",
    geometry: "Polygony budov"
  },
  "street-objects": {
    coverage: "Místa zachycená Mapillary, od přiblížení 14",
    period: "Historická detekce objektů ze snímků; nemusí odpovídat dnešku",
    geometry: "Bodové piny ve vektorových dlaždicích"
  },
  "dark-sky": {
    coverage: "Globální satelitní kompozit",
    period: "2016; historická noční světla, nikoli aktuální měření tmy"
  },
  "land-cover": {
    coverage: "Globální klasifikace MODIS IGBP",
    period: "Roční; rok se volí ve filtru"
  },
  inaturalist: {
    coverage: "Dobrovolná pozorování; nejvýše 200 nejnovějších ve výřezu",
    period: "Datum pozorování na jednotlivých záznamech"
  },
  satellites: {
    coverage: "Družice s dostupnými orbitálními elementy",
    period: "Vypočtená poloha SGP4; stáří elementů v detailu",
    geometry: "Symboly a předpovězené dráhy"
  },
  openseamap: {
    coverage: "Komunitně mapované námořní značky",
    period: "Aktualizace podle poskytovatele; neobsahuje živé lodě"
  }
};

/** Unknown facts stay explicit: a registered plugin is not evidence of provider uptime. */
export function catalogEvidence(
  id: string,
  caps: ServerCapabilities | null,
  filters?: FilterValues
) {
  const czech = CZECH_LAYERS.find((def) => def.id === id);
  const plugin = getLayerPlugin(id),
    manifest = getLayerManifestV2(id),
    context = czech
      ? {
          coverage: `Česká republika, od přiblížení ${czech.minZoom}; úplnost závisí na zdroji. ${czech.note ?? "Prázdný zákres není potvrzením nepřítomnosti jevu."}`,
          period:
            "Aktuální prohlížecí služba; datum jednotlivých záznamů není WMS obrázkem doloženo.",
          geometry: "Průhledný rastrový mapový překryv"
        }
      : CONTEXT[id];
  const reason = layerUnavailableReason(id, caps, filters);
  return {
    status: reason ? "unavailable" : plugin?.manifest.experimental ? "experimental" : "limited",
    reason:
      reason ?? "Funkčnost závisí na pokrytí a odpovědi zdroje; stav načtení je uveden u vrstvy.",
    source: plugin?.attribution?.map((a) => a.label).join(" · ") || "Zdroj není deklarovaný",
    geometry: context?.geometry ?? manifest?.geometryKinds.join(", ") ?? plugin?.kind ?? "Neurčeno",
    coverage: context?.coverage ?? manifest?.description ?? "Pokrytí není deklarované",
    period:
      context?.period ??
      (manifest?.temporal
        ? JSON.stringify(manifest.temporal)
        : "Časová platnost závisí na jednotlivých záznamech / poskytovateli"),
    refresh: plugin?.manifest.performance?.refreshIntervalMs
      ? `${plugin.manifest.performance.refreshIntervalMs / 1000} s`
      : "Při změně výřezu či filtrů; cache dle zdroje",
    license:
      plugin?.attribution
        ?.map((a) => a.license)
        .filter(Boolean)
        .join(" · ") || "Licence není deklarovaná",
    configuration:
      manifest?.requiresServerCapabilities?.join(", ") ||
      plugin?.manifest.requiresCapability ||
      "Bez deklarované konfigurace",
    verification: "Implementace zkontrolována; živá dostupnost není zaručena registrací vrstvy"
  };
}
