/** The `/feed` item shape the panel reads. A superset of a pin: the server adds which layer it
 *  came from and why it ranked where it did. */
export interface FeedPost {
  id: string;
  name: string;
  description: string | null;
  lng: number;
  lat: number;
  tags: string[] | null;
  kind: string;
  authorName: string | null;
  layerName: string;
  layerColor: string;
  /** True when the reader follows the layer or the person who published it. */
  followed?: boolean;
  reason?: string;
}

export type FeedScope = "all" | "following";

const KIND_LABELS: Record<string, string> = {
  place: "Místo",
  route: "Trasa",
  task: "Úkol",
  post: "Příspěvek"
};

export function feedKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * One line under a feed row: who posted it and into which layer.
 *
 * Parts that are absent are left out rather than filled with a placeholder, so an anonymous post
 * reads as "Místo · Plzeň tipy" instead of "Místo · — · Plzeň tipy".
 *
 * The ranking reason is shown only for a followed post. For everything else the server sends
 * "Nové komunitní místo v oblasti", which is true of every other row too — repeated on all of
 * them it wraps the list to two lines each and tells the reader nothing.
 */
export function feedItemSubtitle(post: FeedPost): string {
  const layer = post.layerName.trim();
  const reason = post.reason?.trim();
  return [
    feedKindLabel(post.kind),
    post.authorName?.trim() || null,
    layer || null,
    post.followed && reason && reason !== layer ? reason : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
