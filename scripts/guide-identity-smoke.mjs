import assert from "node:assert/strict";
const root = process.env.MAPOS_DRILL_MODULE_ROOT ?? "/app/apps/api/dist";
const { wikivoyage } = await import(`${root}/services/guide/wikivoyage.js`);
const guide = await wikivoyage.fetchGuide(
  { name: "Prague", wikidataId: "Q1085", lang: "cs", bbox: [14, 49, 15, 51] },
  AbortSignal.timeout(20000)
);
assert.ok(guide);
assert.ok(
  (guide.lang === "cs" && guide.area === "Praha") ||
    (guide.lang === "en" && guide.area === "Prague")
);
assert.equal(
  guide.url,
  `https://${guide.lang}.wikivoyage.org/wiki/${encodeURIComponent(guide.area)}`
);
assert.ok(guide.sections.length);
console.log(
  JSON.stringify({
    verified: true,
    entity: "Q1085",
    area: guide.area,
    lang: guide.lang,
    url: guide.url,
    sections: guide.sections.length
  })
);
