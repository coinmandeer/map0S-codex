/** A name is not an identity: only an explicit source reference or QID may select an article. */
export function wikipediaIdentity(
  qid?: string,
  reference?: string
): { qid?: string; title?: string; lang?: string } | null {
  if (qid && /^Q[1-9]\d*$/.test(qid)) return { qid };
  if (!reference) return null;
  const tag = /^([a-z]{2,3}):(.+)$/.exec(reference);
  if (tag) return { lang: tag[1], title: tag[2] };
  try {
    const url = new URL(reference),
      lang = /^([a-z]{2,3})\.wikipedia\.org$/.exec(url.hostname)?.[1];
    if (
      url.protocol === "https:" &&
      lang &&
      url.pathname.startsWith("/wiki/") &&
      !url.username &&
      !url.password
    )
      return { lang, title: decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ") };
  } catch {
    /* No verified reference. */
  }
  return null;
}
