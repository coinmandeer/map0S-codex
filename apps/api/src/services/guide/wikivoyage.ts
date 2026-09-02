/**
 * Wikivoyage as the guide source.
 *
 * It is literally the "what to do in city X" genre, published under CC BY-SA with a keyless
 * MediaWiki API and articles in Czech as well as English. Crucially the content is structured:
 * listings carry coordinates, so a guide entry can be clicked and flown to on the map.
 *
 * The alternative — TripAdvisor — was rejected on purpose: 1 000 free calls a month is about
 * thirty a day, and its display requirements would bake mandatory branding into every fork.
 */

import type {
  Guide,
  GuideArea,
  GuideSection,
  GuideSectionId,
  GuideSourceAdapter
} from "@mapos/layer-sdk";
import { GUIDE_SECTION_TITLES } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { leadParagraph, parseTemplates, splitSections, stripMarkup } from "./wikitext.js";

/** Which Wikivoyage editions to try, in order. Czech is small, so a missing article falls back
 *  to English rather than showing an empty guide. */
const FALLBACK_LANGS = ["en"];

/** Listing templates, mapped to the section they belong to. Wikivoyage uses both the generic
 *  `{{listing|type=see}}` and the shorthand `{{see}}`. */
const LISTING_SECTIONS: Record<string, GuideSectionId> = {
  see: "see",
  do: "do",
  eat: "eat",
  drink: "drink",
  sleep: "sleep",
  buy: "buy",
  vidk: "see",
  aktivita: "do",
  restaurace: "eat",
  bar: "drink",
  ubytovani: "sleep",
  nakup: "buy"
};

const SECTION_ORDER: GuideSectionId[] = ["understand", "see", "do", "eat", "drink", "sleep", "buy"];

interface GeoSearchResult {
  pageid: number;
  title: string;
  dist: number;
}

async function nearestArticle(
  lang: string,
  lat: number,
  lng: number,
  radiusM: number
): Promise<GeoSearchResult | null> {
  const data = await fetchJson<{ query?: { geosearch?: GeoSearchResult[] } }>(
    `https://${lang}.wikivoyage.org/w/api.php?action=query&list=geosearch&format=json&formatversion=2` +
      `&gscoord=${lat}|${lng}&gsradius=${Math.round(radiusM)}&gslimit=5`,
    { providerId: "wikivoyage", ttlMs: 6 * 60 * 60_000 }
  );
  // The nearest article to a viewport centre is the settlement it is in; district and hotel
  // articles sort after it because MediaWiki returns geosearch by distance.
  return data.query?.geosearch?.[0] ?? null;
}

async function articleWikitext(lang: string, title: string): Promise<string | null> {
  const data = await fetchJson<{ parse?: { wikitext?: string } }>(
    `https://${lang}.wikivoyage.org/w/api.php?action=parse&format=json&formatversion=2` +
      `&prop=wikitext&page=${encodeURIComponent(title)}`,
    { providerId: "wikivoyage", ttlMs: 24 * 60 * 60_000 }
  );
  return data.parse?.wikitext ?? null;
}

function coordinate(raw: string | undefined): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) && value !== 0 ? value : undefined;
}

function sectionsFrom(wikitext: string, lang: string, title: string): GuideSection[] {
  const byId = new Map<GuideSectionId, GuideSection>();

  const lead = leadParagraph(wikitext);
  if (lead) {
    byId.set("understand", {
      id: "understand",
      title: GUIDE_SECTION_TITLES.understand,
      intro: lead,
      items: []
    });
  }

  for (const { heading, body } of splitSections(wikitext)) {
    for (const template of parseTemplates(body)) {
      const type = template.params.type?.toLowerCase();
      const sectionId =
        LISTING_SECTIONS[template.name] ??
        (template.name === "listing" && type ? LISTING_SECTIONS[type] : undefined);
      if (!sectionId) continue;

      const name = stripMarkup(template.params.name ?? "");
      if (!name) continue;

      const section =
        byId.get(sectionId) ??
        (() => {
          const created: GuideSection = {
            id: sectionId,
            title: GUIDE_SECTION_TITLES[sectionId],
            // The article's own heading is more specific than our generic label — "Muzea" says
            // more than "Co vidět" — so it is kept as the intro.
            intro: heading,
            items: []
          };
          byId.set(sectionId, created);
          return created;
        })();

      section.items.push({
        name,
        lng: coordinate(template.params.long ?? template.params.lon),
        lat: coordinate(template.params.lat),
        description: stripMarkup(template.params.content ?? template.params.description ?? ""),
        address: stripMarkup(template.params.address ?? "") || undefined,
        phone: template.params.phone || undefined,
        hours: stripMarkup(template.params.hours ?? "") || undefined,
        price: stripMarkup(template.params.price ?? "") || undefined,
        url: template.params.url || undefined,
        sourceRef: template.params.wikidata
          ? `wikidata:${template.params.wikidata}`
          : `wikivoyage:${lang}:${title}#${name}`
      });
    }
  }

  return SECTION_ORDER.flatMap((id) => {
    const section = byId.get(id);
    return section && (section.items.length > 0 || section.intro) ? [section] : [];
  });
}

export const wikivoyage: GuideSourceAdapter = {
  id: "wikivoyage",
  label: "Wikivoyage",
  attribution: "Wikivoyage (CC BY-SA 4.0)",

  async fetchGuide(area: GuideArea): Promise<Guide | null> {
    const [west, south, east, north] = area.bbox;
    const lat = (south + north) / 2;
    const lng = (west + east) / 2;
    // Half the viewport's diagonal, clamped: MediaWiki caps geosearch at 10 km.
    const radiusM = Math.min(10_000, Math.max(1_000, (north - south) * 111_320));

    for (const lang of [area.lang, ...FALLBACK_LANGS]) {
      const article = await nearestArticle(lang, lat, lng, radiusM).catch(() => null);
      if (!article) continue;

      const wikitext = await articleWikitext(lang, article.title).catch(() => null);
      if (!wikitext) continue;

      const sections = sectionsFrom(wikitext, lang, article.title);
      if (!sections.length) continue;

      return {
        area: article.title,
        lang,
        sourceId: wikivoyage.id,
        attribution: wikivoyage.attribution,
        url: `https://${lang}.wikivoyage.org/wiki/${encodeURIComponent(article.title)}`,
        sections
      };
    }

    return null;
  }
};

export const __testing = { sectionsFrom };
