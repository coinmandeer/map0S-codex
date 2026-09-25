import { createHash } from "node:crypto";
import { expect, test, type Page } from "./fixtures/offlineTest";

/** One orchestrator answer with a single place, so the search popover has something to offer
 *  before the conversation moves into the panel. */
function searchAnswer(text: string) {
  return {
    status: "succeeded",
    conversation: { id: "conv-1", revision: 1, scope: { type: "global" } },
    answer: {
      text,
      results: [
        {
          id: "osm:41",
          layerId: "osm-poi",
          title: "Kemp U Řeky",
          longitude: 13.3785,
          latitude: 49.7485,
          distanceMeters: 1240,
          source: { sourceId: "osm", label: "OpenStreetMap" }
        }
      ]
    }
  };
}

const PLACE = {
  id: "osm:41",
  layerId: "osm-poi",
  title: "Kemp U Řeky",
  category: "stay.camp_site",
  longitude: 13.3785,
  latitude: 49.7485,
  distanceMeters: 1240,
  sourceId: "osm-poi"
};

/** The chat endpoint answers with `text/event-stream`, so a stubbed turn is the frames the panel
 *  would have read off the wire: a named tool step first, then the answer with its cards. */
function chatStream(text: string): string {
  const events = [
    { type: "intent", intent: "question", execution: "deterministic" },
    { type: "tool_start", tool: "search_places", title: "Hledám místa v okolí" },
    { type: "tool_result", tool: "search_places", status: "ok" },
    {
      type: "done",
      conversation: { id: "conv-1", revision: 1 },
      answer: {
        execution: "deterministic",
        intent: "question",
        text,
        cards: [
          { type: "places", title: "Nejbližší místa", places: [PLACE], layerIds: ["osm-poi"] }
        ],
        sources: [{ sourceId: "osm-poi", label: "OpenStreetMap", url: "https://osm.org" }],
        followUps: ["Kde se dá dolít voda?"]
      }
    }
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/** The same frames with one card of the caller's choosing, for the proposals of §30.7 and §30.8. */
function cardStream(text: string, card: unknown): string {
  const events = [
    { type: "intent", intent: "question", execution: "model-tool-loop" },
    {
      type: "done",
      conversation: { id: "conv-1", revision: 1 },
      answer: {
        execution: "model-tool-loop",
        intent: "question",
        text,
        cards: [card],
        sources: [{ sourceId: "osm-poi", label: "OpenStreetMap" }],
        followUps: []
      }
    }
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

const LAYER_DRAFT_CARD = {
  type: "layer-draft",
  title: "AI: Kempy u vody",
  layerId: "ai-kempy-u-vody-e2e",
  featureCount: 2,
  manifest: {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "ai-kempy-u-vody-e2e",
    name: "AI: Kempy u vody",
    description: "Návrh vrstvy z odpovědi asistenta: 2 místa ze zdrojů, které odpověď citovala.",
    icon: "auto_awesome",
    color: "#7C4DFF",
    category: "user",
    modes: ["discover"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", style: { iconByCategory: true }, zIndex: 620 },
    source: {
      type: "inline",
      inline: {
        generatedAt: "2026-09-02T10:00:00.000Z",
        provenance: {
          kind: "ai",
          model: "glm-5.3-flash",
          prompt: "vytvoř z toho vrstvu",
          createdAt: "2026-09-02T10:00:00.000Z",
          sourceIds: ["osm-poi"]
        },
        features: [
          {
            id: "osm:41",
            title: "Kemp U Řeky",
            longitude: 13.3785,
            latitude: 49.7485,
            category: "stay.camp_site",
            sourceId: "osm-poi"
          },
          {
            id: "osm:42",
            title: "Kemp Na Kopci",
            longitude: 13.4,
            latitude: 49.76,
            category: "stay.camp_site",
            sourceId: "osm-poi"
          }
        ]
      }
    },
    queryPolicy: { strategy: "manual" },
    attribution: [{ label: "OpenStreetMap", requiredOnMap: true, requiredOnExport: true }],
    capabilities: ["query", "export"]
  }
};

const PLAN_EDIT = {
  type: "plan-edit",
  title: "Přidat Kutnou Horu jako druhou zastávku.",
  proposalId: "proposal-1",
  planId: "plan-1",
  diff: {
    baseRevision: 1,
    previewRevision: 2,
    changedPlanFields: [],
    addedStopIds: ["ai-stop-1"],
    removedStopIds: [],
    movedStopIds: [],
    updatedStopIds: [],
    affectedSegmentIds: []
  }
};

const QUESTION = "kde najdu klidný kemp u vody?";

/** A second turn in the open panel, which is where the proposal cards of §30.7 and §30.8 land. */
async function askInPanel(page: Page, question: string) {
  await page.getByLabel("Na co se chceš zeptat?").fill(question);
  await page.getByTestId("ai-panel-send").click();
}

/** The assistant is reached from search: one answer in the popover is a lookup, a conversation
 *  belongs in the left panel (§4.13). The returned handle lets a test make later turns fail. */
async function openPanel(page: Page) {
  const state = { failing: false, stream: chatStream("Nejblíž je kemp u řeky.") };
  await page.route("**/v2/ai/orchestrate", (route) =>
    route.fulfill({ json: searchAnswer("Nejblíž je kemp u řeky.") })
  );
  await page.route("**/v2/ai/chat", (route) =>
    state.failing
      ? route.fulfill({ status: 503, json: { message: "Asistent teď není dostupný." } })
      : route.fulfill({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: state.stream
        })
  );
  await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=13");
  await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });

  await page.getByTestId("place-search").fill(QUESTION);
  await page.getByTestId("search-offer-ai").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
  // The panel asks the carried-over question as it opens. Waiting for that answer keeps a
  // caller's later `state.stream` from being served to this first turn as well, which showed
  // up as two identical cards in the thread.
  await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
    timeout: 20_000
  });
  return state;
}

test.describe("AI panel", () => {
  test("carries the question over from search and answers with sourced place cards", async ({
    page
  }) => {
    await openPanel(page);

    const thread = page.getByTestId("ai-panel-thread");
    // The question is not retyped here, and the answer arrives without a second confirmation.
    await expect(thread).toContainText(QUESTION);
    await expect(thread).toContainText("Nejblíž je kemp u řeky.", { timeout: 20_000 });
    // Places are cards with a distance and their source, not names buried in the paragraph.
    await expect(thread).toContainText("OpenStreetMap");
    await expect(thread.getByRole("button", { name: /Kemp U Řeky/ })).toBeVisible();
    // Results are applied immediately; no second confirmation is necessary.
    await expect(page.getByTestId("ai-card-places-show")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(window.__maposMap!.getStyle().sources).some((id) =>
            id.startsWith("source-ai-answer-")
          )
        )
      )
      .toBeTruthy();
  });

  test("says once what leaves the browser, and the context chip lists it in full", async ({
    page
  }) => {
    await openPanel(page);

    const privacy = page.getByTestId("ai-panel-privacy");
    await expect(privacy).toContainText("map centre");
    await privacy.getByRole("button", { name: "Got it" }).click();
    await expect(privacy).toHaveCount(0);

    // Dismissing the one-time line does not hide what the assistant can see.
    await page.getByTestId("ai-panel-context").click();
    await expect(page.getByText("Active layers: osm-poi")).toBeVisible();

    await openPanel(page);
    await expect(page.getByTestId("ai-panel-privacy")).toHaveCount(0);
  });

  test("a suggested place opens its detail and the assistant is one click back", async ({
    page
  }) => {
    await openPanel(page);
    const thread = page.getByTestId("ai-panel-thread");
    await expect(thread.getByRole("button", { name: /Kemp U Řeky/ })).toBeVisible({
      timeout: 20_000
    });

    await thread.getByRole("button", { name: /Kemp U Řeky/ }).click();
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("pin-detail-back").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });

  test("a suggested follow-up asks the next question without typing", async ({ page }) => {
    await openPanel(page);
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });

    await page.getByTestId("ai-panel-followup").first().click();
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Kde se dá dolít voda?");
  });

  test("a cleared thread offers the empty state, and a new question asks again", async ({
    page
  }) => {
    await openPanel(page);
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });

    await page.locator(".ai-session-menu > summary").click();
    await page.getByTestId("ai-panel-clear").click();
    await expect(page.getByTestId("ai-panel-empty")).toBeVisible();

    await page.getByLabel("Na co se chceš zeptat?").fill("a co voda poblíž?");
    await page.getByTestId("ai-panel-send").click();
    await expect(page.getByTestId("ai-panel-thread")).toContainText("a co voda poblíž?");
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });
  });

  test("a drafted layer automatically reaches the map and stays out of the refresh URL", async ({
    page
  }) => {
    const state = await openPanel(page);
    state.stream = cardStream("Vrstvu se dvěma kempy jsem připravil.", LAYER_DRAFT_CARD);
    await askInPanel(page, "vytvoř z toho vrstvu");

    const card = page.getByTestId("ai-card-layer-draft");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("2 míst");
    // The map is the output of the conversation; saving remains an explicit action.
    await expect(page.getByTestId("ai-results-hide")).toBeVisible();
    await expect(page).not.toHaveURL(/layers=.*ai-answer-/);
    await page.getByTestId("ai-results-hide").click();
    await expect(page).not.toHaveURL(/ai-answer-/);
  });

  test("a drafted layer can be kept, and every kept point carries its provenance", async ({
    page
  }) => {
    const pins: Array<Record<string, unknown>> = [];
    await page.route("**/user-layers", (route) =>
      route.fulfill({ json: { layer: { id: "layer-1" } } })
    );
    await page.route("**/user-layers/layer-1/pins", (route) => {
      pins.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { pin: { id: `pin-${pins.length}` } } });
    });

    const state = await openPanel(page);
    state.stream = cardStream("Vrstvu se dvěma kempy jsem připravil.", LAYER_DRAFT_CARD);
    await askInPanel(page, "vytvoř z toho vrstvu");
    await page.getByTestId("ai-card-layer-draft-save").click();

    await expect(page.getByTestId("toast")).toContainText("My layers", { timeout: 20_000 });
    expect(pins.length).toBe(2);
    const properties = pins[0]!.properties as Record<string, Record<string, unknown>>;
    expect(properties.sourceId).toBe("osm-poi");
    // A place kept from an answer must stay distinguishable from one somebody surveyed.
    expect(properties.provenance!.model).toBe("glm-5.3-flash");
    await expect(page.getByTestId("ai-card-layer-draft-save")).toBeDisabled();
  });

  test("a proposed plan edit shows its diff and writes nothing until it is confirmed", async ({
    page
  }) => {
    const confirmed: string[] = [];
    await page.route("**/v2/ai/plan-proposals/*/confirm", (route) => {
      confirmed.push(route.request().url());
      return route.fulfill({ json: { status: "confirmed", proposal: { id: "proposal-1" } } });
    });
    const state = await openPanel(page);
    state.stream = cardStream("Přidal bych Kutnou Horu jako druhou zastávku.", PLAN_EDIT);
    await askInPanel(page, "přidej Kutnou Horu na den 2");

    const card = page.getByTestId("ai-card-plan-edit");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ai-card-plan-edit-diff")).toContainText("+1 zastávka");
    expect(confirmed).toEqual([]);

    await page.getByTestId("ai-card-plan-edit-confirm").click();
    await expect(card).toContainText("Změna je v plánu.", { timeout: 20_000 });
    expect(confirmed.length).toBe(1);
    expect(confirmed[0]).toContain("/v2/ai/plan-proposals/proposal-1/confirm");
  });

  test("a rejected plan edit is not sent anywhere near the plan", async ({ page }) => {
    let confirmCalls = 0;
    await page.route("**/v2/ai/plan-proposals/*/confirm", (route) => {
      confirmCalls += 1;
      return route.fulfill({ json: { status: "confirmed" } });
    });
    await page.route("**/v2/ai/plan-proposals/*/reject", (route) =>
      route.fulfill({ json: { status: "rejected", proposal: { id: "proposal-1" } } })
    );
    const state = await openPanel(page);
    state.stream = cardStream("Přidal bych Kutnou Horu.", PLAN_EDIT);
    await askInPanel(page, "přidej Kutnou Horu na den 2");

    await expect(page.getByTestId("ai-card-plan-edit")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ai-card-plan-edit-reject").click();
    await expect(page.getByTestId("ai-card-plan-edit")).toContainText("Návrh jsi zamítl.", {
      timeout: 20_000
    });
    expect(confirmCalls).toBe(0);
  });

  test("a failed turn keeps the question visible and explains itself", async ({ page }) => {
    const state = await openPanel(page);
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.", {
      timeout: 20_000
    });

    state.failing = true;
    await page.getByLabel("Na co se chceš zeptat?").fill("a kde se dá dolít voda?");
    await page.getByTestId("ai-panel-send").click();

    await expect(page.getByTestId("ai-panel-error")).toBeVisible({ timeout: 20_000 });
    // The failure replaces only that answer: the question and the earlier turn stay readable.
    await expect(page.getByTestId("ai-panel-thread")).toContainText("a kde se dá dolít voda?");
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.");
  });
});

