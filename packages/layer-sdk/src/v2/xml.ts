/**
 * Enough XML to read the two grammars MapOS actually consumes: GPX 1.1 and OGC
 * `GetCapabilities`. Both are read by hand rather than through a parser, and that is the safer
 * choice here, not a shortcut — nothing below resolves an external entity or expands a nested
 * one, so neither XXE nor a billion-laughs document has anything to act on. A WMS capabilities
 * document is served by whatever URL a user pasted, which is exactly the input you do not want
 * to hand to a general parser.
 *
 * The cost is that these functions do not understand XML in general: they match by local name,
 * ignore namespaces, and cannot tell a comment from an element. That is acceptable for reading
 * a known vocabulary and would not be for writing one.
 */

export interface XmlElement {
  attributes: string;
  inner: string;
  /** How many elements of the same name enclose this one. `0` for the outermost. */
  depth: number;
}

export function decodeXmlText(value: string): string {
  return (
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Last, so a document that wrote `&amp;lt;` still ends up with the literal `&lt;`.
      .replace(/&amp;/g, "&")
  );
}

/**
 * Every `<tag>` in `source`, including self-closing ones, at any depth, in document order.
 *
 * The name is matched with an optional namespace prefix, because the same capabilities document
 * is served as `<Layer>` by one server and `<wms:Layer>` by the next, and a caller asking for
 * "Layer" means the element regardless of which.
 *
 * Opening and closing tags are paired by counting depth rather than by matching the nearest
 * close. That distinction is the whole game for WMS, which nests `<Layer>` inside `<Layer>`: a
 * non-greedy regex ends a group at its first child's `</Layer>`, so the group's content is
 * truncated and its children read as siblings of it.
 */
export function xmlElements(source: string, tag: string): XmlElement[] {
  const pattern = new RegExp(`<(/)?(?:[\\w.-]+:)?${tag}(\\b[^>]*?)?(/)?>`, "gi");
  const open: Array<{ attributes: string; from: number; depth: number }> = [];
  const found: Array<XmlElement & { at: number }> = [];

  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    const isClose = Boolean(match[1]);
    const attributes = match[2] ?? "";
    const selfClosing = /\/\s*>$/.test(match[0]);

    if (selfClosing) {
      found.push({ attributes, inner: "", depth: open.length, at });
      continue;
    }
    if (!isClose) {
      open.push({ attributes, from: at + match[0].length, depth: open.length });
      continue;
    }
    const start = open.pop();
    // A stray close tag means malformed input; ignoring it keeps the elements already read
    // rather than discarding the document.
    if (!start) continue;
    found.push({
      attributes: start.attributes,
      inner: source.slice(start.from, at),
      depth: start.depth,
      at: start.from
    });
  }

  return found
    .sort((a, b) => a.at - b.at)
    .map(({ attributes, inner, depth }) => ({ attributes, inner, depth }));
}

export function xmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  if (!match) return undefined;
  return decodeXmlText(match[1] ?? match[2] ?? "");
}

export function xmlChildText(inner: string, tag: string): string {
  const child = xmlElements(inner, tag)[0];
  return child ? decodeXmlText(child.inner).trim() : "";
}

/**
 * Text of every `<tag>` directly readable in `inner`, in document order.
 *
 * Used where a capabilities document repeats an element to mean a set — `<CRS>` and `<Format>`
 * both work that way — and taking only the first would silently pick one at random.
 */
export function xmlChildTexts(inner: string, tag: string): string[] {
  return xmlElements(inner, tag)
    .map((element) => decodeXmlText(element.inner).trim())
    .filter((text) => text.length > 0);
}

/**
 * The elements of `source` that are `<tag>` and are not nested inside another `<tag>`.
 *
 * WMS nests `<Layer>` inside `<Layer>` to express grouping, so "the top-level layers" cannot be
 * expressed by `xmlElements` alone: that returns the parents and their children flattened
 * together, and a tree read that way loses which entry contains which.
 */
export function xmlDirectElements(source: string, tag: string): XmlElement[] {
  return xmlElements(source, tag).filter((element) => element.depth === 0);
}

export function xmlWithoutNested(source: string, tag: string): string {
  return xmlDirectElements(source, tag).reduce(
    (rest, element) => (element.inner ? rest.replace(element.inner, "") : rest),
    source
  );
}
