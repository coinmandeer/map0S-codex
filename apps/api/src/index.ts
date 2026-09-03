import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import type { Bbox, ContentDraft, DataProvider, TripPlan } from "@mapos/layer-sdk";
import {
  registerUser,
  loginUser,
  logoutSession,
  getSessionUser,
  getSessionId,
  publicUser,
  createGuestUser,
  upgradeGuest,
  rotateSession
} from "./services/authService.js";
import { parseBbox } from "./services/layerService.js";
import { fetchRoute, type RouteProfile } from "./services/routingService.js";
import { calculateTripPlan } from "./services/routingPlanService.js";
import {
  createTripPlan,
  deleteTripPlan,
  listTripPlans,
  postgresPlanDocumentRepository,
  updateTripPlan
} from "./services/tripPlanStore.js";
import {
  addComment,
  canonicalizePlace,
  deleteDraft,
  follow,
  listComments,
  listDrafts,
  listFollows,
  listReviews,
  saveDraft,
  submitDraftForReview,
  socialFeed,
  unfollow,
  upsertReview
} from "./services/socialService.js";
import { mapyGeocode } from "./services/mapyService.js";
import {
  presentMapyGeocodeResult,
  presentNominatimGeocodeResult,
  type NominatimGeocodeItem
} from "./services/geocodePresentation.js";
import { registerMapyRoutes } from "./routes/mapyRoutes.js";
import { registerBasemapRoutes } from "./routes/basemapRoutes.js";
import { registerWeatherGridRoutes } from "./routes/weatherGridRoutes.js";
import { registerInfoRoutes } from "./routes/infoRoutes.js";
import { registerSavedPlaceRoutes } from "./routes/savedPlaceRoutes.js";
import { registerPlanV2Routes } from "./routes/planV2Routes.js";
import { registerEventRoutes } from "./routes/eventRoutes.js";
import { registerIdentityRoutes } from "./routes/identityRoutes.js";
import { registerLayerExtensionRoutes } from "./routes/layerExtensionRoutes.js";
import { registerCommerceRoutes } from "./routes/commerceRoutes.js";
import { registerOperationalRoutes } from "./routes/operationalRoutes.js";
import { registerDataRightsRoutes } from "./routes/dataRightsRoutes.js";
import { registerAiRoutes } from "./routes/aiRoutes.js";
import { featureProvider, layerListing } from "./services/featureProviders.js";
import { getFusedPlaces } from "./services/poiFusionService.js";
import { parsePlaceSources, parsePoiCategories } from "./services/placesPresentation.js";
import {
  listUserLayers,
  createUserLayer,
  updateUserLayer,
  deleteUserLayer,
  addPin,
  listPinsForOwnedLayer,
  updatePin,
  deletePin,
  getPublicLayerBySlug,
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
import { collectGameOrbs, getGameProgress } from "./services/gameProgressService.js";
import { getNamespacedGameState, patchNamespacedGameState } from "./services/gameProfileService.js";
import { fetchGameRoads } from "./services/gameRoadService.js";
import { getTopTags } from "./services/tagService.js";
import { rankByNotability } from "./services/notabilityService.js";
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
import { startQuestAnchorRefresher } from "./game/questAnchorCache.js";
import { resolvePhoto } from "./services/photoService.js";
import { enrichPlace } from "./services/placeEnrichmentService.js";
import { getPlaceDetail } from "./services/placeDetailService.js";
import { listDiscoverRegions } from "./services/regionService.js";
import { getRegionSummary } from "./services/regionSummaryService.js";
import { reverseGeocodeCountry } from "./services/discoverService.js";
import { registerGuideRoutes } from "./routes/guideRoutes.js";
import { registerDiscoverContextRoutes } from "./routes/discoverContextRoutes.js";
import {
  createEventServiceGuideLister,
  createGuidedDiscoverContextService
} from "./services/guide/guideComposition.js";
import { createOllamaWebTools } from "./services/ai/webTools.js";
import { initDb, sql } from "./db/index.js";
import { capabilities, config } from "./config.js";
import { getMapyReadiness } from "./services/providerReadinessService.js";
import { SavedPlaceService } from "./services/savedPlaceService.js";
import { postgresSavedPlaceRepository } from "./services/savedPlaceRepository.js";
import { createAdjacentRouteProvider } from "./services/adjacentRouteProvider.js";
import { EventService } from "./services/events/eventService.js";
import { postgresEventRepository } from "./services/events/eventPostgresRepository.js";
import { configuredTicketmasterEventAdapter } from "./services/dataSources/events.js";
import { LinkedIdentityService } from "./services/identity/identityService.js";
import { PostgresIdentityRepository } from "./services/identity/postgresIdentityRepository.js";
import { ViemEoaSiweVerifier } from "./services/identity/viemSiweVerifier.js";
import {
  TtlWalletDisplayMetadataResolver,
  ViemEnsNameProvider
} from "./services/identity/ensDisplayResolver.js";
import {
  GatedAavegotchiInventoryAdapter,
  SimulatedAavegotchiInventoryAdapter
} from "./services/identity/aavegotchiInventory.js";
import { DeclarativeHttpLayerService } from "./services/declarativeHttpLayerService.js";
import { LayerImportService } from "./services/layerImportService.js";
import { postgresLayerImportRepository } from "./services/layerImportPostgresRepository.js";
import { CommerceService } from "./services/commerce/commerceService.js";
import { postgresCommerceRepository } from "./services/commerce/commercePostgresRepository.js";
import { DataRightsService } from "./services/dataRightsService.js";
import { postgresDataRightsRepository } from "./services/dataRightsPostgresRepository.js";
import { SyntheticPaymentProvider } from "./services/commerce/paymentProvider.js";
import {
  messageForClient,
  registerClientSafeErrorHandler,
  safeErrorLogFields,
  statusForClient
} from "./utils/clientError.js";
import { sessionCookieOptions } from "./utils/sessionCookie.js";
import { operationalTelemetry } from "./observability/operationalTelemetry.js";
import { registerRequestTelemetry } from "./observability/requestTelemetry.js";
import { fetchJson, providerCircuitBreaker } from "./utils/upstream.js";
import {
  AUTH_LOGIN_SCHEMA,
  AUTH_REGISTER_SCHEMA,
  CANONICALIZE_PLACE_SCHEMA,
  exactCorsOriginPolicy,
  FixedWindowRateLimiter,
  NO_BODY_SCHEMA,
  PROTOTYPE_STAKING_AMOUNT_SCHEMA,
  rateLimitAllRequests,
  requireAllowedMutationOrigin,
  rateLimitByIp,
  type RequestRateLimiter
} from "./security/publicApiHardening.js";
import {
  DistributedFixedWindowRateLimiter,
  PostgresRateLimitWindowStore
} from "./security/distributedRateLimiter.js";
import { installBoundedPublicRouteSchemas } from "./security/publicRouteSchemas.js";
import { registerCspReporting } from "./security/cspReporting.js";
import { createProviderNeutralAiRuntime } from "./services/ai/runtime.js";
import { createFusedPlacesNearestPoiSource } from "./services/ai/nearestPoiSources.js";
import {
  createAiChatTurnFactory,
  createProductionChatToolProviders
} from "./services/ai/chatComposition.js";
import { discussPlanWithCml } from "./services/ai/planDiscussionService.js";
import { createAiPlanProposalCoordinator } from "./services/ai/planEditor.js";
import { postgresPlanShareRepository } from "./services/planSharePostgresRepository.js";
import { postgresPlanDiscussionRepository } from "./services/planDiscussionPostgresRepository.js";
import { findOsmAdventurePlaces } from "./services/adventurePlaceProvider.js";

const publicApiRateLimiter = new FixedWindowRateLimiter();
const savedPlaceService = new SavedPlaceService(postgresSavedPlaceRepository);

function withinPrototypeRateLimit(key: string, max = 40) {
  return publicApiRateLimiter.consume(key, max, 60_000).allowed;
}

export interface BuildAppOptions {
  logger?: boolean;
  corsOrigins?: string[];
  trustedProxies?: string | false;
  prototypeStakingEnabled?: boolean;
  operationsToken?: string;
  rateLimiter?: RequestRateLimiter;
  /** Test/CI observer used to inventory route contracts without reaching any handler. */
  observeRoute?: (route: {
    method: string | string[];
    url: string;
    schema?: unknown;
    bodyLimit?: number;
  }) => void;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const corsOrigins = options.corsOrigins ?? config.corsOrigins;
  const prototypeStakingEnabled = options.prototypeStakingEnabled ?? config.prototypeStakingEnabled;
  const ticketmasterEventAdapter = configuredTicketmasterEventAdapter();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.MAPOS_LOG_LEVEL?.trim() || "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.headers['x-api-key']",
                "request.headers.authorization",
                "request.headers.cookie"
              ],
              censor: "[REDACTED]"
            }
          },
    disableRequestLogging: true,
    genReqId: () => randomUUID(),
    trustProxy: options.trustedProxies ?? config.trustedProxies
  });

  installBoundedPublicRouteSchemas(app);

  if (options.observeRoute) {
    app.addHook("onRoute", (route) => {
      options.observeRoute?.({
        method: route.method,
        url: route.url,
        schema: route.schema,
        bodyLimit: route.bodyLimit
      });
    });
  }

  registerRequestTelemetry(app, operationalTelemetry);

  await app.register(cors, {
    origin: corsOrigins.length ? exactCorsOriginPolicy(corsOrigins) : false,
    credentials: true,
    strictPreflight: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Content-Type"],
    exposedHeaders: ["X-Request-ID"],
    maxAge: 600
  });
  await app.register(cookie);
  await app.register(compress, { global: true, threshold: 512 });
  app.addHook("onRequest", requireAllowedMutationOrigin(corsOrigins));
  app.addHook(
    "preHandler",
    rateLimitAllRequests(options.rateLimiter ?? new FixedWindowRateLimiter())
  );
  registerClientSafeErrorHandler(app);

  app.get("/health", async () => ({ status: "ok", service: "mapos-v3" }));
  registerCspReporting(app);
  registerOperationalRoutes(app, {
    token: options.operationsToken ?? config.operationsToken,
    telemetry: operationalTelemetry,
    circuits: () => providerCircuitBreaker.snapshots()
  });

  // Availability, not merely presence of credentials. Mapy also depends on its local cache
  // schema, so a deployment with a key and a broken migration must not advertise it as usable.
  app.get("/config", async () => {
    const base = capabilities();
    const mapy = await getMapyReadiness();
    return {
      capabilities: { ...base, mapy: base.mapy && mapy.status === "ready" },
      providers: { mapy }
    };
  });

  registerMapyRoutes(app);
  registerBasemapRoutes(app);
  registerWeatherGridRoutes(app);
  registerInfoRoutes(app);
  registerSavedPlaceRoutes(app, {
    service: savedPlaceService,
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null
  });
  const recordAiToolTrace = (trace: { status: string; durationMs: number }) =>
    operationalTelemetry.recordAiRun({
      status: trace.status as Parameters<typeof operationalTelemetry.recordAiRun>[0]["status"],
      cached: false,
      durationMs: trace.durationMs
    });
  const aiRuntime = createProviderNeutralAiRuntime({
    nearestPoiSource: createFusedPlacesNearestPoiSource(getFusedPlaces),
    onToolTrace: recordAiToolTrace
  });
  const eventService = new EventService(
    postgresEventRepository,
    ticketmasterEventAdapter ? [ticketmasterEventAdapter] : []
  );
  // Objevuj reads its guide from many sources at once (§30.5); the web collector exists only where
  // there is a key for it. The assistant shares this instance so `get_region_context` and the panel
  // answer from one cache, and so they cannot disagree about which region the map centre is in.
  const guidedDiscoverContextService = createGuidedDiscoverContextService({
    web: createOllamaWebTools(),
    events: createEventServiceGuideLister(eventService)
  });
  // The assistant proposes plan edits; this coordinator is the only thing that can apply one,
  // and it re-reads the plan before it does (§30.8).
  const planProposals = createAiPlanProposalCoordinator({
    repository: postgresPlanDocumentRepository
  });
  registerAiRoutes(app, {
    orchestrator: aiRuntime.orchestrator,
    planProposals,
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null,
    allowedLayerIds: new Set(["osm-poi", "vanlife", "park4night", "events"]),
    chatTurn: createAiChatTurnFactory({
      conversations: aiRuntime.conversations,
      providers: createProductionChatToolProviders({
        savedPlaces: savedPlaceService,
        events: eventService,
        discover: guidedDiscoverContextService
      }),
      onToolTrace: recordAiToolTrace,
      planEditor: planProposals.editor
    }),
    discussPlan: discussPlanWithCml,
    planRepository: postgresPlanDocumentRepository,
    planDiscussionRepository: postgresPlanDiscussionRepository
  });
  registerPlanV2Routes(app, {
    repository: postgresPlanDocumentRepository,
    shareRepository: postgresPlanShareRepository,
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null,
    providerFor: createAdjacentRouteProvider,
    findAdventurePlaces: findOsmAdventurePlaces
  });
  registerEventRoutes(app, {
    service: eventService,
    refreshProvider: Boolean(ticketmasterEventAdapter)
  });
  const commerceProvider =
    config.commerceProvider === "synthetic"
      ? new SyntheticPaymentProvider(config.commerceSyntheticSecret!)
      : null;
  registerCommerceRoutes(app, {
    service: new CommerceService(postgresCommerceRepository, commerceProvider),
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null
  });
  registerLayerExtensionRoutes(app, {
    importService: new LayerImportService(postgresLayerImportRepository),
    // Declarative sources are unavailable until an operator reviews and registers exact hosts.
    sourceService: new DeclarativeHttpLayerService([]),
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null
  });
  const identityOrigin = new URL(config.siweOrigin);
  const identityService = new LinkedIdentityService(
    new PostgresIdentityRepository(),
    new ViemEoaSiweVerifier(),
    {
      domain: identityOrigin.host,
      uri: new URL("/api/v2/auth/siwe/verify", identityOrigin).toString(),
      allowedChainIds: config.siweChainIds,
      siweEnabled: config.siweEnabled,
      simulationEnabled: config.identitySimulationEnabled
    }
  );
  const gatedInventory = new GatedAavegotchiInventoryAdapter();
  const simulatedInventory = new SimulatedAavegotchiInventoryAdapter(
    [],
    config.identitySimulationEnabled
  );
  const identityDisplayMetadata = new TtlWalletDisplayMetadataResolver(
    config.ensRpcUrl ? new ViemEnsNameProvider(config.ensRpcUrl) : null
  );
  registerIdentityRoutes(app, {
    service: identityService,
    async resolveSession(request) {
      const sessionId = getSessionId(request);
      const user = await getSessionUser(sessionId);
      return user && sessionId ? { userId: user.id, sessionId } : null;
    },
    rotateSession,
    applySession(reply, session) {
      reply.setCookie("session", session.sessionId, sessionCookieOptions(session.expiresAt));
    },
    inventoryFor(identity) {
      return identity.simulated ? simulatedInventory : gatedInventory;
    },
    displayMetadata: identityDisplayMetadata
  });
  registerDataRightsRoutes(app, {
    service: new DataRightsService(postgresDataRightsRepository),
    resolveUserId: async (request) => (await getSessionUser(getSessionId(request)))?.id ?? null,
    clearSession(reply) {
      reply.clearCookie("session", sessionCookieOptions());
    }
  });

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
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstva je dočasně nedostupná") });
    }
  });

  app.get<{
    Params: { layerId: string };
    Querystring: {
      bbox?: string;
      limit?: string;
      cursor?: string;
      days?: string;
      minMagnitude?: string;
    };
  }>("/v2/layers/:layerId/features", async (request, reply) => {
    try {
      const provider = featureProvider(request.params.layerId);
      if (!provider?.featuresV2) {
        return reply.code(404).send({ message: "Layer has no compatible v2 feature contract" });
      }
      const user = await getSessionUser(getSessionId(request));
      return await provider.featuresV2({
        bbox: parseBbox(request.query.bbox),
        query: request.query,
        userId: user?.id
      });
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstva je dočasně nedostupná") });
    }
  });

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/register",
    {
      schema: AUTH_REGISTER_SCHEMA,
      bodyLimit: 4 * 1024,
      preHandler: rateLimitByIp(publicApiRateLimiter, {
        bucket: "auth-register",
        limit: 20,
        windowMs: 60 * 60_000
      })
    },
    async (request, reply) => {
      try {
        const { email, password, displayName } = request.body;
        const user = await registerUser(email, password, displayName ?? email.split("@")[0]!);
        const login = await loginUser(email, password);
        reply.setCookie("session", login.sessionId, sessionCookieOptions(login.expiresAt));
        return { user: publicUser(user) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Registrace se nezdařila") });
      }
    }
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    {
      schema: AUTH_LOGIN_SCHEMA,
      bodyLimit: 4 * 1024,
      preHandler: rateLimitByIp(publicApiRateLimiter, {
        bucket: "auth-login",
        limit: 30,
        windowMs: 5 * 60_000
      })
    },
    async (request, reply) => {
      try {
        const login = await loginUser(request.body.email, request.body.password);
        reply.setCookie("session", login.sessionId, sessionCookieOptions(login.expiresAt));
        return { user: publicUser(login.user) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Přihlášení se nezdařilo") });
      }
    }
  );

  app.post("/auth/logout", { schema: NO_BODY_SCHEMA, bodyLimit: 1024 }, async (request, reply) => {
    const sessionId = getSessionId(request);
    if (sessionId) await logoutSession(sessionId);
    reply.clearCookie("session", sessionCookieOptions());
    return { ok: true };
  });

  // Called on every boot. Returns the existing identity when there is one, so it is safe to
  // fire unconditionally; only a visitor with no valid session gets a fresh guest.
  app.post(
    "/auth/guest",
    {
      schema: NO_BODY_SCHEMA,
      bodyLimit: 1024,
      preHandler: rateLimitByIp(publicApiRateLimiter, {
        bucket: "auth-guest",
        limit: 60,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      const existing = await getSessionUser(getSessionId(request));
      if (existing) return { user: publicUser(existing), created: false };

      const guest = await createGuestUser();
      reply.setCookie("session", guest.sessionId, sessionCookieOptions(guest.expiresAt));
      return { user: publicUser(guest.user), created: true };
    }
  );

  // Upgrading in place keeps the guest's id, so their pins, XP and caught ghosts survive.
  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/upgrade",
    {
      schema: AUTH_REGISTER_SCHEMA,
      bodyLimit: 4 * 1024,
      preHandler: rateLimitByIp(publicApiRateLimiter, {
        bucket: "auth-upgrade",
        limit: 10,
        windowMs: 60 * 60_000
      })
    },
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
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Převod účtu se nezdařil") });
      }
    }
  );

  app.get("/auth/me", async (request) => {
    const user = await getSessionUser(getSessionId(request));
    return { user: user ? publicUser(user) : null };
  });

  app.get("/me/personal-summary", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const [counts] = await sql<{ plans: number; places: number; layers: number }[]>`SELECT
        (SELECT count(*)::int FROM trip_plans WHERE user_id = ${user.id}) AS plans,
        (SELECT count(*)::int FROM saved_places WHERE user_id = ${user.id}) AS places,
        (SELECT count(*)::int FROM user_layers WHERE user_id = ${user.id}) AS layers`;
    reply.header("cache-control", "private, no-store");
    return {
      plans: Number(counts?.plans ?? 0),
      places: Number(counts?.places ?? 0),
      layers: Number(counts?.layers ?? 0)
    };
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

  app.patch<{
    Params: { layerId: string };
    Body: { name?: string; color?: string; isPublic?: boolean };
  }>("/user-layers/:layerId", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { layer: await updateUserLayer(request.params.layerId, user.id, request.body) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstvu se nepodařilo upravit") });
    }
  });

  app.delete<{ Params: { layerId: string } }>("/user-layers/:layerId", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      await deleteUserLayer(request.params.layerId, user.id);
      return reply.code(204).send();
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstvu se nepodařilo smazat") });
    }
  });

  app.get<{ Params: { layerId: string } }>("/user-layers/:layerId/pins", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { pins: await listPinsForOwnedLayer(request.params.layerId, user.id) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Piny se nepodařilo načíst") });
    }
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
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Pin se nepodařilo uložit") });
    }
  });

  app.patch<{
    Params: { layerId: string; pinId: string };
    Body: {
      name?: string;
      description?: string;
      lng?: number;
      lat?: number;
      tags?: string[];
      kind?: string;
    };
  }>("/user-layers/:layerId/pins/:pinId", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return {
        pin: await updatePin(request.params.layerId, request.params.pinId, user.id, request.body)
      };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Pin se nepodařilo upravit") });
    }
  });

  app.delete<{ Params: { layerId: string; pinId: string } }>(
    "/user-layers/:layerId/pins/:pinId",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      try {
        await deletePin(request.params.layerId, request.params.pinId, user.id);
        return reply.code(204).send();
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Pin se nepodařilo smazat") });
      }
    }
  );

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
      const [posts, candidates, wiki] = await Promise.all([
        getDiscoverPins(country, bbox, request.query.tag),
        bbox ? getTopOsmForCountry(bbox) : Promise.resolve([]),
        bbox ? loadWikipediaPois({ west, south, east, north }) : Promise.resolve([])
      ]);
      // "Most interesting" is a claim, so it is ranked rather than sliced. Without a bbox there
      // is nothing to rank against and the list stays as it came from the database.
      const places = bbox ? await rankByNotability(candidates, { bbox }) : candidates;
      return { country, posts, places, wikipedia: wiki };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Objevování je dočasně nedostupné") });
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
    const layer = await getPublicLayerBySlug(request.params.slug);
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
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Trasování je dočasně nedostupné") });
    }
  });

  app.post<{ Body: { plan?: Partial<TripPlan>; provider?: DataProvider } }>(
    "/routing/plan",
    async (request, reply) => {
      try {
        return await calculateTripPlan(
          request.body?.plan ?? {},
          request.body?.provider === "mapy" ? "mapy" : "osm"
        );
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Plánování trasy je dočasně nedostupné") });
      }
    }
  );

  app.get("/plans", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return { plans: await listTripPlans(user.id) };
  });

  app.post<{ Body: Partial<TripPlan> }>("/plans", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { plan: await createTripPlan(user.id, request.body ?? {}) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Plán nelze uložit") });
    }
  });

  app.patch<{ Params: { id: string }; Body: Partial<TripPlan> }>(
    "/plans/:id",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      try {
        return { plan: await updateTripPlan(user.id, request.params.id, request.body ?? {}) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Plán nelze upravit") });
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      await deleteTripPlan(user.id, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Plán nelze smazat") });
    }
  });

  app.post<{
    Body: {
      name?: string;
      lng?: number;
      lat?: number;
      category?: string;
      sources?: Array<{ source?: string; sourceRef?: string; payload?: Record<string, unknown> }>;
    };
  }>(
    "/places/canonicalize",
    {
      schema: CANONICALIZE_PLACE_SCHEMA,
      bodyLimit: 64 * 1024,
      preHandler: rateLimitByIp(publicApiRateLimiter, {
        bucket: "place-canonicalize-ip",
        limit: 60,
        windowMs: 60_000
      })
    },
    async (request, reply) => {
      // Canonicalization writes durable shared rows. The browser already bootstraps a guest
      // identity, so requiring that session closes the unauthenticated write without adding a
      // login wall for legitimate users.
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!withinPrototypeRateLimit(`place:${user.id}`, 20)) {
        return reply.code(429).send({ message: "Zkus to prosím za chvíli" });
      }
      try {
        return { place: await canonicalizePlace(request.body) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Místo nelze sjednotit") });
      }
    }
  );

  app.get("/follows", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return { follows: await listFollows(user.id) };
  });

  app.post<{ Body: { targetType?: string; targetId?: string } }>(
    "/follows",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!withinPrototypeRateLimit(`social:${user.id}`))
        return reply.code(429).send({ message: "Zkus to prosím za chvíli" });
      try {
        return { follow: await follow(user.id, request.body?.targetType, request.body?.targetId) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Sledování nelze uložit") });
      }
    }
  );

  app.delete<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/follows",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      try {
        await unfollow(user.id, request.query.targetType, request.query.targetId);
        return reply.code(204).send();
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Sledování nelze odebrat") });
      }
    }
  );

  app.get<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/reviews",
    async (request, reply) => {
      try {
        return { reviews: await listReviews(request.query.targetType, request.query.targetId) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Hodnocení nelze načíst") });
      }
    }
  );

  app.post<{ Body: { targetType?: string; targetId?: string; rating?: number; body?: string } }>(
    "/reviews",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!withinPrototypeRateLimit(`social:${user.id}`))
        return reply.code(429).send({ message: "Zkus to prosím za chvíli" });
      try {
        return { review: await upsertReview(user.id, request.body ?? {}) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Hodnocení nelze uložit") });
      }
    }
  );

  app.get<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/comments",
    async (request, reply) => {
      try {
        return { comments: await listComments(request.query.targetType, request.query.targetId) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Komentáře nelze načíst") });
      }
    }
  );

  app.post<{ Body: { targetType?: string; targetId?: string; body?: string } }>(
    "/comments",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!withinPrototypeRateLimit(`social:${user.id}`))
        return reply.code(429).send({ message: "Zkus to prosím za chvíli" });
      try {
        return { comment: await addComment(user.id, request.body ?? {}) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Komentář nelze uložit") });
      }
    }
  );

  app.get("/drafts", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return { drafts: await listDrafts(user.id) };
  });

  app.post<{ Body: Partial<ContentDraft> }>("/drafts", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { draft: await saveDraft(user.id, request.body ?? {}) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Koncept nelze uložit") });
    }
  });

  app.patch<{ Params: { id: string }; Body: Partial<ContentDraft> }>(
    "/drafts/:id",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      try {
        return { draft: await saveDraft(user.id, request.body ?? {}, request.params.id) };
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Koncept nelze upravit") });
      }
    }
  );

  app.post<{ Params: { id: string } }>("/drafts/:id/submit", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { draft: await submitDraftForReview(user.id, request.params.id) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Koncept nelze odeslat ke kontrole") });
    }
  });

  app.delete<{ Params: { id: string } }>("/drafts/:id", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      await deleteDraft(user.id, request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Koncept nelze smazat") });
    }
  });

  app.get<{
    Querystring: { cursor?: string; limit?: string; country?: string; bbox?: string; tag?: string };
  }>("/feed", async (request) => {
    const user = await getSessionUser(getSessionId(request));
    const limit = Math.max(1, Math.min(50, Number(request.query.limit) || 20));
    let bbox: Bbox | undefined;
    try {
      bbox = request.query.bbox ? parseBbox(request.query.bbox) : undefined;
    } catch {
      bbox = undefined;
    }
    return socialFeed(
      user?.id ?? null,
      request.query.cursor,
      limit,
      (request.query.country ?? "ALL").toUpperCase(),
      bbox,
      request.query.tag
    );
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

  app.get<{ Querystring: { bbox?: string } }>("/game/roads", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      return reply.header("cache-control", "public, max-age=86400").send({
        roads: await fetchGameRoads(bbox),
        source: "OpenStreetMap via Overpass"
      });
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Silniční pole je dočasně nedostupné") });
    }
  });

  app.get("/game/progress", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { progress: await getGameProgress(user.id) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Postup hry je dočasně nedostupný") });
    }
  });

  app.get<{ Querystring: { gameId?: string } }>("/games/state", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return await getNamespacedGameState(user.id, request.query.gameId ?? "aavegotchi");
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Herní stav nelze načíst") });
    }
  });

  app.patch<{ Body: { gameId?: string; state?: Record<string, unknown> } }>(
    "/games/state",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      try {
        return await patchNamespacedGameState(
          user.id,
          request.body?.gameId ?? "aavegotchi",
          request.body?.state ?? {}
        );
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Herní stav nelze uložit") });
      }
    }
  );

  app.post<{ Body: { orbIds?: string[] } }>("/game/orbs/collect", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return { progress: await collectGameOrbs(user.id, request.body?.orbIds) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Kuličky se nepodařilo uložit") });
    }
  });

  app.post<{ Params: { id: string }; Body?: { lng?: number; lat?: number } }>(
    "/game/quests/:id/complete",
    async (request, reply) => {
      const user = await getSessionUser(getSessionId(request));
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const { lng, lat } = request.body ?? {};
      const at = typeof lng === "number" && typeof lat === "number" ? { lng, lat } : undefined;
      try {
        return await completeQuest(request.params.id, user.id, { at });
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Quest se nepodařilo dokončit") });
      }
    }
  );

  app.get<{ Querystring: { bbox?: string } }>("/game/ghosts", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      return { ghosts: await getGhostsForBbox(bbox) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Duchové jsou dočasně nedostupní") });
    }
  });

  app.post<{ Params: { id: string } }>("/game/ghosts/:id/catch", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      const result = await catchGhost(request.params.id, user.id);
      return result;
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Ducha se nepodařilo chytit") });
    }
  });

  app.get<{ Querystring: { bbox?: string } }>("/game/encounters", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      return { encounters: await listEncounters(bbox) };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Encountery jsou dočasně nedostupné") });
    }
  });

  app.post<{ Params: { id: string } }>("/game/encounters/:id/resolve", async (request, reply) => {
    const user = await getSessionUser(getSessionId(request));
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    try {
      return await resolveEncounter(request.params.id, user.id);
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Encounter se nepodařilo dokončit") });
    }
  });

  // Synthetic USD balances are a prototype fixture, not live staking or custody. Keep the
  // routes absent from the public API unless an operator deliberately enables that prototype.
  if (prototypeStakingEnabled) {
    app.get(
      "/game/staking/overview",
      {
        preHandler: rateLimitByIp(publicApiRateLimiter, {
          bucket: "prototype-staking-read",
          limit: 60,
          windowMs: 60_000
        })
      },
      async (request, reply) => {
        const user = await getSessionUser(getSessionId(request));
        if (!user) return reply.code(401).send({ message: "Unauthorized" });
        const staking = await getStakingOverview(user.id);
        const recentRewardEvents = await listRewardEvents(user.id, 10);
        return { staking, recentRewardEvents };
      }
    );

    app.post<{ Body: { amountUsd: number } }>(
      "/game/staking/stake",
      {
        schema: PROTOTYPE_STAKING_AMOUNT_SCHEMA,
        bodyLimit: 1024,
        preHandler: rateLimitByIp(publicApiRateLimiter, {
          bucket: "prototype-staking-write",
          limit: 20,
          windowMs: 60_000
        })
      },
      async (request, reply) => {
        const user = await getSessionUser(getSessionId(request));
        if (!user) return reply.code(401).send({ message: "Unauthorized" });
        try {
          return { staking: await stakeUsd(user.id, request.body.amountUsd) };
        } catch (err) {
          return reply
            .code(statusForClient(err))
            .send({ message: messageForClient(err, "Stake se nepodařilo uložit") });
        }
      }
    );

    app.post<{ Body: { amountUsd: number } }>(
      "/game/staking/unstake",
      {
        schema: PROTOTYPE_STAKING_AMOUNT_SCHEMA,
        bodyLimit: 1024,
        preHandler: rateLimitByIp(publicApiRateLimiter, {
          bucket: "prototype-unstaking-write",
          limit: 20,
          windowMs: 60_000
        })
      },
      async (request, reply) => {
        const user = await getSessionUser(getSessionId(request));
        if (!user) return reply.code(401).send({ message: "Unauthorized" });
        try {
          return { staking: await unstakeUsd(user.id, request.body.amountUsd) };
        } catch (err) {
          return reply
            .code(statusForClient(err))
            .send({ message: messageForClient(err, "Unstake se nepodařilo uložit") });
        }
      }
    );
  }

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
      if (request.query.provider !== "osm" && capabilities().mapy) {
        try {
          const items = await mapyGeocode(q, "cs", 5);
          if (items.length) {
            return {
              results: items.map(presentMapyGeocodeResult)
            };
          }
        } catch (err) {
          app.log.warn(safeErrorLogFields(err), "mapy geocode failed, falling back to nominatim");
        }
      }

      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
        const data = await fetchJson<NominatimGeocodeItem[]>(url, {
          providerId: "nominatim",
          ttlMs: 24 * 60 * 60_000,
          timeoutMs: 8_000,
          minIntervalMs: 1_100,
          maxResponseBytes: 512 * 1024
        });
        return {
          results: data.map(presentNominatimGeocodeResult)
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
    const viewer = await getSessionUser(getSessionId(request));
    const lng = Number(request.query.lng);
    const lat = Number(request.query.lat);
    const place = await getPlaceDetail(
      {
        id: decodeURIComponent(request.params.id),
        sourceRefs: request.query.sourceRefs,
        lng: Number.isFinite(lng) ? lng : undefined,
        lat: Number.isFinite(lat) ? lat : undefined,
        name: request.query.name,
        category: request.query.category
      },
      { viewerUserId: viewer?.id ?? null }
    );
    if (!place) return reply.code(404).send({ message: "Place not found" });
    return place;
  });

  // Raw fused places, provenance intact — for anything that wants more than map pins
  // (place detail, CML briefs, future social surfaces).
  app.get<{ Querystring: { bbox?: string; categories?: string; sources?: string } }>(
    "/places",
    async (request, reply) => {
      try {
        return await getFusedPlaces({
          bbox: parseBbox(request.query.bbox),
          categories: parsePoiCategories(request.query.categories),
          sources: parsePlaceSources(request.query.sources)
        });
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Místa jsou dočasně nedostupná") });
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

  registerGuideRoutes(app);
  registerDiscoverContextRoutes(app, { service: guidedDiscoverContextService });

  return app;
}

async function main() {
  await initDb();
  startRadarArchiver();
  startQuestAnchorRefresher();
  const app = await buildApp({
    rateLimiter: new DistributedFixedWindowRateLimiter(
      new PostgresRateLimitWindowStore(sql),
      config.rateLimitSecret
    )
  });
  const port = Number(process.env.PORT ?? 4033);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`MapOS API listening on :${port}`);
}

// Keep imports side-effect free so route/schema tests can build the app without starting a
// listener, migrations or background downloads. `node dist/index.js` and `tsx src/index.ts`
// still enter the production bootstrap because argv[1] names this module.
const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntrypoint) {
  main().catch((err) => {
    console.error("MapOS API startup failed", safeErrorLogFields(err));
    process.exit(1);
  });
}
