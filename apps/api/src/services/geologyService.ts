/**
 * What the ground is made of, from Macrostrat.
 *
 * Macrostrat stitches national geological surveys into one global map, free and without a key,
 * and hands back what it knows at a point: the rock, when it formed, and whatever the original
 * survey wrote about it. That last part is why this module exists in the shape it does — the raw
 * answer is "Cadomian shale/slate, Ediacaran–Cryogenian, 541–720 Ma", which is precise, correct
 * and meaningless to almost everyone. CML turns it into a sentence a person can use, and the raw
 * fields are kept alongside so nothing is lost in the retelling.
 *
 * Where the survey text is in German or French, the same call does the translating.
 */

import type { CmlAnswer } from "./cmlService.js";
import { askCml } from "./cmlService.js";
import { aiPrompt } from "./ai/prompts/index.js";
import { fetchJson } from "../utils/upstream.js";

const MACROSTRAT_POINT = "https://macrostrat.org/api/v2/geologic_units/map";

interface MacrostratUnit {
  map_id?: number;
  source_id?: number;
  name?: string;
  strat_name?: string;
  lith?: string;
  descrip?: string;
  comments?: string;
  color?: string;
  b_int_name?: string;
  t_int_name?: string;
  best_int_name?: string;
  b_age?: number;
  t_age?: number;
  ref?: { ref_source?: string; authors?: string; ref_year?: string; url?: string };
}

interface MacrostratResponse {
  success?: { data?: MacrostratUnit[] };
}

export interface GeologyUnit {
  id: string;
  name: string;
  lithology: string | null;
  /** The survey's own words, in whatever language they wrote them. */
  description: string | null;
  period: string | null;
  /** Millions of years, oldest first — `[720, 541]` reads as "720 to 541 Ma". */
  ageRange: [number, number] | null;
  color: string | null;
}

export interface GeologyReport {
  units: GeologyUnit[];
  /** Plain Czech, generated. Null when this deployment has no model or the model didn't answer —
   *  the units are still there to show. */
  explanation: string | null;
  model: string | null;
  attribution: string;
}

function age(unit: MacrostratUnit): [number, number] | null {
  const bottom = unit.b_age;
  const top = unit.t_age;
  if (!Number.isFinite(bottom) || !Number.isFinite(top)) return null;
  return [bottom as number, top as number];
}

/**
 * Czech names for the international time scale, plus the regional stages Central European
 * surveys use.
 *
 * Translating these here rather than in the prompt is not only cheaper — it is more correct. Left
 * to itself the model read "Cadomian shale" next to "Cryogenian – Ediacaran" and called the rock
 * Cambrian, which is a plausible-sounding error a reader has no way to catch. Periods are a
 * closed vocabulary, so they get looked up, and the model is left with the part that genuinely
 * needs judgement.
 */
const PERIOD_CS: Record<string, string> = {
  hadean: "hadaikum",
  archean: "archaikum",
  proterozoic: "proterozoikum",
  paleoproterozoic: "paleoproterozoikum",
  mesoproterozoic: "mezoproterozoikum",
  neoproterozoic: "neoproterozoikum",
  tonian: "ton",
  cryogenian: "kryogén",
  ediacaran: "ediakara",
  phanerozoic: "fanerozoikum",
  paleozoic: "paleozoikum",
  cambrian: "kambrium",
  ordovician: "ordovik",
  // Surveys often report the stage rather than the period, and German maps of the Barrandian
  // reach for these by name.
  tremadocian: "tremadok",
  floian: "flo",
  arenigian: "arenig",
  llanvirnian: "llanvirn",
  caradocian: "caradok",
  ashgillian: "ashgill",
  silurian: "silur",
  devonian: "devon",
  carboniferous: "karbon",
  mississippian: "spodní karbon",
  pennsylvanian: "svrchní karbon",
  namurian: "namur",
  westphalian: "westfal",
  stephanian: "stefan",
  permian: "perm",
  mesozoic: "druhohory",
  triassic: "trias",
  jurassic: "jura",
  cretaceous: "křída",
  cenozoic: "třetihory a čtvrtohory",
  paleogene: "paleogén",
  paleocene: "paleocén",
  eocene: "eocén",
  oligocene: "oligocén",
  neogene: "neogén",
  miocene: "miocén",
  pliocene: "pliocén",
  quaternary: "kvartér",
  pleistocene: "pleistocén",
  holocene: "holocén"
};

