export interface MaposReview {
  id: string;
  rating: number;
  body: string | null;
  author?: string;
}

export interface MaposComment {
  id: string;
  body: string;
  author?: string;
}

export interface MaposSocialSummary {
  average: string | null;
  reviews: number;
  comments: number;
  empty: boolean;
}

/**
 * Aggregate only MapOS reviews (§2.11).
 *
 * An external provider's rating is a different number about a slightly different thing, so it is
 * never mixed in here; the provider panel states its own value under its own name. With no
 * reviews the average is `null`, which the panel renders as "Zatím bez hodnocení" — zero reviews
 * is not a rating of zero.
 */
export function maposSocialSummary(
  reviews: MaposReview[],
  comments: MaposComment[]
): MaposSocialSummary {
  const average = reviews.length
    ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
    : null;
  return {
    average,
    reviews: reviews.length,
    comments: comments.length,
    empty: reviews.length === 0 && comments.length === 0
  };
}

export function maposSocialFailureMessage(online: boolean): string {
  return online
    ? "Komunitní obsah MapOS se nepodařilo načíst. Detail ze zdroje zůstává dostupný."
    : "Jsi offline. Komunitní obsah MapOS teď není dostupný; soukromá poznámka funguje dál.";
}
