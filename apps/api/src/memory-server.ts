import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { nanoid } from "nanoid";
import { parseSourceRefs } from "@mapos/layer-sdk";
import { fetchRoute } from "./services/routingService.js";
import {
  memoryDb,
  seedMemory,
  memoryUserFeatures,
  memoryOsmFeatures,
  memoryPoiFixtures,
  type MemoryUser
} from "./db/memory.js";
import { capabilities } from "./config.js";
import { layerListing } from "./services/featureProviders.js";
import { registerMapyRoutes } from "./routes/mapyRoutes.js";
import { registerWeatherGridRoutes } from "./routes/weatherGridRoutes.js";
import { registerInfoRoutes } from "./routes/infoRoutes.js";
import { registerGuideRoutes } from "./routes/guideRoutes.js";
import {
  encounterById,
  encountersForBbox,
  ghostById,
  ghostsForBbox,
  REWARD_BY_TIER
} from "./game/spawn.js";
import {
  anchoredQuestsForBbox,
  registerQuestSource,
  verifyAnchoredQuest,
  parseAnchoredQuestId,
  COMPLETION_RADIUS_M,
  type QuestAnchor
} from "./game/anchors.js";
import type { Bbox, OsmPoiCategoryId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";

function parseBbox(raw: string | undefined): Bbox {
  if (!raw) throw new Error("bbox required");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) throw new Error("invalid bbox");
  return parts as Bbox;
}

/** Anchors from the demo fixtures, registered once so the offline server runs the same anchored
 *  quest code as production instead of a stub of it. */
function registerMemoryQuestSource() {
  const anchorOf = (row: {
    osmId: string;
    name: string;
    lng: number;
    lat: number;
    category: string;
  }): QuestAnchor => ({
    ref: `osm:${row.osmId}`,
    name: row.name,
    lng: row.lng,
    lat: row.lat,
    category: row.category
  });

  registerQuestSource({
    id: "osm-landmarks",
    label: "Významná místa z OSM",
    attribution: "© OpenStreetMap přispěvatelé (ODbL)",
    async anchors(bbox) {
      const [w, s, e, n] = bbox;
      return memoryPoiFixtures()
        .filter((p) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n)
        .map(anchorOf);
    },
    async resolve(ref) {
      const row = memoryPoiFixtures().find((p) => `osm:${p.osmId}` === ref);
      return row ? anchorOf(row) : null;
    }
  });
}

function getSessionUser(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = memoryDb.sessions.get(sessionId);
  if (!session || session.expiresAt < new Date()) return null;
  return memoryDb.users.find((u) => u.id === session.userId) ?? null;
}

