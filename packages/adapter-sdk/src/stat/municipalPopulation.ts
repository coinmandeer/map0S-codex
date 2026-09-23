import type { StatSeriesParseResult } from "./statSeries.js";

/** Join official municipality codes, never names or nearest centres. The year is pinned to
 * the published boundary edition. GISCO's zero placeholders remain missing observations. */
export function parseMunicipalPopulation(payload: unknown, density = false): StatSeriesParseResult {
  const { gisco, ine, boundaryEditions } = payload as {
    boundaryEditions?: Record<string, string>;
    gisco: { features: Array<{ properties: Record<string, unknown> }> };
    ine: Array<{
      MetaData?: Array<{ T3_Variable: string; Nombre: string; Codigo: string }>;
      Data?: Array<{ Anyo: number; Valor: number | null; Secreto?: boolean }>;
    }>;
  };
  if (!Array.isArray(gisco?.features) || !Array.isArray(ine))
    throw Error("Missing municipal source");
  const spanish = new Map<string, number>();
  for (const row of ine) {
    const dimensions = row.MetaData ?? [];
    const code = dimensions.find((d) => d.T3_Variable === "Municipios")?.Codigo;
    if (!code || !/^\d{5}$/.test(code)) continue;
    if (
      !dimensions.some((d) => d.T3_Variable === "Sexo" && d.Nombre === "Total") ||
      !dimensions.some((d) => d.T3_Variable === "Nacionalidad" && d.Nombre === "Total") ||
      !dimensions.some(
        (d) => d.T3_Variable === "Totales de edad" && d.Nombre === "Todas las edades"
      ) ||
      !dimensions.some((d) => d.T3_Variable === "Tipo de dato" && d.Nombre === "Dato base")
    )
      continue;
    const value = row.Data?.find((d) => d.Anyo === 2024 && !d.Secreto)?.Valor;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    if (spanish.has(code)) throw Error(`Duplicate INE municipality ${code}`);
    spanish.set(code, value);
  }
  if (!spanish.size) throw Error("INE has no municipal totals for the pinned 2024 edition");
  const seen = new Set<string>();
  const observations: StatSeriesParseResult["observations"] = [];
  for (const { properties: p } of gisco.features) {
    const code = p.GISCO_ID;
    if (typeof code !== "string" || !/^[A-Z]{2}_.+/.test(code) || Number(p.YEAR) !== 2024) continue;
    if (seen.has(code)) throw Error(`Duplicate GISCO municipality ${code}`);
    seen.add(code);
    const spanishCode = code.startsWith("ES_") ? code.slice(3) : null;
    const raw = spanishCode ? spanish.get(spanishCode) : p.POP_2024;
    const population =
      typeof raw === "number" && Number.isFinite(raw) && (spanishCode ? raw >= 0 : raw > 0)
        ? raw
        : null;
    const area = Number(p.AREA_KM2);
    const country =
      ({ EL: "GR", UK: "GB" } as Record<string, string>)[code.slice(0, 2)] ?? code.slice(0, 2);
    const boundaryEdition = boundaryEditions?.[country];
    if (boundaryEditions && (!boundaryEdition || !/^2024:[a-f0-9]{64}$/.test(boundaryEdition)))
      throw Error(`Missing immutable boundary edition for ${country}`);
    observations.push({
      ...(boundaryEdition ? { boundaryEdition } : {}),
      geoCode: code,
      period: "2024",
      value: density
        ? population !== null && area > 0 && Number.isFinite(area)
          ? population / area
          : null
        : population,
      flag: spanishCode ? "INE census 2024" : "GISCO LAU 2024"
    });
  }
  if (!observations.length) throw Error("No matching LAU 2024 identities");
  return { observations, geoLabels: {}, periods: ["2024"] };
}
