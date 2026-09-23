import assert from "node:assert/strict";
import { test } from "node:test";
import { feedItemSubtitle, feedKindLabel, type FeedPost } from "./feedModel";

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "p1",
    name: "Vyhlídka nad městem",
    description: null,
    lng: 13.37,
    lat: 49.74,
    tags: [],
    kind: "post",
    authorName: "Jana",
    layerName: "Plzeň tipy",
    layerColor: "#10b981",
    ...overrides
  };
}

test("a feed row names the kind, the author and the layer it was posted into", () => {
  assert.equal(feedItemSubtitle(post()), "Příspěvek · Jana · Plzeň tipy");
});

test("an anonymous post drops the author instead of showing a placeholder", () => {
  assert.equal(feedItemSubtitle(post({ authorName: null })), "Příspěvek · Plzeň tipy");
  assert.equal(
    feedItemSubtitle(post({ authorName: "  " })),
    "Příspěvek · Plzeň tipy",
    "whitespace is not an author name"
  );
});

test("the ranking reason is shown only when it says something the row does not", () => {
  assert.equal(
    feedItemSubtitle(post({ followed: true, reason: "Od člověka, kterého sleduješ" })),
    "Příspěvek · Jana · Plzeň tipy · Od člověka, kterého sleduješ"
  );
  // The server sends the layer name as the reason for a followed layer, which the row already
  // shows; repeating it would be two thirds of the line saying one thing.
  assert.equal(
    feedItemSubtitle(post({ followed: true, reason: "Plzeň tipy" })),
    "Příspěvek · Jana · Plzeň tipy"
  );
  // Every unfollowed row carries the same generic reason, so on those it is pure repetition.
  assert.equal(
    feedItemSubtitle(post({ reason: "Nové komunitní místo v oblasti" })),
    "Příspěvek · Jana · Plzeň tipy"
  );
});

test("an unknown kind is shown as itself rather than dropped", () => {
  assert.equal(feedKindLabel("route"), "Trasa");
  assert.equal(feedKindLabel("bivouac"), "bivouac");
});
