/** Public provider configuration verified against GetCapabilities, 2026-09-23.
 * No requests to Mapee, no startup probing, no downloaded feature database. */
export const CZECH_BOUNDS: [number, number, number, number] = [12.09, 48.55, 18.87, 51.06];
export const CZECH_SOURCES = {
  cadastre: {
    endpoint: "https://services.cuzk.gov.cz/wms/local-km-wms.asp",
    label: "© ČÚZK — katastr nemovitostí",
    terms: "Podmínky poskytování síťových služeb ČÚZK",
    url: "https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb.aspx"
  },
  networks: {
    endpoint: "https://dmvs.cuzk.gov.cz/api/wms/dtm_ti_ver",
    label: "© ČÚZK / krajské DTM — DMVS",
    terms: "Veřejné prohlížecí služby IS DMVS; podmínky poskytovatelů krajských DTM",
    url: "https://www.cuzk.gov.cz/DMVS/Poskytovani-dat.aspx"
  },
  connections: {
    endpoint: "https://dmvs.cuzk.gov.cz/api/wms/dtm_pripojky",
    label: "© ČÚZK / krajské DTM — přípojky",
    terms: "Veřejné prohlížecí služby IS DMVS; podmínky poskytovatelů krajských DTM",
    url: "https://www.cuzk.gov.cz/DMVS/Poskytovani-dat.aspx"
  },
  floods: {
    endpoint: "https://webmap.dppcr.cz/dpp_cr/wms.dll",
    label: "© MŽP — dPP ČR / Hydrosoft Veleslavín",
    terms: "Veřejná prohlížecí WMS dPP ČR; informativní zobrazení s atribucí",
    url: "https://webmap.dppcr.cz/dpp_cr/wms.dll?MAP=4870&TMPL=AJAX_MAIN"
  }
} as const;

export const CZECH_SUBGROUPS = [
  { id: "cadastre", cs: "Katastr", en: "Cadastre" },
  { id: "ownership", cs: "Vlastnictví", en: "Ownership categories" },
  { id: "easements", cs: "Věcná břemena", en: "Easements" },
  { id: "networks", cs: "Technické sítě", en: "Utility networks" },
  { id: "floods", cs: "Záplavy", en: "Flood zones" }
] as const;

export interface CzechLayerDefinition {
  id: string;
  cs: string;
  en: string;
  group: (typeof CZECH_SUBGROUPS)[number]["id"];
  source: keyof typeof CZECH_SOURCES;
  layers: string[];
  minZoom: number;
  opacity: number;
  inverse?: string[];
  legendUrl?: string;
  note?: string;
}

function cadastre(
  id: string,
  cs: string,
  en: string,
  layer: string,
  minZoom: number,
  inverse?: string[]
): CzechLayerDefinition {
  return {
    id: `cz-${id}`,
    cs,
    en,
    group: "cadastre",
    source: "cadastre",
    layers: [layer],
    minZoom,
    opacity: 1,
    inverse
  };
}

export const CZECH_LAYERS: CzechLayerDefinition[] = [
  cadastre("cadastre", "Parcely a budovy", "Parcels and buildings", "KN", 15, ["KN_I"]),
  cadastre("cadastral-areas", "Katastrální území", "Cadastral areas", "prehledky", 7),
  cadastre("parcel-numbers", "Čísla parcel", "Parcel numbers", "parcelni_cisla", 18, [
    "parcelni_cisla_i"
  ]),
  cadastre("building-numbers", "Čísla budov", "Building numbers", "DEF_BUDOVY", 17),
  cadastre(
    "boundary-quality",
    "Přesnost hranic",
    "Boundary accuracy",
    "hranice_parcel_barevne",
    17
  ),
  cadastre("boundary-points", "Lomové body", "Boundary points", "podrobne_body_barevne", 18),
  {
    ...cadastre(
      "discrepancies",
      "Nesoulady v katastru",
      "Cadastral discrepancies",
      "nemovitosti_nesoulady",
      16
    ),
    opacity: 0.65
  },
  {
    ...cadastre(
      "unidentified-owner",
      "Nedostatečně určený vlastník",
      "Insufficiently identified owner",
      "nem_nedostatecne_identif_vlast",
      17
    ),
    opacity: 0.65
  },
  cadastre("survey-points", "Geodetické body", "Survey points", "bp", 15),
  ...[
    ["state", "Stát", "State", "char_vl_stat"],
    ["regions", "Kraje", "Regions", "char_vl_kraje"],
    ["municipalities", "Obce", "Municipalities", "char_vl_obec"],
    ["private", "Soukromé a podílové", "Private and shared", "char_vl_soukr_podil"]
  ].map(([id, cs, en, layer]) => ({
    id: `cz-ownership-${id}`,
    cs: cs!,
    en: en!,
    group: "ownership" as const,
    source: "cadastre" as const,
    layers: [layer!],
    minZoom: 16,
    opacity: 0.6,
    note: "Kategorie vlastnictví bez jmen vlastníků."
  })),
  ...[
    ["chuze", "Chůze a jízda", "Passage and access"],
    ["vedeni", "Vedení sítí", "Utility easements"],
    ["uzivani", "Užívání pozemku", "Use of land"],
    ["listina", "Podle listiny", "Defined by deed"],
    ["ostatni", "Ostatní břemena", "Other easements"]
  ].map(([id, cs, en]) => ({
    id: `cz-easement-${id}`,
    cs: cs!,
    en: en!,
    group: "easements" as const,
    source: "cadastre" as const,
    layers: [`vb_plochy_cast_${id}`, `vb_plochy_parcela_${id}`],
    minZoom: 17,
    opacity: 0.6,
    note: "Informativní zákres; rozsah a obsah práva ověřte v příslušné listině."
  })),
  {
    id: "cz-networks",
    cs: "Veřejné technické sítě",
    en: "Public utility networks",
    group: "networks",
    source: "networks",
    layers: ["el_ved", "el_kom", "plyn", "voda", "kan", "teplo"],
    minZoom: 14,
    opacity: 0.85,
    note: "Veřejná část DTM. Chybějící zákres neznamená, že síť neexistuje; nenahrazuje vyjádření správce."
  },
  {
    id: "cz-connections",
    cs: "Domovní přípojky",
    en: "House connections",
    group: "networks",
    source: "connections",
    layers: ["el_ved_prip", "plyn_prip", "vod_prip", "kan_prip"],
    minZoom: 20,
    opacity: 0.85
  },
  ...[
    ["q5", "Pětiletá voda (Q5)", "5-year flood (Q5)", "5412"],
    ["q20", "Dvacetiletá voda (Q20)", "20-year flood (Q20)", "5415"],
    ["q100", "Stoletá voda (Q100)", "100-year flood (Q100)", "5418"],
    ["qa", "Aktivní zóny", "Active flood zones", "5409"]
  ].map(([id, cs, en, legend]) => ({
    id: `cz-flood-${id}`,
    cs: cs!,
    en: en!,
    group: "floods" as const,
    source: "floods" as const,
    layers: [`wms_${id}`],
    minZoom: 13,
    opacity: 0.55,
    legendUrl: `${CZECH_SOURCES.floods.endpoint}?GEN=OGSICON&MAP=${legend}`,
    note: "Stanovená záplavová území, nikoli aktuální povodeň. Prázdná mapa nepotvrzuje nepřítomnost rizika."
  }))
];
