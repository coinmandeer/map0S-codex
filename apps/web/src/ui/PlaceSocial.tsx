import { useEffect, useMemo, useState } from "react";
import type { CanonicalPlace, Place } from "@mapos/layer-sdk";
import { ApiError, apiGet, apiPost, apiSend } from "../lib/api";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import {
  maposSocialFailureMessage,
  maposSocialSummary,
  type MaposComment,
  type MaposReview
} from "./placeSocialModel";

interface SocialData {
  canonical: CanonicalPlace;
  followed: boolean;
  reviews: MaposReview[];
  comments: MaposComment[];
}

type SocialLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SocialData };

function mutationMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status === 401
    ? "Relace vypršela. Znovu otevři profil MapOS a akci zopakuj."
    : fallback;
}

/** MapOS-owned reviews/comments only. Provider reviews are rendered by their own registry panel,
 * so users never mistake one source's rating or write capability for another's. */
export function PlaceSocial({ place }: { place: Place }) {
  const store = getMapStore();
  const session = useMapStoreSnapshot((state) => state.session);
  const sourceKey = useMemo(
    () =>
      place.sources
        .map((source) => `${source.source}:${source.sourceRef}`)
        .sort()
        .join("|"),
    [place.sources]
  );
  const [loadState, setLoadState] = useState<SocialLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) {
      setLoadState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    void apiPost<{ place: CanonicalPlace }>(
      "/places/canonicalize",
      {
        name: place.name,
        lng: place.lng,
        lat: place.lat,
        category: place.category,
        sources: place.sources.map((source) => ({
          source: source.source,
          sourceRef: source.sourceRef
        }))
      },
      { signal: controller.signal }
    )
      .then(async ({ place: canonical }) => {
        const [reviewData, commentData, followData] = await Promise.all([
          apiGet<{ reviews: MaposReview[] }>("/reviews", {
            signal: controller.signal,
            query: { targetType: "place", targetId: canonical.placeId }
          }),
          apiGet<{ comments: MaposComment[] }>("/comments", {
            signal: controller.signal,
            query: { targetType: "place", targetId: canonical.placeId }
          }),
          apiGet<{ follows: Array<{ targetType: string; targetId: string }> }>("/follows", {
            signal: controller.signal,
            auth: true
          }).catch(() => ({ follows: [] }))
        ]);
        if (controller.signal.aborted) return;
        setLoadState({
          status: "ready",
          data: {
            canonical,
            reviews: reviewData.reviews,
            comments: commentData.comments,
            followed: followData.follows.some(
              (follow) => follow.targetType === "place" && follow.targetId === canonical.placeId
            )
          }
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setLoadState({
          status: "error",
          message: maposSocialFailureMessage(
            typeof navigator === "undefined" || navigator.onLine !== false
          )
        });
      });
    return () => controller.abort();
  }, [place.category, place.lat, place.lng, place.name, place.sources, retry, session, sourceKey]);

  if (loadState.status === "loading") {
    return (
      <section className="place-social" data-testid="place-social-loading" aria-busy="true">
        <div className="detail-source-label">
          <strong>MapOS komunita</strong>
          <span>Načítám odděleně od zdroje místa…</span>
        </div>
        <div className="skeleton" style={{ height: 84 }} />
      </section>
    );
  }

  if (loadState.status === "error") {
    return (
      <section className="place-social" data-testid="place-social-error">
        <div className="detail-source-label">
          <strong>MapOS komunita</strong>
          <span>Nepodařilo se načíst</span>
        </div>
        <p>{loadState.message}</p>
        <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
          Zkusit znovu
        </button>
      </section>
    );
  }

  const { canonical, followed, reviews, comments } = loadState.data;
  const summary = maposSocialSummary(reviews, comments);

  const replaceData = (patch: Partial<SocialData>) => {
    setLoadState({ status: "ready", data: { ...loadState.data, ...patch } });
  };

  const toggleFollow = async () => {
    setBusy(true);
    try {
      if (followed) {
        await apiSend("DELETE", "/follows", undefined, {
          query: { targetType: "place", targetId: canonical.placeId }
        });
      } else {
        await apiPost("/follows", { targetType: "place", targetId: canonical.placeId });
      }
      replaceData({ followed: !followed });
    } catch (error) {
      store.showToast(mutationMessage(error, "Sledování se nepodařilo změnit"));
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    setBusy(true);
    try {
      await apiPost("/reviews", {
        targetType: "place",
        targetId: canonical.placeId,
        rating,
        body: reviewBody
      });
      const data = await apiGet<{ reviews: MaposReview[] }>("/reviews", {
        query: { targetType: "place", targetId: canonical.placeId }
      });
      replaceData({ reviews: data.reviews });
      setReviewBody("");
      store.showToast("MapOS hodnocení je uložené; další odeslání ho upraví");
    } catch (error) {
      store.showToast(mutationMessage(error, "MapOS hodnocení se nepodařilo uložit"));
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async () => {
    if (!commentBody.trim()) return;
    setBusy(true);
    try {
      await apiPost("/comments", {
        targetType: "place",
        targetId: canonical.placeId,
        body: commentBody
      });
      const data = await apiGet<{ comments: MaposComment[] }>("/comments", {
        query: { targetType: "place", targetId: canonical.placeId }
      });
      replaceData({ comments: data.comments });
      setCommentBody("");
    } catch (error) {
      store.showToast(mutationMessage(error, "MapOS komentář se nepodařilo uložit"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="place-social" data-testid="place-social">
      <div className="detail-source-label">
        <strong>MapOS komunita</strong>
        <span>{canonical.sources.length} propojených zdrojů · nezávislé na provider recenzích</span>
      </div>
      <div className="place-social-summary">
        <span>
          <strong>{summary.average ?? "—"}</strong> MapOS hodnocení
        </span>
        <span>
          <strong>{summary.reviews}</strong> recenzí
        </span>
        <span>
          <strong>{summary.comments}</strong> komentářů
        </span>
      </div>
      {summary.empty && (
        <p className="empty-copy" data-testid="place-social-empty">
          Zatím tu není žádná MapOS recenze ani komentář. Providerový obsah se zobrazuje zvlášť.
        </p>
      )}
      <button
        className={`btn block ${followed ? "btn-accent" : ""}`}
        disabled={busy}
        type="button"
        onClick={() => void toggleFollow()}
      >
        {followed ? "Sleduji místo v MapOS" : "Sledovat místo v MapOS"}
      </button>
      <div className="place-social-compose">
        <div className="segmented social-rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              type="button"
              key={value}
              className={rating === value ? "active" : ""}
              onClick={() => setRating(value)}
            >
              {value}★
            </button>
          ))}
        </div>
        <textarea
          rows={2}
          maxLength={1_200}
          placeholder="MapOS recenze (volitelná)"
          value={reviewBody}
          onChange={(event) => setReviewBody(event.target.value)}
        />
        <button className="btn" disabled={busy} type="button" onClick={() => void submitReview()}>
          Uložit / upravit MapOS hodnocení
        </button>
      </div>
      {reviews.slice(0, 3).map((review) => (
        <div className="social-entry" key={review.id}>
          <strong>
            {review.author ?? "Cestovatel"} · {review.rating}★ · MapOS
          </strong>
          {review.body && <p>{review.body}</p>}
        </div>
      ))}
      <div className="place-social-compose">
        <textarea
          rows={2}
          maxLength={1_600}
          placeholder="Přidat MapOS komentář…"
          value={commentBody}
          onChange={(event) => setCommentBody(event.target.value)}
        />
        <button
          className="btn"
          disabled={busy || !commentBody.trim()}
          type="button"
          onClick={() => void submitComment()}
        >
          Komentovat v MapOS
        </button>
      </div>
      {comments.slice(0, 4).map((comment) => (
        <div className="social-entry" key={comment.id}>
          <strong>{comment.author ?? "Cestovatel"} · MapOS</strong>
          <p>{comment.body}</p>
        </div>
      ))}
    </section>
  );
}