test("exact answer results replace one temporary layer without moving the camera or enabling providers", async ({
  page
}) => {
  const state = await openPanel(page);
  const places = [
    PLACE,
    { ...PLACE, id: "second", title: "Second", longitude: 13.6, latitude: 49.9 },
    { ...PLACE, id: "third", layerId: "wikidata", title: "Third", longitude: 13.8, latitude: 49.8 }
  ];
  state.stream = cardStream("Three sourced places", {
    type: "places",
    title: "Exact selection",
    places,
    layerIds: ["osm-poi", "wikidata"]
  });
  await askInPanel(page, "ukaž přesně tato místa");
  const card = page.getByTestId("ai-card-places").last();
  await expect(card).toContainText("Exact selection");
  let extraQueries = 0;
  page.on("request", (r) => {
    if (/\/layers\/(wikidata|ai-answer-)[^/]*\/features/.test(r.url())) extraQueries++;
  });
  const view = () =>
    page.evaluate(() => {
      const m = window.__maposMap!;
      return { center: m.getCenter().toArray(), zoom: m.getZoom() };
    });
  await expect.poll(() => page.evaluate(() => window.__maposMap!.isMoving())).toBe(false);
  const before = await view();
  const sourceId = () =>
    page.evaluate(() =>
      Object.keys(window.__maposMap!.getStyle().sources).filter(
        (id) => id.startsWith("source-ai-answer-") && !id.endsWith("-lines")
      )
    );
  await expect.poll(sourceId).toHaveLength(1);
  const ids = await sourceId();
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window.__maposMap!.getSource(id)!.serialize() as { data: { features: unknown[] } }).data
            .features.length,
        ids[0]!
      )
    )
    .toBe(3);
  expect(await view()).toEqual(before);
  expect(new URL(page.url()).searchParams.get("layers")?.split(",") ?? []).not.toContain(
    "wikidata"
  );
  await card.getByRole("button", { name: "Otevřít detail místa Kemp U Řeky" }).hover();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => window.__maposMap!.getFeatureState({ source: id, id: "result-0" }).hover,
        ids[0]!
      )
    )
    .toBe(true);
  await page.evaluate(() => window.__maposMap!.jumpTo({ center: [-4.4, 36.7], zoom: 8 }));
  const manuallyMoved = await view();
  await card.getByRole("button", { name: "Přiblížit výsledky", exact: true }).click();
  await expect
    .poll(async () => JSON.stringify(await view()))
    .not.toBe(JSON.stringify(manuallyMoved));
  expect(extraQueries).toBe(0);
  await page.screenshot({ path: "output/playwright/ai-exact-results-20260908.png" });
  await page.getByTestId("ai-results-hide").click();
  await expect.poll(sourceId).toHaveLength(0);
});

