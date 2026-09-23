import { useEffect, useState } from "react";
import { apiGetSafe } from "../lib/api";
import { emit } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { rememberDiscoverContribution } from "./contributionIntent";
import { PanelShell } from "./PanelShell";
import { Button, Chip, EmptyState, InlineNotice, ListItem, SegmentedButton, Skeleton } from "./kit";
import { feedItemSubtitle, type FeedPost, type FeedScope } from "./feedModel";

const SCOPES: Array<{ value: FeedScope; label: string }> = [
  { value: "all", label: "Vše v okolí" },
  { value: "following", label: "Sleduji" }
];

/**
 * The Feed mode: what people put on the map near where you are looking, and what the people you
 * follow put anywhere.
 *
 * It is scoped by the current viewport rather than by country, which is the difference between
 * this and the Discover panel's country digest — panning is the filter, so there is no country
 * selector to keep in sync with the map.
 */
export function FeedPanel() {
  const store = getMapStore();
  const view = useMapStoreSnapshot((state) => state.view);
  const activeTag = useMapStoreSnapshot((state) => state.activeTag);
  const [scope, setScope] = useState<FeedScope>("all");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Rounded so that a pixel of inertial pan does not refetch. The feed is a list of what is
  // roughly here, not a viewport query that has to be exact.
  const bboxKey = [
    Math.round(view.lng * 10) / 10,
    Math.round(view.lat * 10) / 10,
    Math.round(view.zoom)
  ].join(",");

  useEffect(() => {
    const span = Math.max(0.15, 24 / 2 ** Math.max(view.zoom - 4, 0));
    const bbox = [
      view.lng - span,
      view.lat - span * 0.6,
      view.lng + span,
      view.lat + span * 0.6
    ].map((value) => value.toFixed(4));
    const params = new URLSearchParams({ limit: "20", scope, bbox: bbox.join(",") });
    if (activeTag) params.set("tag", activeTag);
    let current = true;
    setLoading(true);
    void apiGetSafe<{ items?: FeedPost[] }>(`/feed?${params}`, { auth: true })
      .then((data) => {
        if (!current) return;
        setPosts(data?.items ?? []);
        setFailed(data === null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
    // `bboxKey` is the coarse form of the view the request actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, scope, activeTag]);

  const openPost = (post: FeedPost) => {
    emit("fly-to", { lng: post.lng, lat: post.lat, zoom: 14 });
    store.setView({ lng: post.lng, lat: post.lat, zoom: 14 });
  };

  const newPost = () => {
    rememberDiscoverContribution({ source: "feed" });
    store.openSheet("wizard");
  };

  return (
    <PanelShell
      title="Feed"
      testId="feed-panel"
      busy={loading && posts.length > 0}
      hasContent={posts.length > 0}
      headerExtra={
        <SegmentedButton
          options={SCOPES}
          value={scope}
          onChange={setScope}
          ariaLabel="Rozsah feedu"
          testId="feed-scope"
        />
      }
      footer={
        <Button variant="filled" block icon="add" testId="feed-new-post" onClick={newPost}>
          Nový příspěvek
        </Button>
      }
    >
      {activeTag && (
        <Chip
          label={`#${activeTag}`}
          active
          onRemove={() => store.setActiveTag(null)}
          testId="feed-active-tag"
        />
      )}

      {failed && <InlineNotice tone="warning">Feed se teď nepodařilo načíst.</InlineNotice>}

      {loading && posts.length === 0 && <Skeleton count={3} />}

      {!loading && !failed && posts.length === 0 && (
        <EmptyState
          icon="dynamic_feed"
          title={
            scope === "following"
              ? "Od lidí, které sleduješ, tu zatím nic není."
              : "V tomhle výřezu ještě nikdo nic nesdílel."
          }
          actionLabel="Přidat příspěvek"
          onAction={newPost}
          testId="feed-empty"
        />
      )}

      <div className="feed-list" data-testid="feed-list">
        {posts.map((post) => (
          <ListItem
            key={post.id}
            testId={`feed-post-${post.id}`}
            // Not tinted with `post.layerColor`: a layer picks its colour to read on the map,
            // and the same value on a light panel background misses 3:1. The layer is named in
            // the subtitle, which says more than a colour anyone would have to decode.
            icon={post.followed ? "favorite" : "place"}
            title={post.name}
            subtitle={feedItemSubtitle(post)}
            ariaLabel={`Zobrazit na mapě: ${post.name}`}
            onClick={() => openPost(post)}
          />
        ))}
      </div>
    </PanelShell>
  );
}