/** Names arrive as "Early Cretaceous", "Late Jurassic" and so on — the qualifier translates
 *  separately from the period it qualifies. */
const QUALIFIER_CS: Record<string, string> = {
  early: "spodní",
  lower: "spodní",
  middle: "střední",
  late: "svrchní",
  upper: "svrchní"
};

function periodToCzech(name: string): string {
  const words = name.trim().split(/\s+/);
  const translated = words.map((word) => {
    const key = word.toLowerCase();
    return QUALIFIER_CS[key] ?? PERIOD_CS[key] ?? word;
  });
  // A qualifier translated but its period not means we're guessing at half a name; the original
  // is less misleading than a half-Czech one.
  const known = translated.some((word, i) => word !== words[i]);
  return known ? translated.join(" ") : name;
}

/**
 * Rock names in Czech.
 *
 * Same reasoning as the periods, and the same evidence: asked to translate "shale/slate" the
 * model produced "břidlice a svátky", having taken slate for a word about holidays. Macrostrat's
 * lithology strings are drawn from a controlled vocabulary of a few dozen terms, so they get
 * looked up too, and what reaches the model is already Czech.
 */
const LITHOLOGY_CS: Record<string, string> = {
  shale: "břidlice",
  slate: "jílovitá břidlice",
  phyllite: "fylit",
  schist: "svor",
  gneiss: "rula",
  granite: "žula",
  granodiorite: "granodiorit",
  gabbro: "gabro",
  diorite: "diorit",
  basalt: "čedič",
  andesite: "andezit",
  rhyolite: "ryolit",
  tuff: "tuf",
  sandstone: "pískovec",
  siltstone: "prachovec",
  claystone: "jílovec",
  mudstone: "kalovec",
  conglomerate: "slepenec",
  breccia: "brekcie",
  limestone: "vápenec",
  dolomite: "dolomit",
  marl: "slín",
  chalk: "psací křída",
  quartzite: "křemenec",
  marble: "mramor",
  amphibolite: "amfibolit",
  serpentinite: "hadec",
  coal: "uhlí",
  peat: "rašelina",
  loess: "spraš",
  clay: "jíl",
  silt: "prach",
  sand: "písek",
  gravel: "štěrk",
  till: "souvková hlína",
  alluvium: "náplavy",
  sediment: "sediment",
  sedimentary: "usazené",
  metamorphic: "přeměněné",
  igneous: "vyvřelé",
  volcanic: "sopečné",
  plutonic: "hlubinné",
  rock: "horniny",
  rocks: "horniny",
  scree: "suť",
  argillaceous: "jílovitý",
  arenaceous: "písčitý",
  calcareous: "vápnitý",
  tremadocian: "tremadok",
  floian: "flo",
  arenigian: "arenig",
  llanvirnian: "llanvirn",
  major: "hlavně",
  minor: "vedlejší",
  // Unit names lead with the age as an adjective — "Neoproterozoic sedimentary rocks" — which
  // needs a different Czech word than the period does on its own.
  precambrian: "prekambrické",
  proterozoic: "proterozoické",
  neoproterozoic: "neoproterozoické",
  mesoproterozoic: "mezoproterozoické",
  paleoproterozoic: "paleoproterozoické",
  archean: "archaické",
  paleozoic: "prvohorní",
  cambrian: "kambrické",
  ordovician: "ordovické",
  silurian: "silurské",
  devonian: "devonské",
  carboniferous: "karbonské",
  permian: "permské",
  mesozoic: "druhohorní",
  triassic: "triasové",
  jurassic: "jurské",
  cretaceous: "křídové",
  cenozoic: "třetihorní",
  tertiary: "třetihorní",
  quaternary: "kvartérní"
};

/**
 * Some surveys report lithology as `Major:{sandstone}, Minor{siltstone,shale}`. Read as-is that
 * is a struct someone forgot to render, so the braces are unpacked before anything else sees it.
 */
function flattenLithology(text: string): string {
  const major = /Major:?\s*\{([^}]*)\}/i.exec(text)?.[1];
  const minor = /Minor:?\s*\{([^}]*)\}/i.exec(text)?.[1];
  if (!major && !minor) return text;
  const tidy = (list: string) =>
    list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  const parts = [major && tidy(major), minor && `vedlejší: ${tidy(minor)}`].filter(Boolean);
  return parts.join(", ");
}