test("AI V2 preserves streamed text on EOF and clears pending work on new thread", async ({
  page
}) => {
  const state = await openPanel(page);
  state.stream = [
    { type: "tool_start", tool: "search_places", title: "Doplňuji zdroje" },
    { type: "token", text: "První doložená informace zůstává." }
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  await askInPanel(page, "doplň informace");
  await expect(page.getByTestId("ai-panel-thread")).toContainText(
    "První doložená informace zůstává."
  );
  await expect(page.getByTestId("ai-panel-error")).toContainText("Přenos se přerušil");
  await expect(page.getByTestId("ai-panel-stop")).toHaveCount(0);
  await page.locator(".ai-session-menu > summary").click();
  await page.getByTestId("ai-panel-clear").click();
  await expect(page.getByTestId("ai-panel-empty")).toBeVisible();
});

test("AI V2 place excursion preserves the thread without another chat call", async ({ page }) => {
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/v2/ai/chat")) calls++;
  });
  await openPanel(page);
  const before = calls;
  await page
    .getByTestId("ai-panel-thread")
    .getByRole("button", { name: /Kemp U Řeky/ })
    .click();
  await expect(page.getByTestId("pin-detail")).toBeVisible();
  await page.getByTestId("pin-detail-back").click();
  await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejblíž je kemp u řeky.");
  expect(calls).toBe(before);
});

