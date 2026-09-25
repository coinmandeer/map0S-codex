import assert from "node:assert/strict";
import test from "node:test";
import { decodeXmlText, xmlDirectElements, xmlElements, xmlWithoutNested } from "./xml.js";

/** Two levels of the same element name, which is how WMS expresses grouping and the case a
 *  nearest-close regex gets wrong. */
const NESTED = `<Capability>
  <Layer queryable="0">
    <Title>Group</Title>
    <Layer queryable="1"><Name>a</Name><Title>Alpha</Title></Layer>
    <Layer><Name>b</Name><Title>Beta</Title></Layer>
  </Layer>
</Capability>`;

test("a nested element keeps its whole content and reports its depth", () => {
  const all = xmlElements(NESTED, "Layer");
  assert.equal(all.length, 3);
  // Document order, outermost first, whatever the closing order was.
  assert.deepEqual(
    all.map((element) => element.depth),
    [0, 1, 1]
  );
  assert.ok(all[0]?.inner.includes("<Name>b</Name>"), "the group's content is not truncated");
  assert.equal(all[0]?.attributes.trim(), 'queryable="0"');
  assert.equal(all[1]?.attributes.trim(), 'queryable="1"');
});

test("direct elements are the outermost ones only", () => {
  const direct = xmlDirectElements(NESTED, "Layer");
  assert.equal(direct.length, 1);
  assert.ok(direct[0]?.inner.includes("<Title>Group</Title>"));
});

test("xmlWithoutNested leaves an element's own fields readable", () => {
  const group = xmlDirectElements(NESTED, "Layer")[0]!;
  const own = xmlWithoutNested(group.inner, "Layer");
  assert.ok(own.includes("<Title>Group</Title>"));
  assert.ok(!own.includes("Alpha"), "a child's title must not read as the group's");
  assert.ok(!own.includes("<Name>a</Name>"));
});

test("self-closing elements are read for their attributes", () => {
  const [element] = xmlElements(
    '<a><LatLonBoundingBox minx="1" maxy="2"/></a>',
    "LatLonBoundingBox"
  );
  assert.equal(element?.inner, "");
  assert.ok(element?.attributes.includes('minx="1"'));
});

test("an unmatched closing tag does not discard what was already read", () => {
  const all = xmlElements("<Layer><Name>a</Name></Layer></Layer>", "Layer");
  assert.equal(all.length, 1);
  assert.equal(all[0]?.inner, "<Name>a</Name>");
});

test("entities and CDATA decode, ampersand last", () => {
  assert.equal(decodeXmlText("Protected sites &amp; habitats"), "Protected sites & habitats");
  assert.equal(decodeXmlText("<![CDATA[a & b]]>"), "a & b");
  assert.equal(decodeXmlText("&amp;lt;"), "&lt;");
  assert.equal(decodeXmlText("&#x41;&#66;"), "AB");
});

test("empty self-closing elements without attributes are retained", () => {
  assert.deepEqual(
    xmlElements("<Root><Limits/><Limits /></Root>", "Limits").map((e) => e.inner),
    ["", ""]
  );
});