/** Values arrive as free-ish text — "shale/slate", "Claystone, sandstone, conglomerate, coal" —
 *  so the separators are kept and only the words between them are looked up. */
function lithologyToCzech(raw: string): string {
  return flattenLithology(raw).replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    const czech = LITHOLOGY_CS[word.toLowerCase()];
    if (!czech) return word;
    // "Claystone, sandstone" opens with a capital; keep the sentence looking like one.
    return word[0] === word[0]?.toUpperCase() && word.length > 1
      ? czech[0]!.toUpperCase() + czech.slice(1)
      : czech;
  });
}

/** Test seams. */
export { periodToCzech as __periodToCzech, lithologyToCzech as __lithologyToCzech };

function period(unit: MacrostratUnit): string | null {
  const from = unit.b_int_name?.trim();
  const to = unit.t_int_name?.trim();
  if (from && to && from !== to) return `${periodToCzech(from)} – ${periodToCzech(to)}`;
  const single = from || to || unit.best_int_name?.trim();
  return single ? periodToCzech(single) : null;
}

function toUnit(unit: MacrostratUnit, index: number): GeologyUnit {
  const lith = unit.lith?.trim();
  const name = unit.name?.trim() || unit.strat_name?.trim() || lith;
  return {
    id: String(unit.map_id ?? `unit-${index}`),
    // Many units are named after their rock rather than a formation, so the name goes through
    // the same lookup — otherwise the list reads half in Czech and half in English.
    name: name ? lithologyToCzech(name) : "",
    lithology: lith ? lithologyToCzech(lith) : null,
    description: unit.descrip?.trim() || unit.comments?.trim() || null,
    period: period(unit),
    ageRange: age(unit),
    color: unit.color?.trim() || null
  };
}

/** Ages span nine orders of magnitude, so the unit has to change with them. */
function humanAge(range: [number, number]): string {
  const [older, younger] = range;
  const fmt = (ma: number) =>
    ma >= 1 ? `${Math.round(ma)} mil. let` : `${Math.round(ma * 1000)} tis. let`;
  return `před ${fmt(older)} až ${fmt(younger)}`;
}

const GEOLOGY_TEMPLATE_VERSION = "geology-explanation.v1";

function prompt(units: GeologyUnit[]): string {
  const lines = units.slice(0, 3).map((u) => {
    const parts = [u.name];
    if (u.lithology && u.lithology !== u.name) parts.push(`hornina: ${u.lithology}`);
    if (u.period) parts.push(`období: ${u.period}`);
    if (u.ageRange) parts.push(humanAge(u.ageRange));
    if (u.description) parts.push(`popis zdroje: ${u.description.slice(0, 400)}`);
    return `- ${parts.join(", ")}`;
  });
  return `Geologické jednotky v tomto místě:\n${lines.join("\n")}`;
}

export async function getGeologyAt(lng: number, lat: number): Promise<GeologyReport | null> {
  const url = `${MACROSTRAT_POINT}?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`;
  let raw: MacrostratResponse;
  try {
    raw = await fetchJson<MacrostratResponse>(url, {
      providerId: "macrostrat",
      // The bedrock does not change; the coordinates are rounded to ~10 m, so this caches well.
      ttlMs: 7 * 24 * 3600_000
    });
  } catch {
    return null;
  }

  // A survey sometimes maps an area without naming the rock. Such a unit contributes a row
  // saying nothing, so it is dropped rather than shown as "unknown".
  const units = (raw.success?.data ?? []).map(toUnit).filter((u) => u.name);

  if (!units.length) return null;

  const answer: CmlAnswer | null = await askCml({
    cacheKey: `geology|${units.map((u) => u.id).join(",")}`,
    system: aiPrompt(GEOLOGY_TEMPLATE_VERSION),
    prompt: prompt(units),
    maxTokens: 2000,
    verifiedPublic: true
  }).catch(() => null);

  return {
    units,
    explanation: answer?.text ?? null,
    model: answer?.model ?? null,
    attribution: "Macrostrat (CC BY 4.0) — data národních geologických služeb"
  };
}