test("AI Overview expands on demand, retains cited facts on interruption and makes geometry available", async ({
  page
}) => {
  let requests = 0;
  await page.route("**/v2/ai/overview", async (route) => {
    requests++;
    const targetKey = createHash("sha256")
      .update(JSON.stringify(route.request().postDataJSON().target))
      .digest("hex");
    const snapshot = {
      targetKey,
      scopeFingerprint: "fingerprint",
      revision: 1,
      geometryRevision: "three-points",
      status: "loading",
      sources: [
        {
          id: "record",
          sourceRecordId: "osm:41",
          providerId: "osm",
          label: "OSM záznam",
          url: "https://www.openstreetmap.org/node/41",
          relation: "same_entity",
          topic: "identity",
          kind: "fact",
          text: "Kemp U Řeky",
          retrievedAt: "2026-09-09T00:00:00Z",
          originGroup: "osm",
          access: "public"
        }
      ],
      sections: [
        {
          id: "facts",
          title: "Doložené informace",
          claims: [
            {
              id: "name",
              text: "Název: Kemp U Řeky",
              evidenceIds: ["record"],
              support: "source-statement"
            }
          ]
        }
      ],
      mapRefs: [
        {
          layerId: "osm-poi",
          featureId: "osm:41",
          title: "Kemp U Řeky",
          lng: 13.3785,
          lat: 49.7485,
          evidenceIds: ["record"]
        }
      ],
      limitations: []
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ type: "section_upsert", requestId: "req", runId: "run", targetKey, scopeFingerprint: "fingerprint", seq: 1, revision: 1, snapshot })}\n\n`
    });
  });
  await openPanel(page);
  await page
    .getByTestId("ai-panel-thread")
    .getByRole("button", { name: /Kemp U Řeky/ })
    .click();
  await expect(page.getByTestId("pin-detail")).toBeVisible();
  await expect(page.getByTestId("place-overview-open")).toHaveAttribute("aria-expanded", "false");
  expect(requests).toBe(0);
  await page.getByTestId("place-overview-open").click();
  const overview = page.getByTestId("ai-overview");
  await expect(overview).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await expect(overview).toContainText("Název: Kemp U Řeky");
  await expect(overview).toContainText("Přenos se přerušil");
  await expect(overview.getByRole("link", { name: "Zdroj: OSM záznam" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/node/41"
  );
  await expect(overview.getByRole("button", { name: "Zobrazit v mapě" })).toBeEnabled();
  await expect(overview.getByRole("button", { name: "Zastavit" })).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/ai-overview-v2-20260909.png" });
});

test("statistical answer shows its period and source and clears an unrelated area filter", async ({
  page
}) => {
  const state = await openPanel(page);
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    getMapStore().setAreaSelection({
      id: "old-city",
      name: "Předchozí město",
      revision: "old",
      bbox: [13, 49, 14, 50]
    });
  });
  state.stream = cardStream(
    "Pro Česko nemáme ověřená data nezaměstnanosti za rok 2025. Hodnoty nedoplňuji odhadem.",
    {
      type: "statistic",
      title: "Nezaměstnanost v Česku",
      country: "CZ",
      themeId: "unemployment",
      period: "2025",
      geoLevel: "adm1",
      bbox: [12.09, 48.55, 18.87, 51.06],
      excludedDatasetIds: [],
      available: false
    }
  )
    .replaceAll('"osm-poi"', '"czso"')
    .replaceAll('"OpenStreetMap"', '"Český statistický úřad"');
  await askInPanel(page, "Jaká byla nezaměstnanost v Česku v roce 2025?");
  const thread = page.getByTestId("ai-panel-thread");
  await expect(thread).toContainText("Nezaměstnanost v Česku · 2025 · ADM1");
  await expect(thread).toContainText("Český statistický úřad");
  await expect(thread).toContainText("Hodnoty nedoplňuji odhadem");
  await expect(thread.getByRole("button", { name: "Přiblížit požadovanou zemi" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
        return getMapStore().areaSelection;
      })
    )
    .toBeNull();
});