export async function buildMemoryApp() {
  seedMemory();
  registerMemoryQuestSource();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "mapos-v3-memory" }));

  app.get("/config", async () => ({ capabilities: capabilities() }));

  registerMapyRoutes(app);
  registerWeatherGridRoutes(app);
  registerInfoRoutes(app);
  registerGuideRoutes(app);

  // Shared with the real server so a new provider can't show up in one and not the other. The
  // feature route below still answers from memory — the point of this server is not touching
  // the network or a database.
  app.get("/layers", async () => ({ layers: layerListing() }));

  app.get<{ Params: { layerId: string }; Querystring: { bbox?: string; categories?: string } }>(
    "/layers/:layerId/features",
    async (request, reply) => {
      try {
        const bbox = parseBbox(request.query.bbox);
        const { layerId } = request.params;
        if (layerId === "osm-poi") {
          const cats = (request.query.categories ?? "castle,viewpoint,parking")
            .split(",")
            .filter((c): c is OsmPoiCategoryId => c in OSM_POI_CATEGORIES);
          return memoryOsmFeatures(bbox, cats);
        }
        if (layerId === "user-layers") return memoryUserFeatures(bbox);
        return reply.code(404).send({ message: "Layer not found" });
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/register",
    async (request, reply) => {
      const { email, password, displayName } = request.body;
      if (memoryDb.users.some((u) => u.email === email)) {
        return reply.code(400).send({ message: "Email already registered" });
      }
      const user = {
        id: nanoid(),
        email,
        password,
        displayName: displayName ?? email.split("@")[0]!
      };
      memoryDb.users.push(user);
      const sessionId = nanoid(32);
      memoryDb.sessions.set(sessionId, {
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400000)
      });
      reply.setCookie("session", sessionId, { path: "/", httpOnly: true, sameSite: "lax" });
      return { user: { id: user.id, email: user.email, displayName: user.displayName } };
    }
  );

  app.post<{ Body: { email: string; password: string } }>("/auth/login", async (request, reply) => {
    const user = memoryDb.users.find((u) => u.email === request.body.email);
    if (!user || user.password !== request.body.password) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }
    const sessionId = nanoid(32);
    memoryDb.sessions.set(sessionId, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 86400000)
    });
    reply.setCookie("session", sessionId, { path: "/", httpOnly: true, sameSite: "lax" });
    return { user: { id: user.id, email: user.email, displayName: user.displayName } };
  });

  app.post("/auth/logout", async (request, reply) => {
    const sid = request.cookies.session;
    if (sid) memoryDb.sessions.delete(sid);
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  app.post("/auth/guest", async (request, reply) => {
    const existing = getSessionUser(request.cookies.session);
    if (existing) {
      return {
        user: {
          id: existing.id,
          email: "",
          displayName: existing.displayName,
          isGuest: true,
          xpTotal: 0
        },
        created: false
      };
    }
    const suffix = nanoid(12);
    const user: MemoryUser = {
      id: nanoid(),
      email: `guest-${suffix}@guest.mapos.local`,
      password: `!guest-${nanoid(12)}`,
      displayName: `Poutník ${suffix.slice(0, 4).toUpperCase()}`
    };
    memoryDb.users.push(user);
    const sessionId = nanoid(32);
    memoryDb.sessions.set(sessionId, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 365 * 86400000)
    });
    reply.setCookie("session", sessionId, { path: "/", httpOnly: true, sameSite: "lax" });
    return {
      user: { id: user.id, email: "", displayName: user.displayName, isGuest: true, xpTotal: 0 },
      created: true
    };
  });

  app.get("/auth/me", async (request) => {
    const user = getSessionUser(request.cookies.session);
    return {
      user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null
    };
  });

  app.get("/user-layers", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layers = memoryDb.userLayers
      .filter((l) => l.userId === user.id)
      .map((l) => ({ ...l, pinCount: memoryDb.pins.filter((p) => p.layerId === l.id).length }));
    return { layers };
  });

  app.post<{ Body: { name: string; color?: string } }>("/user-layers", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = {
      id: nanoid(),
      userId: user.id,
      name: request.body.name,
      color: request.body.color ?? "#10b981",
      slug: request.body.name.toLowerCase().replace(/\s+/g, "-"),
      isPublic: 0
    };
    memoryDb.userLayers.push(layer);
    return { layer: { ...layer, pinCount: 0 } };
  });

  app.post<{ Params: { layerId: string }; Body: { name: string; lng: number; lat: number } }>(
    "/user-layers/:layerId/pins",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const layer = memoryDb.userLayers.find(
        (l) => l.id === request.params.layerId && l.userId === user.id
      );
      if (!layer) return reply.code(404).send({ message: "Layer not found" });
      const pin = { id: nanoid(), layerId: layer.id, ...request.body };
      memoryDb.pins.push(pin);
      return { pin };
    }
  );

  app.get<{ Querystring: { from: string; to: string; profile?: "foot" | "bike" | "car" } }>(
    "/routing",
    async (request, reply) => {
      try {
        return await fetchRoute(
          request.query.from,
          request.query.to,
          request.query.profile ?? "foot"
        );
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  // The game endpoints below run the *same* deterministic spawner as production (game/spawn.ts)
  // rather than returning empty stubs. That parity is the point: e2e runs and local dev
  // exercise the real catch/resolve loop, which is how the mode came to look "broken" before —
  // it was only ever broken in the environments people actually ran it in.
  app.get<{ Querystring: { bbox?: string } }>("/game/zones", async (request) => {
    const user = getSessionUser(request.cookies.session);
    const completed = user ? (memoryDb.questCompletions.get(user.id) ?? new Set<string>()) : null;
    let anchored: Awaited<ReturnType<typeof anchoredQuestsForBbox>> = [];
    if (request.query.bbox) {
      try {
        anchored = await anchoredQuestsForBbox(parseBbox(request.query.bbox));
      } catch {
        anchored = [];
      }
    }
    return {
      zones: memoryDb.zones,
      quests: [
        ...memoryDb.quests.map((q) => ({ ...q, anchored: false })),
        ...anchored
          .filter((q) => !completed?.has(q.id))
          .map((q) => ({
            id: q.id,
            zoneId: null,
            title: q.title,
            description: q.description,
            rewardPoints: q.rewardPoints,
            lng: q.lng,
            lat: q.lat,
            anchored: true,
            sourceId: q.sourceId,
            anchorName: q.anchorName
          }))
      ],
      completedQuestIds: completed ? [...completed] : []
    };
  });

  app.get<{ Querystring: { bbox?: string } }>("/game/ghosts", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      const ghosts = ghostsForBbox(bbox)
        .filter((g) => !memoryDb.caughtGhosts.has(g.id))
        .map((g) => ({ id: g.id, lng: g.lng, lat: g.lat, gotchiId: g.gotchiId }));
      return { ghosts };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Params: { id: string } }>("/game/ghosts/:id/catch", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const ghost = ghostById(request.params.id);
    if (!ghost) return reply.code(404).send({ message: "Ghost not found" });
    if (memoryDb.caughtGhosts.has(ghost.id)) {
      return reply.code(400).send({ message: "Ghost already caught" });
    }
    memoryDb.caughtGhosts.add(ghost.id);
    return { ok: true, gotchiId: ghost.gotchiId };
  });

  app.get<{ Querystring: { bbox?: string } }>("/game/encounters", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      const encounters = encountersForBbox(bbox)
        .filter((e) => !memoryDb.resolvedEncounters.has(e.id))
        .slice(0, 3)
        .map((e) => ({
          id: e.id,
          lng: e.lng,
          lat: e.lat,
          templateKind: e.templateKind,
          lootTier: e.lootTier,
          zoneId: null
        }));
      return { encounters };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Params: { id: string } }>("/game/encounters/:id/resolve", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const encounter = encounterById(request.params.id);
    if (!encounter) return reply.code(404).send({ message: "Encounter not found" });
    if (memoryDb.resolvedEncounters.has(encounter.id)) {
      return reply.code(400).send({ message: "Already resolved" });
    }
    memoryDb.resolvedEncounters.add(encounter.id);
    return { ok: true, rewardUsd: REWARD_BY_TIER[encounter.lootTier], loot: "mystery shard" };
  });

  app.post<{ Params: { id: string }; Body?: { lng?: number; lat?: number } }>(
    "/game/quests/:id/complete",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const questId = request.params.id;
      const done = memoryDb.questCompletions.get(user.id) ?? new Set<string>();

      let rewardPoints: number;
      if (parseAnchoredQuestId(questId)) {
        const { lng, lat } = request.body ?? {};
        if (typeof lng !== "number" || typeof lat !== "number") {
          return reply.code(400).send({ message: "Poloha je potřeba k potvrzení questu" });
        }
        const verified = await verifyAnchoredQuest(questId, { lng, lat });
        if (!verified) return reply.code(404).send({ message: "Quest not found" });
        if (!verified.withinRange) {
          return reply.code(400).send({
            message: `Jsi ${Math.round(verified.distanceM)} m daleko, potřebuješ být do ${COMPLETION_RADIUS_M} m`
          });
        }
        rewardPoints = verified.quest.rewardPoints;
      } else {
        const quest = memoryDb.quests.find((q) => q.id === questId);
        if (!quest) return reply.code(404).send({ message: "Quest not found" });
        rewardPoints = quest.rewardPoints;
      }

      if (done.has(questId)) return reply.code(400).send({ message: "Quest already completed" });
      done.add(questId);
      memoryDb.questCompletions.set(user.id, done);
      return { ok: true, rewardPoints, rewardUsd: rewardPoints * 0.05 };
    }
  );

  app.get("/game/staking/overview", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return {
      staking: {
        stakedUsd: 0,
        pendingYieldUsd: 0,
        totalWithdrawnUsd: 0,
        totalQuestRewardsUsd: 0,
        tier: "none",
        apy: 0.03
      },
      recentRewardEvents: []
    };
  });

  app.get("/layers/park4night/features", async () => ({ type: "FeatureCollection", features: [] }));

  app.get("/weather/frames", async () => ({ frames: [] }));

  app.get("/weather/owm/:layer/:z/:x/:yfile", async (_request, reply) => reply.code(404).send());

  app.get("/photos/resolve", async () => ({ url: null }));

  app.get("/geocode", async () => ({
    results: [{ display_name: "Plzeň, Česko", lat: "49.7475", lon: "13.3775" }]
  }));

  app.get("/geocode/reverse", async () => ({ country: "CZ" }));

  app.get("/places/enrich", async () => ({
    fsqId: null,
    address: null,
    rating: null,
    ratingCount: null,
    photos: [],
    tips: []
  }));

  // Echoes back the pin's own hints — enough for the info engine's panels to render offline.
  app.get<{
    Params: { id: string };
    Querystring: {
      sourceRefs?: string;
      lng?: string;
      lat?: string;
      name?: string;
      category?: string;
    };
  }>("/places/:id", async (request, reply) => {
    const lng = Number(request.query.lng);
    const lat = Number(request.query.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return reply.code(404).send({ message: "Place not found" });
    }
    const id = decodeURIComponent(request.params.id);
    return {
      id,
      name: request.query.name ?? "Místo",
      lng,
      lat,
      category: request.query.category ?? "poi",
      sources: parseSourceRefs(request.query.sourceRefs ?? id).map((r) => ({
        source: r.source,
        sourceRef: r.ref,
        confidence: 0.5,
        refreshedAt: new Date().toISOString()
      }))
    };
  });

  app.get("/discover/regions", async () => ({
    regions: [
      {
        id: "CZ-PLK",
        name: "Plzeňský kraj",
        level: "kraj",
        parent: "CZ",
        bbox: [12.4, 49.02, 13.89, 50.13],
        osmPois: 0,
        userPins: 0
      }
    ],
    geojson: { type: "FeatureCollection", features: [] }
  }));

  app.get("/discover/summary", async () => ({
    text: "Plzeňský kraj je region Česka plný míst k objevování.",
    model: "fallback",
    cached: false
  }));

  app.get("/discover", async () => ({
    posts: [],
    // Ranked shape, so the panel renders the same fields it does against the real server.
    places: [
      {
        id: "demo-castle",
        name: "Plzeň — historické centrum",
        category: "castle",
        lng: 13.3775,
        lat: 49.7475,
        score: 3.1,
        signals: { sitelinks: 12 }
      }
    ],
    wikipedia: []
  }));

  return app;
}

async function main() {
  const app = await buildMemoryApp();
  const port = Number(process.env.PORT ?? 4033);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`MapOS API (memory) listening on :${port}`);
}

main().catch(console.error);
