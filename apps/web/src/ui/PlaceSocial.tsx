import { useEffect, useMemo, useState } from "react";
import type { CanonicalPlace, Place } from "@mapos/layer-sdk";
import { ApiError, apiGet, apiPost, apiSend } from "../lib/api";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { t } from "../i18n";
import { emit } from "../lib/events";
import {
  maposSocialFailureMessage,
  maposSocialSummary,
  type MaposComment,
  type MaposReview
} from "./placeSocialModel";
import { usePlaceQuests } from "./placeQuestsModel";

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

/**
 * MapOS-owned community content (§2.11).
 *
 * Structure follows the wireframe: the three figures sit at the top, the two write actions come
 * next, and the discussion lives in its own three folds below. An external provider's rating is
 * a different number about a slightly different thing, so it stays in its own panel under its
 * own name rather than being averaged in here.
 */
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
  const [openSection, setOpenSection] = useState<"reviews" | "quests" | "discussion">("reviews");
  const quests = usePlaceQuests(place.lng, place.lat);

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

  // A reader who is not signed in still sees the aggregate and the quests; only the write
  // actions need an identity, and they ask for one at the moment they are used (§2.11).
  const summary =
    loadState.status === "ready"
      ? maposSocialSummary(loadState.data.reviews, loadState.data.comments)
      : null;

  const requireSession = (): boolean => {
    if (session) return true;
    store.openSheet("auth");
    store.showToast(t("place.save.signIn"));
    return false;
  };

  const replaceData = (patch: Partial<SocialData>) => {
    if (loadState.status !== "ready") return;
    setLoadState({ status: "ready", data: { ...loadState.data, ...patch } });
  };

  const toggleFollow = async () => {
    if (loadState.status !== "ready" || !requireSession()) return;
    const { canonical, followed } = loadState.data;
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
    if (loadState.status !== "ready" || !requireSession()) return;
    setBusy(true);
    try {
      await apiPost("/reviews", {
        targetType: "place",
        targetId: loadState.data.canonical.placeId,
        rating,
        body: reviewBody
      });
      const data = await apiGet<{ reviews: MaposReview[] }>("/reviews", {
        query: { targetType: "place", targetId: loadState.data.canonical.placeId }
      });
      replaceData({ reviews: data.reviews });
      setReviewBody("");
      setOpenSection("reviews");
      store.showToast("MapOS hodnocení je uložené; další odeslání ho upraví");
    } catch (error) {
      store.showToast(mutationMessage(error, "MapOS hodnocení se nepodařilo uložit"));
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async () => {
    if (!commentBody.trim() || loadState.status !== "ready" || !requireSession()) return;
    setBusy(true);
    try {
      await apiPost("/comments", {
        targetType: "place",
        targetId: loadState.data.canonical.placeId,
        body: commentBody
      });
      const data = await apiGet<{ comments: MaposComment[] }>("/comments", {
        query: { targetType: "place", targetId: loadState.data.canonical.placeId }
      });
      replaceData({ comments: data.comments });
      setCommentBody("");
    } catch (error) {
      store.showToast(mutationMessage(error, "MapOS komentář se nepodařilo uložit"));
    } finally {
      setBusy(false);
    }
  };

  const addQuest = () => {
    if (!requireSession()) return;
    // A quest is drawn on the map at this place; the one quest composer opens seeded with it.
    emit("open-world-quest", {
      lng: place.lng,
      lat: place.lat,
      placeId: place.id,
      anchorName: place.name
    });
  };

  const data = loadState.status === "ready" ? loadState.data : null;
  const questCount = quests.status === "ready" ? quests.quests.length : 0;

  return (
    <section className="place-social" data-testid="place-social">
      <div className="place-social-stats" data-testid="place-social-summary">
        <div>
          <strong data-testid="social-rating">{summary?.average ?? "—"}</strong>
          <span>{t("polish.rating")}</span>
        </div>
        <div>
          <strong data-testid="social-review-count">{summary?.reviews ?? 0}</strong>
          <span>{t("polish.reviews")}</span>
        </div>
        <div>
          <strong data-testid="social-quest-count">{questCount}</strong>
          <span>{t("polish.quests")}</span>
        </div>
      </div>

      {summary && summary.reviews === 0 && (
        <p className="empty-copy" data-testid="place-social-empty">
          {t("polish.noRating")}
        </p>
      )}

      <div className="place-social-actions">
        <button
          className="btn block btn-accent"
          disabled={busy}
          type="button"
          data-testid="add-review"
          onClick={() => (requireSession() ? setOpenSection("reviews") : undefined)}
        >
          {t("polish.addReview")}
        </button>
        <button
          className="btn block"
          disabled={busy}
          type="button"
          data-testid="add-quest"
          onClick={addQuest}
        >
          {t("polish.addQuest")}
        </button>
      </div>

      {loadState.status === "loading" && (
        <div className="skeleton" style={{ height: 64 }} aria-busy="true" />
      )}
      {loadState.status === "error" && (
        <div data-testid="place-social-error">
          <p>{loadState.message}</p>
          <button className="btn" type="button" onClick={() => setRetry((value) => value + 1)}>
            {t("action.retry")}
          </button>
        </div>
      )}

      <details
        className="place-social-section"
        open={openSection === "reviews"}
        onToggle={(e) => e.currentTarget.open && setOpenSection("reviews")}
        data-testid="social-reviews"
      >
        <summary>
          {t("polish.reviews")} {summary ? `· ${summary.reviews}` : ""}
        </summary>
        <div className="place-social-section-body">
          {data && data.reviews.length > 0 ? (
            data.reviews.slice(0, 5).map((review) => (
              <div className="social-entry" key={review.id}>
                <strong>
                  {review.author ?? "Cestovatel"} · {review.rating}★ · MapOS
                </strong>
                {review.body && <p>{review.body}</p>}
              </div>
            ))
          ) : (
            <p className="meta">{t("polish.noReviews")}</p>
          )}
          <div className="place-social-compose">
            <div className="segmented social-rating" role="group" aria-label={t("polish.rating")}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={rating === value ? "active" : ""}
                  aria-pressed={rating === value}
                  onClick={() => setRating(value)}
                >
                  {value}★
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              maxLength={1_200}
              placeholder={t("polish.reviewPlaceholder")}
              value={reviewBody}
              onChange={(event) => setReviewBody(event.target.value)}
            />
            <button
              className="btn"
              disabled={busy}
              type="button"
              onClick={() => void submitReview()}
            >
              {t("polish.saveReview")}
            </button>
          </div>
        </div>
      </details>

      <details
        className="place-social-section"
        open={openSection === "quests"}
        onToggle={(e) => e.currentTarget.open && setOpenSection("quests")}
        data-testid="social-quests"
      >
        <summary>
          {t("polish.quests")} {questCount ? `· ${questCount}` : ""}
        </summary>
        <div className="place-social-section-body">
          {quests.status === "loading" && <div className="skeleton" style={{ height: 48 }} />}
          {quests.status === "error" && <p className="meta">{t("polish.questsUnavailable")}</p>}
          {quests.status === "ready" && quests.quests.length === 0 && (
            <p className="meta">{t("polish.noQuestsHere")}</p>
          )}
          {quests.status === "ready" &&
            quests.quests.map((quest) => {
              const target = { lng: quest.lng, lat: quest.lat, zoom: 17 };
              return (
                <div
                  className="social-entry"
                  key={quest.id}
                  data-testid={`place-quest-${quest.id}`}
                >
                  <strong>{quest.title}</strong>
                  <p>{quest.description}</p>
                  <small className="meta">
                    +{quest.rewardPoints} XP · {Math.round(quest.distanceM)} m
                    {quest.sourceLabel ? ` · ${quest.sourceLabel}` : ""}
                  </small>
                  <button className="btn" type="button" onClick={() => emit("fly-to", target)}>
                    {t("polish.showOnMap")}
                  </button>
                </div>
              );
            })}
        </div>
      </details>

      <details
        className="place-social-section"
        open={openSection === "discussion"}
        onToggle={(e) => e.currentTarget.open && setOpenSection("discussion")}
        data-testid="social-discussion"
      >
        <summary>
          {t("polish.discussion")} {summary?.comments ? `· ${summary.comments}` : ""}
        </summary>
        <div className="place-social-section-body">
          {data && data.comments.length > 0 ? (
            data.comments.slice(0, 6).map((comment) => (
              <div className="social-entry" key={comment.id}>
                <strong>{comment.author ?? "Cestovatel"} · MapOS</strong>
                <p>{comment.body}</p>
              </div>
            ))
          ) : (
            <p className="meta">{t("polish.noDiscussion")}</p>
          )}
          <div className="place-social-compose">
            <textarea
              rows={2}
              maxLength={1_600}
              placeholder={t("polish.commentPlaceholder")}
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <button
              className="btn"
              disabled={busy || !commentBody.trim()}
              type="button"
              onClick={() => void submitComment()}
            >
              {t("polish.comment")}
            </button>
          </div>
        </div>
      </details>

      {data && (
        <button
          className="btn block"
          disabled={busy}
          type="button"
          onClick={() => void toggleFollow()}
        >
          {data.followed ? t("polish.following") : t("polish.follow")}
        </button>
      )}
    </section>
  );
}
