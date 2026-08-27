/**
 * Just enough wikitext parsing to read Wikivoyage listings.
 *
 * Wikivoyage articles are not prose with coordinates buried in them: every attraction is a
 * `{{see}}`, `{{do}}`, `{{eat}}` template carrying `name`, `lat`, `long`, `address`, `phone`,
 * `hours`, `price` and a description. That structure is the whole reason the site works as a
 * data source, and reading it needs a brace matcher rather than a regex — templates nest, and
 * a naive `\{\{(.+?)\}\}` stops at the first inner template's closing braces.
 */

export interface WikiTemplate {
  name: string;
  params: Record<string, string>;
}

/** Finds top-level templates, skipping those nested inside another one — an inner `{{km|3}}`
 *  inside a listing's description is part of that listing, not a listing of its own. */
export function parseTemplates(wikitext: string): WikiTemplate[] {
  const templates: WikiTemplate[] = [];
  for (let i = 0; i < wikitext.length - 1; i += 1) {
    if (wikitext[i] !== "{" || wikitext[i + 1] !== "{") continue;
    const end = matchBraces(wikitext, i);
    if (end === -1) continue;
    const template = parseTemplate(wikitext.slice(i + 2, end - 2));
    if (template) templates.push(template);
    i = end - 1;
  }
  return templates;
}

/** Index just past the `}}` closing the template that starts at `start`, or -1. */
function matchBraces(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parseTemplate(body: string): WikiTemplate | null {
  const parts = splitTopLevel(body, "|");
  const name = parts.shift()?.trim().toLowerCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  let positional = 0;
  for (const part of parts) {
    const eq = indexOfTopLevel(part, "=");
    if (eq === -1) {
      positional += 1;
      params[String(positional)] = part.trim();
    } else {
      params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
  }
  return { name, params };
}

/** Splits on a separator that is not inside a nested template, link or HTML comment. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("{{", i) || text.startsWith("[[", i)) {
      depth += 1;
      i += 1;
    } else if (text.startsWith("}}", i) || text.startsWith("]]", i)) {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (depth === 0 && text[i] === separator) {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

function indexOfTopLevel(text: string, char: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("{{", i) || text.startsWith("[[", i)) {
      depth += 1;
      i += 1;
    } else if (text.startsWith("}}", i) || text.startsWith("]]", i)) {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (depth === 0 && text[i] === char) {
      return i;
    }
  }
  return -1;
}

/** Turns wikitext into something readable in a panel: links keep their label, references and
 *  remaining markup go away. Nothing here is rendered as HTML, so this is presentation only. */
export function stripMarkup(wikitext: string): string {
  return wikitext
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\]/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Section headings (`== Co vidět ==`) with the wikitext that belongs to each. */
export function splitSections(wikitext: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const headingRe = /^==+\s*([^=]+?)\s*==+\s*$/gm;
  let match: RegExpExecArray | null;
  let previous: { heading: string; start: number } | null = null;

  while ((match = headingRe.exec(wikitext))) {
    if (previous) {
      sections.push({ heading: previous.heading, body: wikitext.slice(previous.start, match.index) });
    }
    previous = { heading: match[1]!, start: match.index + match[0].length };
  }
  if (previous) sections.push({ heading: previous.heading, body: wikitext.slice(previous.start) });
  return sections;
}

/** Text before the first heading — a Wikivoyage lead paragraph is the article's summary. */
export function leadParagraph(wikitext: string): string {
  const firstHeading = wikitext.search(/^==+/m);
  const lead = firstHeading === -1 ? wikitext : wikitext.slice(0, firstHeading);
  return stripMarkup(lead)
    .split(/(?<=\.)\s+/)
    .slice(0, 3)
    .join(" ");
}
