import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import type { Bbox } from "@mapos/layer-sdk";
import {
  registerUser,
  loginUser,
  logoutSession,
  getSessionUser,
  getSessionId,
  publicUser,
  createGuestUser,
  upgradeGuest
} from "./services/authService.js";
import { parseBbox } from "./services/layerService.js";
import { fetchRoute, type RouteProfile } from "./services/routingService.js";
import { mapyGeocode } from "./services/mapyService.js";
import { registerMapyRoutes } from "./routes/mapyRoutes.js";
import { registerWeatherGridRoutes } from "./routes/weatherGridRoutes.js";
import { registerInfoRoutes } from "./routes/infoRoutes.js";
import { featureProvider, layerListing } from "./services/featureProviders.js";
import { getFusedPlaces } from "./services/poiFusionService.js";
import { parsePlaceSources, parsePoiCategories } from "./services/placesPresentation.js";
import {
  listUserLayers,
  createUserLayer,
  addPin,
  getLayerBySlug,
  getPinsForLayer,
  getDiscoverPins,
  getTopOsmForCountry
} from "./services/userLayerService.js";
import {
  getGameState,
  getGhostsForBbox,
  catchGhost,
  completeQuest
} from "./services/gameService.js";
import { getTopTags } from "./services/tagService.js";
import { loadWikipediaPois } from "./services/discoverService.js";
import { listEncounters, resolveEncounter } from "./services/encounterService.js";
import {
  getStakingOverview,
  stakeUsd,
  unstakeUsd,
  listRewardEvents
} from "./services/stakingService.js";
import {
  startRadarArchiver,
  listWeatherFrames,
  radarTilePath,
  fetchOwmTile
} from "./services/weatherService.js";
import { resolvePhoto } from "./services/photoService.js";
import { enrichPlace } from "./services/placeEnrichmentService.js";
import { getPlaceDetail } from "./services/placeDetailService.js";
import { listDiscoverRegions } from "./services/regionService.js";
import { getRegionSummary } from "./services/regionSummaryService.js";
import { reverseGeocodeCountry } from "./services/discoverService.js";
import { initDb } from "./db/index.js";
import { capabilities, config } from "./config.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true
  });
  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 512 });

  app.get("/health", async () => ({ status: "ok", service: "mapos-v3" }));

  // Which optional upstreams have credentials. The frontend uses this to disable UI it
  // cannot serve; it never carries a key value itself.
  app.get("/config", async () => ({ capabilities: capabilities() }));

  registerMapyRoutes(app);
  registerWeatherGridRoutes(app);
  registerInfoRoutes(app);

  app.get("/layers", async () => ({ layers: layerListing() }));

  app.get<{
    Params: { layerId: string };
    Querystring: {
      bbox?: string;
      categories?: string;
      tag?: string;
      country?: string;
      sources?: string;
    };
  }>("/layers/:layerId/features", async (request, reply) => {
    try {
      const provider = featureProvider(request.params.layerId);
      if (!provider?.features) {
        return reply.code(404).send({ message: "Layer not found" });
      }
      const user = await getSessionUser(getSessionId(request));
      return await provider.features({
        bbox: parseBbox(request.query.bbox),
        query: request.query,
        userId: user?.id
      });
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/register",
    async (request, reply) => {
      try {
        const { email, password, displayName } = request.body;
        const user = await registerUser(email, password, displayName ?? email.split("@")[0]!);
        const login = await loginUser(email, password);
        reply.setCookie("session", login.sessionId, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          expires: login.expiresAt
        });
        return { user: publicUser(user) };
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  app.post<{ Body: { email: string; password: string } }>("/auth/login", async (request, reply) => {
    try {
      const login = await loginUser(request.body.email, request.body.password);
      reply.setCookie("session", login.sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        expires: login.expiresAt
      });
      return { user: publicUser(login.user) };
    } catch (err) {
      return reply.code(401).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = getSessionId(request);
    if (sessionId) await logoutSession(sessionId);
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  // Called on every boot. Returns the existing identity when there is one, so it is safe to
  // fire unconditionally; only a visitor with no valid session gets a fresh guest.
  app.post("/auth/guest", async (request, reply) => {
    const existing = await getSessionUser(getSessionId(request));
    if (existing) return { user: publicUser(existing), created: false };

    const guest = await createGuestUser();
    reply.setCookie("session", guest.sessionId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expires: guest.expiresAt
    });
    return { user: publicUser(guest.user), created: true };
  });

  // Upgrading in place keeps the guest's id, so their pins, XP and caught ghosts survive.
  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/upgrade",
    async (request, reply) => {
      const current = await getSessionUser(getSessionId(request));
      if (!current) return reply.code(401).send({ message: "Unauthorized" });
      if (current.isGuest !== 1)
        return reply.code(400).send({ message: "Účet už je registrovaný" });
      try {
        const { email, password, displayName } = request.body;
        const user = await upgradeGuest(
          current.id,
          email,
          password,
          displayName ?? email.split("@")[0]!
        );
        return { user: publicUser(user) };
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  app.get("/auth/me", async (request) => {
    const user = await getSessionUser(getSessionId(request));
    return { user: user ? publicUser(user) : null };
  });

  app.get("/user-layers", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layers = await listUserLayers(user.id);
    return { layers };
  });

  app.post<{ Body: { name: string; color?: string } }>("/user-layers", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = await createUserLayer(
      user.id,
      request.body.name,
      request.body.color ?? "#10b981"
    );
    return { layer };
  });

  app.post<{
    Params: { layerId: string };
    Body: {
      name: string;
      lng: number;
      lat: number;
      description?: string;
      tags?: string[];
      kind?: string;
      properties?: Record<string, unknown>;
    };
  }>("/user-layers/:layerId/pins", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      const pin = await addPin(
        request.params.layerId,
        user.id,
        request.body.name,
        request.body.lng,
        request.body.lat,
        request.body.description,
        request.body.tags,
        request.body.kind,
        user.displayName,
        request.body.properties
      );
      return { pin };
    } catch (err) {
      return reply.code(404).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>("/tags/top", async (request) => {
    const q = request.query.q?.trim();
    const limit = Math.min(Number(request.query.limit ?? 20) || 20, 50);
    return { tags: await getTopTags(q, limit) };
  });

  app.get<{
    Querystring: {
      country?: string;
      west?: string;
      south?: string;
      east?: string;
      north?: string;
      tag?: string;
    };
  }>("/discover", async (request, reply) => {
    try {
      const country = (request.query.country ?? "CZ").toUpperCase();
      const west = Number(request.query.west);
      const south = Number(request.query.south);
      const east = Number(request.query.east);
      const north = Number(request.query.north);
      const bbox = [west, south, east, north].every(Number.isFinite)
        ? ([west, south, east, north] as [number, number, number, number])
        : undefined;
      const [posts, places, wiki] = await Promise.all([
        getDiscoverPins(country, bbox, request.query.tag),
        bbox ? getTopOsmForCountry(bbox) : Promise.resolve([]),
        bbox ? loadWikipediaPois({ west, south, east, north }) : Promise.resolve([])
      ]);
      return { country, posts, places, wikipedia: wiki };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get<{ Querystring: { west?: string; south?: string; east?: string; north?: string } }>(
    "/wikipedia-pois",
    async (request, reply) => {
      const west = Number(request.query.west);
      const south = Number(request.query.south);
      const east = Number(request.query.east);
      const north = Number(request.query.north);
      if (![west, south, east, north].every(Number.isFinite)) {
        return reply.code(400).send({ message: "west,south,east,north required" });
      }
      return { items: await loadWikipediaPois({ west, south, east, north }) };
    }
  );

  app.get<{ Params: { slug: string } }>("/l/:slug", async (request, reply) => {
    const layer = await getLayerBySlug(request.params.slug);
    if (!layer) return reply.code(404).send({ message: "Not found" });
    const pins = await getPinsForLayer(layer.id);
    return { layer, pins };
  });

  app.get<{
    Querystring: {
      from: string;
      to: string;
      profile?: string;
      provider?: string;
      waypoints?: string;
      avoidToll?: string;
    };
  }>("/routing", async (request, reply) => {
    try {
      return await fetchRoute(
        request.query.from,
        request.query.to,
        (request.query.profile ?? "foot") as RouteProfile,
        {
          provider: request.query.provider === "mapy" ? "mapy" : "osm",
          waypoints: request.query.waypoints?.split(";").filter(Boolean),
          avoidToll: request.query.avoidToll === "1"
        }
      );
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get<{ Querystring: { bbox?: string } }>("/game/zones", async (request) => {
    const user = await getSessionUser(getSessionId(request));
    let bbox: Bbox | undefined;
    try {
      bbox = request.query.bbox ? parseBbox(request.query.bbox) : undefined;
    } catch {
      bbox = undefined;
    }
    return getGameState(user?.id, bbox);
  });

  app.post<{ Params: { id: string }; Body?: { lng?: number; lat?: number } }>(
    "/game/quests/:id/complete",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const { lng, lat } = request.body ?? {};
      const at =
        typeof lng === "number" && typeof lat === "number" ? { lng, lat } : undefined;
      try {
        return await completeQuest(request.params.id, user.id, { at });
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  app.get<{ Querystring: { bbox?: string } }>("/game/ghosts", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      return { ghosts: await getGhostsForBbox(bbox) };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Params: { id: string } }>("/game/ghosts/:id/catch", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      const result = await catchGhost(request.params.id, user.id);
      return result;
    } catch (err) {
      return reply.code(404).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get<{ Querystring: { bbox?: string } }>("/game/encounters", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      return { encounters: await listEncounters(bbox) };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Params: { id: string } }>("/game/encounters/:id/resolve", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return await resolveEncounter(request.params.id, user.id);
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get("/game/staking/overview", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const staking = await getStakingOverview(user.id);
    const recentRewardEvents = await listRewardEvents(user.id, 10);
    return { staking, recentRewardEvents };
  });

  app.post<{ Body: { amountUsd: number } }>("/game/staking/stake", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { staking: await stakeUsd(user.id, request.body.amountUsd) };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.post<{ Body: { amountUsd: number } }>("/game/staking/unstake", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { staking: await unstakeUsd(user.id, request.body.amountUsd) };
    } catch (err) {
      return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
    }
  });

  app.get("/weather/frames", async () => ({ frames: await listWeatherFrames() }));

  app.get<{ Params: { ts: string; z: string; x: string; yfile: string } }>(
    "/weather/radar/:ts/:z/:x/:yfile",
    async (request, reply) => {
      const y = parseInt(request.params.yfile, 10);
      const filePath = radarTilePath(
        Number(request.params.ts),
        Number(request.params.z),
        Number(request.params.x),
        y
      );
      try {
        await stat(filePath);
        reply.header("Cache-Control", "public, max-age=604800, immutable");
        reply.type("image/png");
        return reply.send(createReadStream(filePath));
      } catch {
        return reply.code(404).send();
      }
    }
  );

  app.get<{ Params: { layer: string; z: string; x: string; yfile: string } }>(
    "/weather/owm/:layer/:z/:x/:yfile",
    async (request, reply) => {
      const y = parseInt(request.params.yfile, 10);
      const buf = await fetchOwmTile(
        request.params.layer,
        Number(request.params.z),
        Number(request.params.x),
        y
      );
      if (!buf) return reply.code(404).send();
      reply.header("Cache-Control", "public, max-age=600");
      reply.type("image/png");
      return reply.send(buf);
    }
  );

  app.get<{ Querystring: { wikidata?: string } }>("/photos/resolve", async (request, reply) => {
    if (!request.query.wikidata) return reply.code(400).send({ message: "wikidata required" });
    const url = await resolvePhoto(request.query.wikidata);
    return { url };
  });

  app.get<{ Querystring: { q?: string; provider?: string } }>(
    "/geocode",
    async (request, reply) => {
      const q = (request.query.q ?? "").trim();
      if (q.length < 2) return { results: [] };

      // Mapy geocoding is markedly better in CZ/SK; Nominatim stays the keyless default and the
      // fallback whenever Mapy is unavailable, so search never goes dead.
      if (request.query.provider === "mapy" && capabilities().mapy) {
        try {
          const items = await mapyGeocode(q, "cs", 5);
          if (items.length) {
            return {
              results: items.map((i) => ({
                display_name: i.label || i.name,
                lat: String(i.position.lat),
                lon: String(i.position.lon)
              }))
            };
          }
        } catch (err) {
          app.log.warn({ err }, "mapy geocode failed, falling back to nominatim");
        }
      }

      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": config.userAgent },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return reply.code(502).send({ results: [] });
        const data = (await res.json()) as Array<{
          display_name: string;
          lat: string;
          lon: string;
        }>;
        return {
          results: data.map((r) => ({ display_name: r.display_name, lat: r.lat, lon: r.lon }))
        };
      } catch {
        return reply.code(502).send({ results: [] });
      }
    }
  );

  app.get<{ Querystring: { lat?: string; lng?: string } }>("/geocode/reverse", async (request) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { country: null };
    return { country: await reverseGeocodeCountry(lng, lat) };
  });

  app.get<{
    Querystring: { lng?: string; lat?: string; name?: string; category?: string; osmId?: string };
  }>("/places/enrich", async (request, reply) => {
    const lng = Number(request.query.lng);
    const lat = Number(request.query.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return reply.code(400).send({ message: "lng and lat required" });
    }
    return enrichPlace({
      lng,
      lat,
      name: request.query.name,
      category: request.query.category,
      osmId: request.query.osmId
    });
  });

  // One place, resolved from its source refs. The hints come from the clicked pin so a place
  // no resolver owns still opens; `/places` ids are viewport-scoped, not database keys.
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
    const place = await getPlaceDetail({
      id: decodeURIComponent(request.params.id),
      sourceRefs: request.query.sourceRefs,
      lng: Number.isFinite(lng) ? lng : undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      name: request.query.name,
      category: request.query.category
    });
    if (!place) return reply.code(404).send({ message: "Place not found" });
    return place;
  });

  // Raw fused places, provenance intact — for anything that wants more than map pins
  // (place detail, CML briefs, future social surfaces).
  app.get<{ Querystring: { bbox?: string; categories?: string; sources?: string } }>(
    "/places",
    async (request, reply) => {
      try {
        const user = await getSessionUser(getSessionId(request));
        return await getFusedPlaces({
          bbox: parseBbox(request.query.bbox),
          categories: parsePoiCategories(request.query.categories),
          sources: parsePlaceSources(request.query.sources),
          userId: user?.id
        });
      } catch (err) {
        return reply.code(400).send({ message: err instanceof Error ? err.message : "Error" });
      }
    }
  );

  app.get<{ Querystring: { country?: string; parent?: string } }>(
    "/discover/regions",
    async (request) => {
      const country = (request.query.country ?? "CZ").toUpperCase();
      return listDiscoverRegions(country, request.query.parent);
    }
  );

  app.get<{ Querystring: { region?: string } }>("/discover/summary", async (request, reply) => {
    const region = request.query.region?.trim();
    if (!region) return reply.code(400).send({ message: "region required" });
    return getRegionSummary(region);
  });

  return app;
}

async function main() {
  await initDb();
  startRadarArchiver();
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 4033);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`MapOS API listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
