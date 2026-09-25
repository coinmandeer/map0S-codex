import { memoryChatRequests } from "./services/ai/chatRequests.js";
import { memoryMapArtifacts } from "./services/ai/mapArtifacts.js";
import { memoryChatHistory } from "./services/ai/chatHistory.js";
import { OverviewService } from "./services/ai/overviewService.js";
import { registerEnvironmentEditionRoutes } from "./routes/environmentEditionRoutes.js";
import { createThreadSaver } from "./world/savedThreads.js";
import { WorldQuestSources } from "./world/questIntegration.js";
import { registerWorldRoutes } from "./routes/worldRoutes.js";
import { SocialWorld } from "./world/socialWorld.js";
import { MemoryWorldRepository } from "./world/repository.js";
import { verifyGotchiOwner, LiveGotchiInventory } from "./world/gotchi.js";
import { querySourceFeatures } from "./services/sourceFeatures.js";
import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { nanoid } from "nanoid";
import {
  parseSourceRefs,
  type Bbox,
  type ContentDraft,
  type DataProvider,
  type FeatureCollection,
  type OsmPoiCategoryId,
  type TripPlan,
  type TripPlanResult
} from "@mapos/layer-sdk";
import { fetchRoute } from "./services/routingService.js";
import { normalizeTripPlan } from "./services/routingPlanService.js";
import { memoryGameRoads } from "./services/gameRoadService.js";
import {
  memoryDb,
  seedMemory,
  memoryFeed,
  memoryUserFeatures,
  memoryOsmFeatures,
  memoryPoiFixtures,
  type MemoryUser
} from "./db/memory.js";
import { capabilities, config } from "./config.js";
import { layerListing } from "./services/featureProviders.js";
import { earthquakeFixtureResult } from "./services/dataSources/earthquakeFixture.js";
import { registerMapyRoutes } from "./routes/mapyRoutes.js";
import { registerBasemapRoutes } from "./routes/basemapRoutes.js";
import { registerWeatherGridRoutes } from "./routes/weatherGridRoutes.js";
import { registerBathymetryGridRoutes } from "./routes/bathymetryGridRoutes.js";
import { registerSatelliteRoutes } from "./routes/satelliteRoutes.js";
import { registerStreetObjectRoutes } from "./routes/streetObjectRoutes.js";
import { registerInfoRoutes } from "./routes/infoRoutes.js";
import { registerSavedPlaceRoutes } from "./routes/savedPlaceRoutes.js";
import { registerPlanV2Routes } from "./routes/planV2Routes.js";
import { buildPlanTemporalContext } from "./services/planTemporalContextService.js";
import { registerIdentityRoutes } from "./routes/identityRoutes.js";
import { registerEventRoutes } from "./routes/eventRoutes.js";
import { registerLayerExtensionRoutes } from "./routes/layerExtensionRoutes.js";
import { registerSourceRoutes } from "./routes/sourceRoutes.js";
import { registerThemeRoutes } from "./routes/themeRoutes.js";
import { registerTableRoutes } from "./routes/tableRoutes.js";
import { fixtureThemeQueries } from "./themes/themeFixtures.js";
import {
  fixtureTableById,
  fixtureTableIngestDeps,
  fixtureTablesForOwner
} from "./themes/tableFixtures.js";
import { fixtureAdapterIo } from "./services/sourceFixtures.js";
import { probeSource } from "./services/sourceService.js";
import { registerCommerceRoutes } from "./routes/commerceRoutes.js";
import { registerOperationalRoutes } from "./routes/operationalRoutes.js";
import { registerDataRightsRoutes } from "./routes/dataRightsRoutes.js";
import { registerAiRoutes } from "./routes/aiRoutes.js";
import { createAiPlanProposalCoordinator } from "./services/ai/planEditor.js";
import { registerGuideRoutes } from "./routes/guideRoutes.js";
import { registerDiscoverContextRoutes } from "./routes/discoverContextRoutes.js";
import { registerDiscoverBoundaryRoutes } from "./routes/discoverBoundaryRoutes.js";
import { registerOfflineFixtureRoutes } from "./routes/offlineFixtureRoutes.js";
import { installOfflineFetchGuard, isOfflineFixtureMode } from "./offlineFixtureMode.js";
import {
  createDraftPayload,
  reviseDraftPayload,
  submitDraftPayload
} from "./services/contentDraftWorkflow.js";
import {
  encounterById,
  encountersForBbox,
  ghostById,
  ghostsForBbox,
  REWARD_BY_TIER
} from "./game/spawn.js";
import {
  anchoredQuestFeature,
  anchoredQuestsForBbox,
  questSources,
  registerQuestSource,
  unavailableSourcesNotice,
  verifyAnchoredQuest,
  parseAnchoredQuestId,
  COMPLETION_RADIUS_M,
  type QuestAnchor
} from "./game/anchors.js";
import { composeGameZones } from "./game/worldZones.js";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import {
  ClientError,
  messageForClient,
  registerClientSafeErrorHandler,
  safeErrorLogFields,
  statusForClient
} from "./utils/clientError.js";
import { sessionCookieOptions } from "./utils/sessionCookie.js";
import { SavedPlaceService } from "./services/savedPlaceService.js";
import { memorySavedPlaceRepository } from "./services/savedPlaceMemoryRepository.js";
import { memoryPlanDocumentRepository } from "./services/planDocumentMemoryRepository.js";
import { memoryPlanShareRepository } from "./services/planShareMemoryRepository.js";
import { memoryPlanDiscussionRepository } from "./services/planDiscussionMemoryRepository.js";
import { createMemoryAdjacentRouteProvider } from "./services/adjacentRouteProvider.js";
import { EventService } from "./services/events/eventService.js";
import { MemoryEventRepository } from "./services/events/eventMemoryRepository.js";
import { buildMemoryEventFixtures } from "./services/events/eventFixtures.js";
import { createOfflineDiscoverContextService } from "./services/discoverService.js";
import { createGuidedDiscoverContextService } from "./services/guide/guideComposition.js";
import { createOllamaWebTools } from "./services/ai/webTools.js";
import {
  LinkedIdentityService,
  MemoryIdentityRepository
} from "./services/identity/identityService.js";
import { ViemEoaSiweVerifier } from "./services/identity/viemSiweVerifier.js";
import { TtlWalletDisplayMetadataResolver } from "./services/identity/ensDisplayResolver.js";
import { DeclarativeHttpLayerService } from "./services/declarativeHttpLayerService.js";
import { LayerImportService } from "./services/layerImportService.js";
import { MemoryLayerImportRepository } from "./services/layerImportMemoryRepository.js";
import { CommerceService } from "./services/commerce/commerceService.js";
import { syntheticCommerceCatalog } from "./services/commerce/commerceFixtures.js";
import { MemoryCommerceRepository } from "./services/commerce/commerceMemoryRepository.js";
import { SyntheticPaymentProvider } from "./services/commerce/paymentProvider.js";
import {
  GatedAavegotchiInventoryAdapter,
  SimulatedAavegotchiInventoryAdapter
} from "./services/identity/aavegotchiInventory.js";
import { operationalTelemetry } from "./observability/operationalTelemetry.js";
import { registerRequestTelemetry } from "./observability/requestTelemetry.js";
import { providerCircuitBreaker } from "./utils/upstream.js";
import { FixedWindowRateLimiter, rateLimitAllRequests } from "./security/publicApiHardening.js";
import { registerCspReporting } from "./security/cspReporting.js";
import { DataRightsService } from "./services/dataRightsService.js";
import { MemoryDataRightsRepository } from "./services/dataRightsMemoryRepository.js";
import { createProviderNeutralAiRuntime } from "./services/ai/runtime.js";
import { createMemoryNearestPoiSource } from "./services/ai/nearestPoiSources.js";
import {
  createAiChatTurnFactory,
  createFixtureChatToolProviders
} from "./services/ai/chatComposition.js";

const savedPlaceService = new SavedPlaceService(memorySavedPlaceRepository);

function parseBbox(raw: string | undefined): Bbox {
  if (!raw) throw new ClientError("bbox required");
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) throw new ClientError("invalid bbox");
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

/** The `game-quests` layer offline. Same shaping as the Postgres path, straight off the
 *  registered fixture sources instead of the sweep cache. */
async function memoryQuestAnchorFeatures(bbox: Bbox, sources?: string): Promise<FeatureCollection> {
  const wanted = new Set(
    (sources ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  const selected = questSources().filter(
    (adapter) => !adapter.unavailableReason?.() && (wanted.size === 0 || wanted.has(adapter.id))
  );
  const perSource = await Promise.all(
    selected.map(async (adapter) => {
      const anchors = await adapter.anchors(bbox, 50);
      return anchors.map((anchor) => anchoredQuestFeature(adapter, anchor));
    })
  );
  const features = perSource.flat();
  const notice = features.length ? undefined : unavailableSourcesNotice();
  return { type: "FeatureCollection", features, ...(notice ? { notice } : {}) };
}

function getSessionUser(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = memoryDb.sessions.get(sessionId);
  if (!session || session.expiresAt < new Date()) return null;
  return memoryDb.users.find((u) => u.id === session.userId) ?? null;
}

function publicMemoryUser(user: MemoryUser) {
  return {
    id: user.id,
    email: user.isGuest ? "" : user.email,
    displayName: user.displayName,
    isGuest: user.isGuest,
    xpTotal: user.xpTotal
  };
}

/**
 * A fixture leg that bends, so an offline route does not look like a routing bug.
 *
 * Production routes come from OSRM/Mapy/BRouter and follow roads. The offline server has no road
 * graph, so it fakes the *shape* rather than pretending to know the network: a deterministic
 * dogleg offset perpendicular to the leg. It is not a road, and it is not claimed to be one.
 */
function fixtureLegShape(
  from: readonly [number, number],
  to: readonly [number, number]
): [number, number][] {
  const dLng = to[0] - from[0];
  const dLat = to[1] - from[1];
  const bend = 0.12;
  return [
    [from[0], from[1]],
    [from[0] + dLng * 0.34 - dLat * bend, from[1] + dLat * 0.34 + dLng * bend],
    [from[0] + dLng * 0.68 - dLat * bend * 0.5, from[1] + dLat * 0.68 + dLng * bend * 0.5],
    [to[0], to[1]]
  ];
}

function memoryTripPlanResult(input: Partial<TripPlan>, _provider: DataProvider): TripPlanResult {
  const plan = normalizeTripPlan(input);
  const speedKmh = plan.vehicle.profile === "foot" ? 5 : plan.vehicle.profile === "bike" ? 18 : 70;
  const radians = (value: number) => (value * Math.PI) / 180;
  const distance = (a: TripPlan["stops"][number], b: TripPlan["stops"][number]) => {
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  let cursor = new Date(plan.departureAt).getTime();
  const legs = plan.stops.slice(1).map((stop, index) => {
    const from = plan.stops[index]!;
    const distanceM = Math.round(distance(from, stop));
    const durationS = Math.max(60, Math.round((distanceM / 1000 / speedKmh) * 3600));
    const departureAt = new Date(cursor).toISOString();
    cursor += durationS * 1000;
    const arrivalAt = new Date(cursor).toISOString();
    cursor += stop.dwellMinutes * 60_000;
    return {
      index,
      fromStopId: from.id,
      toStopId: stop.id,
      coordinates: fixtureLegShape([from.lng, from.lat], [stop.lng, stop.lat]),
      distanceM,
      durationS,
      departureAt,
      arrivalAt
    };
  });
  const coordinates = legs.length
    ? legs.flatMap((leg, index) => (index === 0 ? leg.coordinates : leg.coordinates.slice(1)))
    : plan.stops.map((stop) => [stop.lng, stop.lat] as [number, number]);
  const distanceM = legs.reduce((sum, leg) => sum + leg.distanceM, 0);
  const durationS = legs.reduce((sum, leg) => sum + leg.durationS, 0);
  const variants = (["fast", "short", "nohwy"] as const).map((variant) => ({
    variant,
    provider: "osm" as const,
    profile: plan.vehicle.profile,
    coordinates,
    distanceM,
    durationS,
    legs,
    toll: {
      estimatedCzk: null,
      items: [],
      disclaimer: "Deterministický offline testovací server nepočítá mýto."
    },
    restrictions: [],
    restrictionCheck: ["camper", "truck"].includes(plan.vehicle.profile)
      ? ("unavailable" as const)
      : ("not-applicable" as const),
    warnings: ["Omezení vozidla jsou orientační kontrola, nikoliv garantovaný truck routing."]
  }));
  return {
    plan,
    selectedVariant: plan.variant,
    variants,
    weather: plan.stops.map((stop, index) => ({
      stopId: stop.id,
      at: index === 0 ? plan.departureAt : legs[index - 1]!.arrivalAt,
      temperature: 17,
      precipitation: 0,
      weatherCode: 1
    })),
    generatedAt: new Date().toISOString()
  };
}

function memoryRouteResult(fromRaw: string, toRaw: string, profile: "foot" | "bike" | "car") {
  const parse = (raw: string): [number, number] => {
    const [lng, lat] = raw.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new ClientError(`invalid point: ${raw}`);
    }
    return [lng!, lat!];
  };
  const from = parse(fromRaw);
  const to = parse(toRaw);
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(to[1] - from[1]);
  const dLng = radians(to[0] - from[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(dLng / 2) ** 2;
  const distanceM = Math.round(6371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
  const speedKmh = profile === "foot" ? 5 : profile === "bike" ? 18 : 70;
  return {
    coordinates: fixtureLegShape(from, to),
    distanceM,
    durationS: Math.max(60, Math.round((distanceM / 1000 / speedKmh) * 3600)),
    provider: "osm" as const,
    profile
  };
}

interface MemoryAppOptions {
  offlineFixture?: boolean;
  rateLimitMultiplier?: number;
}

export async function buildMemoryApp(options: MemoryAppOptions = {}) {
  const offlineFixture = options.offlineFixture ?? isOfflineFixtureMode();
  // One instance for the panel and for the assistant's `get_region_context`, so both answer from
  // the same cache and cannot disagree about which region the map centre is in (§30.5).
  const discoverContext = offlineFixture
    ? createOfflineDiscoverContextService()
    : createGuidedDiscoverContextService({ web: createOllamaWebTools() });
  seedMemory();
  registerMemoryQuestSource();
  const app = Fastify({ logger: false });
  registerRequestTelemetry(app, operationalTelemetry);
  await app.register(cors, {
    origin: true,
    credentials: true,
    exposedHeaders: ["X-Request-ID"]
  });
  await app.register(cookie);
  app.addHook(
    "preHandler",
    rateLimitAllRequests(new FixedWindowRateLimiter(), {
      limitMultiplier: options.rateLimitMultiplier
    })
  );
  registerClientSafeErrorHandler(app);
  registerCspReporting(app);
  registerSavedPlaceRoutes(app, {
    service: savedPlaceService,
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null
  });
  const recordAiToolTrace = (trace: { status: string; durationMs: number }) =>
    operationalTelemetry.recordAiRun({
      status: trace.status as Parameters<typeof operationalTelemetry.recordAiRun>[0]["status"],
      cached: false,
      durationMs: trace.durationMs
    });
  const aiRuntime = createProviderNeutralAiRuntime({
    nearestPoiSource: createMemoryNearestPoiSource(memoryPoiFixtures),
    onToolTrace: recordAiToolTrace
  });
  // Offline the proposal path is the same code as in production, over the in-memory plans: the
  // e2e profile can confirm and undo an AI edit without a model or a database (§30.8).
  const planProposals = createAiPlanProposalCoordinator({
    repository: memoryPlanDocumentRepository
  });
  registerAiRoutes(app, {
    chatRequests: memoryChatRequests(),
    chatHistory: memoryChatHistory(),
    mapArtifacts: memoryMapArtifacts(),
    overview: new OverviewService({
      detail: async (input) => {
        const fixture = memoryPoiFixtures().find((row) => row.osmId === input.featureId);
        if (!fixture) throw new Error("Offline profil nemá tento zdrojový záznam.");
        return {
          place: {
            id: fixture.osmId,
            name: fixture.name,
            lng: fixture.lng,
            lat: fixture.lat,
            category: fixture.category,
            sources: []
          },
          fields: { name: fixture.name, category: fixture.category },
          source: {
            sourceId: `fixture:${fixture.osmId}`,
            label: fixture.name,
            providerId: "fixture"
          }
        };
      }
    }),
    orchestrator: aiRuntime.orchestrator,
    planProposals,
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null,
    allowedLayerIds: new Set(["osm-poi"]),
    // Offline the assistant runs its deterministic path over the demo fixtures, which is what the
    // e2e profile exercises: same catalog, same tool, no network.
    chatTurn: createAiChatTurnFactory({
      conversations: aiRuntime.conversations,
      providers: createFixtureChatToolProviders({
        fixtures: memoryPoiFixtures,
        discover: discoverContext
      }),
      onToolTrace: recordAiToolTrace,
      planEditor: planProposals.editor
    }),
    discussPlan: async ({ plan, history }) => ({
      text: `Plán „${plan.name}“ má ${plan.stops.length} zastávky. Toto je offline kontrolní odpověď; žádná změna nebyla provedena.`,
      model: "offline-fixture",
      cached: false,
      disclosure: `Offline fixture obdržela pouze omezený přehled plánu${history?.length ? " a historii konverzace" : ""}; žádná externí služba nebyla volána.`
    }),
    planRepository: memoryPlanDocumentRepository,
    planDiscussionRepository: memoryPlanDiscussionRepository
  });
  registerPlanV2Routes(app, {
    repository: memoryPlanDocumentRepository,
    shareRepository: memoryPlanShareRepository,
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null,
    providerFor: () => createMemoryAdjacentRouteProvider(),
    temporalContextForPlan: (plan, provider) =>
      buildPlanTemporalContext(plan, provider, async (stops, arrivalTimes) =>
        stops.map((stop, index) => ({
          stopId: stop.id,
          at: arrivalTimes[index]!,
          temperature: null,
          precipitation: null,
          weatherCode: null
        }))
      )
  });
  registerEventRoutes(app, {
    service: new EventService(new MemoryEventRepository(buildMemoryEventFixtures()), []),
    refreshProvider: false
  });
  const commerceProvider =
    !offlineFixture && config.commerceProvider === "synthetic"
      ? new SyntheticPaymentProvider(config.commerceSyntheticSecret!)
      : null;
  registerCommerceRoutes(app, {
    service: new CommerceService(
      new MemoryCommerceRepository({ catalog: syntheticCommerceCatalog() }),
      commerceProvider
    ),
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null
  });
  registerThemeRoutes(app, { queries: fixtureThemeQueries });
  registerTableRoutes(app, {
    resolveUserId: async (request) => getSessionUser(request.cookies.session)?.id ?? null,
    ingest: fixtureTableIngestDeps,
    loadTable: fixtureTableById,
    listTables: fixtureTablesForOwner,
    queries: fixtureThemeQueries
  });
  registerSourceRoutes(app, {
    resolveUserId: async (request) => getSessionUser(request.cookies.session)?.id ?? null,
    probe: (url) => probeSource(url, fixtureAdapterIo),
    loadManifest: async (layerId, userId) =>
      memoryDb.userLayers.find((layer) => layer.id === layerId && layer.userId === userId)
        ?.sourceManifest ?? null,
    features: (manifest, layerId, bbox, signal) =>
      querySourceFeatures(manifest, layerId, bbox, signal, fixtureAdapterIo),
    createLayer: async (userId, input) => {
      const layer = {
        id: nanoid(),
        userId,
        name: input.name,
        color: input.color ?? "#0ea5e9",
        slug: input.name.toLowerCase().replace(/\s+/g, "-"),
        isPublic: input.isPublic ? 1 : 0,
        sourceUrl: input.sourceUrl,
        sourceManifest: input.sourceManifest,
        sourceAdapterId: input.sourceAdapterId
      };
      memoryDb.userLayers.push(layer);
      return { ...layer, pinCount: 0 };
    }
  });
  registerLayerExtensionRoutes(app, {
    importService: new LayerImportService(new MemoryLayerImportRepository()),
    // Explicitly empty: memory/offline profiles never make a declarative upstream request.
    sourceService: new DeclarativeHttpLayerService([]),
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null
  });
  const identityOrigin = new URL(config.siweOrigin);
  const memoryIdentityRepository = new MemoryIdentityRepository();
  const identityService = new LinkedIdentityService(
    memoryIdentityRepository,
    new ViemEoaSiweVerifier(),
    {
      domain: identityOrigin.host,
      uri: new URL("/api/v2/auth/siwe/verify", identityOrigin).toString(),
      allowedChainIds: config.siweChainIds,
      siweEnabled: true,
      simulationEnabled: true
    }
  );
  const world = new SocialWorld(
    new MemoryWorldRepository((grant) => {
      if (grant.mode === "gps") {
        const u = memoryDb.users.find((u) => u.id === grant.userId);
        if (u) u.xpTotal += Number(grant.xp);
      }
    }),
    {
      externalQuests: new WorldQuestSources(),
      testEnabled: process.env.MAPOS_GAME_TEST_MOVEMENT !== "0",
      async profile(id) {
        const u = memoryDb.users.find((u) => u.id === id);
        return u ? { id: u.id, displayName: u.displayName } : null;
      },
      async initialXp(id) {
        return memoryDb.users.find((u) => u.id === id)?.xpTotal ?? 0;
      },
      async verifyToken(userId, tokenId) {
        const identities = await identityService.list(userId);
        await verifyGotchiOwner(
          identities
            .filter((i) => i.type === "wallet" && i.verifiedAt && !i.revokedAt && !i.simulated)
            .map((i) => i.subject),
          tokenId
        );
      }
    }
  );
  await registerWorldRoutes(app, {
    world,
    enabled: process.env.MAPOS_WORLD_ENABLED !== "0",
    moderator: async (request) =>
      (process.env.MAPOS_WORLD_MODERATORS ?? "")
        .split(",")
        .filter(Boolean)
        .includes(getSessionUser(request.cookies.session)?.id ?? ""),
    saveThread: createThreadSaver(savedPlaceService),
    resolveUser: async (request) => {
      const u = getSessionUser(request.cookies.session);
      return u ? { id: u.id, displayName: u.displayName } : null;
    },
    origins: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      config.siweOrigin,
      ...(process.env.MAPOS_WORLD_ORIGIN ? [process.env.MAPOS_WORLD_ORIGIN] : [])
    ]
  });
  const gatedInventory = offlineFixture
    ? new GatedAavegotchiInventoryAdapter()
    : new LiveGotchiInventory();
  const simulatedInventory = new SimulatedAavegotchiInventoryAdapter(
    [{ tokenId: "42", name: "MapOS fixture Gotchi", wearableIds: [], metadataSourceUrl: null }],
    true
  );
  registerIdentityRoutes(app, {
    service: identityService,
    async resolveSession(request) {
      const sessionId = request.cookies.session;
      const user = getSessionUser(sessionId);
      return user && sessionId ? { userId: user.id, sessionId } : null;
    },
    async rotateSession(userId, previousSessionId) {
      const current = memoryDb.sessions.get(previousSessionId);
      if (!current || current.userId !== userId || current.expiresAt <= new Date()) {
        throw new ClientError("Session is no longer valid", 401);
      }
      memoryDb.sessions.delete(previousSessionId);
      const sessionId = nanoid(32);
      const expiresAt = new Date(Date.now() + 30 * 86400000);
      memoryDb.sessions.set(sessionId, { userId, expiresAt });
      return { sessionId, expiresAt };
    },
    applySession(reply, session) {
      reply.setCookie("session", session.sessionId, sessionCookieOptions(session.expiresAt));
    },
    inventoryFor(identity) {
      return identity.simulated ? simulatedInventory : gatedInventory;
    },
    // Offline fixtures never probe a public RPC and never hardcode an ENS ownership claim.
    displayMetadata: new TtlWalletDisplayMetadataResolver(null)
  });
  registerDataRightsRoutes(app, {
    eraseWorld: (id) => world.eraseUser(id),
    exportWorld: (id) => world.exportUser(id),
    service: new DataRightsService(new MemoryDataRightsRepository(memoryIdentityRepository)),
    resolveUserId: (request) => getSessionUser(request.cookies.session)?.id ?? null,
    clearSession(reply) {
      reply.clearCookie("session", sessionCookieOptions());
    }
  });
  registerOperationalRoutes(app, {
    telemetry: operationalTelemetry,
    circuits: () => providerCircuitBreaker.snapshots()
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "mapos-v3-memory",
    release: process.env.MAPOS_RELEASE ?? "development",
    ...(offlineFixture ? { fixtureMode: "offline" } : {})
  }));

  app.get("/config", async () => {
    const configured = capabilities();
    const base = offlineFixture
      ? Object.fromEntries(
          Object.entries(configured).map(([name, value]) => [
            name,
            name === "cmlProvider"
              ? "none"
              : name === "commerceCore"
                ? true
                : typeof value === "boolean"
                  ? false
                  : value
          ])
        )
      : configured;
    return {
      capabilities: { ...base, siwe: true, identitySimulation: true },
      // The deterministic e2e server never probes third parties. Production replaces this
      // configured-only state with an active database + upstream readiness result.
      providers: {
        mapy: {
          status: base.mapy ? "unknown" : "unconfigured",
          checkedAt: new Date().toISOString(),
          tookMs: 0
        }
      },
      ...(offlineFixture ? { fixtureMode: "offline" } : {})
    };
  });

  if (offlineFixture) {
    registerOfflineFixtureRoutes(app);
  } else {
    registerMapyRoutes(app);
    registerBasemapRoutes(app);
    registerWeatherGridRoutes(app);
    registerBathymetryGridRoutes(app);
    registerSatelliteRoutes(app);
    registerStreetObjectRoutes(app);
    registerEnvironmentEditionRoutes(app);
    registerInfoRoutes(app);
    registerGuideRoutes(app);
  }
  registerDiscoverContextRoutes(app, { service: discoverContext });
  registerDiscoverBoundaryRoutes(app, {
    coverage: async () => [],
    tile: async () => new Uint8Array()
  });

  // Shared with the real server so a new provider can't show up in one and not the other. The
  // feature route below still answers from memory — the point of this server is not touching
  // the network or a database.
  app.get("/layers", async () => ({ layers: layerListing() }));

  app.get<{
    Params: { layerId: string };
    Querystring: { bbox?: string; categories?: string; sources?: string };
  }>("/layers/:layerId/features", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      const { layerId } = request.params;
      if (layerId === "osm-poi") {
        const cats = (request.query.categories ?? "castle,viewpoint,parking")
          .split(",")
          .filter((c): c is OsmPoiCategoryId => c in OSM_POI_CATEGORIES);
        return memoryOsmFeatures(bbox, cats);
      }
      if (layerId === "weed") {
        return {
          type: "FeatureCollection",
          features: [],
          notice: "Offline ukázka nenačítá celosvětová data OpenStreetMap."
        };
      }
      if (layerId === "user-layers") {
        return memoryUserFeatures(bbox, getSessionUser(request.cookies.session)?.id);
      }
      if (layerId === "game-quests") {
        // Straight from the registered sources: offline those are local fixtures, so there is
        // nothing for the sweep cache to protect and no database to hold it.
        return memoryQuestAnchorFeatures(bbox, request.query.sources);
      }
      return reply.code(404).send({ message: "Layer not found" });
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstva je dočasně nedostupná") });
    }
  });

  app.get<{
    Params: { layerId: string };
    Querystring: { bbox?: string; limit?: string; days?: string; minMagnitude?: string };
  }>("/v2/layers/:layerId/features", async (request, reply) => {
    try {
      const bbox = parseBbox(request.query.bbox);
      if (request.params.layerId !== "earthquakes") {
        return reply.code(404).send({ message: "Layer has no compatible v2 feature contract" });
      }
      return earthquakeFixtureResult(bbox, request.query);
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Vrstva je dočasně nedostupná") });
    }
  });

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
        displayName: displayName ?? email.split("@")[0]!,
        isGuest: false,
        xpTotal: 0
      };
      memoryDb.users.push(user);
      const sessionId = nanoid(32);
      memoryDb.sessions.set(sessionId, {
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400000)
      });
      reply.setCookie(
        "session",
        sessionId,
        sessionCookieOptions(memoryDb.sessions.get(sessionId)!.expiresAt)
      );
      return { user: publicMemoryUser(user) };
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
    reply.setCookie(
      "session",
      sessionId,
      sessionCookieOptions(memoryDb.sessions.get(sessionId)!.expiresAt)
    );
    return { user: publicMemoryUser(user) };
  });

  app.post("/auth/logout", async (request, reply) => {
    const sid = request.cookies.session;
    if (sid) memoryDb.sessions.delete(sid);
    reply.clearCookie("session", sessionCookieOptions());
    return { ok: true };
  });

  app.post("/auth/guest", async (request, reply) => {
    const existing = getSessionUser(request.cookies.session);
    if (existing) {
      return { user: publicMemoryUser(existing), created: false };
    }
    const suffix = nanoid(12);
    const user: MemoryUser = {
      id: nanoid(),
      email: `guest-${suffix}@guest.mapos.local`,
      password: `!guest-${nanoid(12)}`,
      displayName: `Poutník ${suffix.slice(0, 4).toUpperCase()}`,
      isGuest: true,
      xpTotal: 0
    };
    memoryDb.users.push(user);
    const sessionId = nanoid(32);
    memoryDb.sessions.set(sessionId, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 365 * 86400000)
    });
    reply.setCookie(
      "session",
      sessionId,
      sessionCookieOptions(memoryDb.sessions.get(sessionId)!.expiresAt)
    );
    return { user: publicMemoryUser(user), created: true };
  });

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/auth/upgrade",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!user.isGuest) return reply.code(400).send({ message: "Účet už je registrovaný" });
      if (memoryDb.users.some((candidate) => candidate.email === request.body.email)) {
        return reply.code(400).send({ message: "Email already registered" });
      }
      user.email = request.body.email;
      user.password = request.body.password;
      user.displayName = request.body.displayName ?? request.body.email.split("@")[0]!;
      user.isGuest = false;
      return { user: publicMemoryUser(user) };
    }
  );

  app.get("/auth/me", async (request) => {
    const user = getSessionUser(request.cookies.session);
    return { user: user ? publicMemoryUser(user) : null };
  });

  app.get("/me/personal-summary", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layerIds = new Set(
      memoryDb.userLayers.filter((layer) => layer.userId === user.id).map((layer) => layer.id)
    );
    reply.header("cache-control", "private, no-store");
    return {
      plans: memoryDb.tripPlans.filter((row) => row.userId === user.id).length,
      places: memoryDb.savedPlaces.filter((place) => place.userId === user.id).length,
      layers: layerIds.size
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

  app.patch<{
    Params: { layerId: string };
    Body: { name?: string; color?: string; isPublic?: boolean };
  }>("/user-layers/:layerId", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = memoryDb.userLayers.find(
      (candidate) => candidate.id === request.params.layerId && candidate.userId === user.id
    );
    if (!layer) return reply.code(404).send({ message: "Layer not found" });
    if (request.body.name !== undefined) layer.name = request.body.name.trim();
    if (request.body.color !== undefined) layer.color = request.body.color;
    if (request.body.isPublic !== undefined) layer.isPublic = request.body.isPublic ? 1 : 0;
    return {
      layer: {
        ...layer,
        pinCount: memoryDb.pins.filter((pin) => pin.layerId === layer.id).length
      }
    };
  });

  app.delete<{ Params: { layerId: string } }>("/user-layers/:layerId", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const index = memoryDb.userLayers.findIndex(
      (layer) => layer.id === request.params.layerId && layer.userId === user.id
    );
    if (index < 0) return reply.code(404).send({ message: "Layer not found" });
    memoryDb.userLayers.splice(index, 1);
    for (let pinIndex = memoryDb.pins.length - 1; pinIndex >= 0; pinIndex -= 1) {
      if (memoryDb.pins[pinIndex]?.layerId === request.params.layerId) {
        memoryDb.pins.splice(pinIndex, 1);
      }
    }
    return reply.code(204).send();
  });

  app.get<{ Params: { layerId: string } }>("/user-layers/:layerId/pins", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = memoryDb.userLayers.find(
      (candidate) => candidate.id === request.params.layerId && candidate.userId === user.id
    );
    if (!layer) return reply.code(404).send({ message: "Layer not found" });
    return { pins: memoryDb.pins.filter((pin) => pin.layerId === layer.id) };
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
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = memoryDb.userLayers.find(
      (l) => l.id === request.params.layerId && l.userId === user.id
    );
    if (!layer) return reply.code(404).send({ message: "Layer not found" });
    const pin = { id: nanoid(), layerId: layer.id, ...request.body };
    memoryDb.pins.push(pin);
    return { pin };
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
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const layer = memoryDb.userLayers.find(
      (candidate) => candidate.id === request.params.layerId && candidate.userId === user.id
    );
    const pin = memoryDb.pins.find(
      (candidate) =>
        candidate.id === request.params.pinId && candidate.layerId === request.params.layerId
    );
    if (!layer || !pin) return reply.code(404).send({ message: "Pin not found" });
    Object.assign(pin, request.body);
    return { pin };
  });

  app.delete<{ Params: { layerId: string; pinId: string } }>(
    "/user-layers/:layerId/pins/:pinId",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const layer = memoryDb.userLayers.find(
        (candidate) => candidate.id === request.params.layerId && candidate.userId === user.id
      );
      const index = memoryDb.pins.findIndex(
        (pin) => pin.id === request.params.pinId && pin.layerId === request.params.layerId
      );
      if (!layer || index < 0) return reply.code(404).send({ message: "Pin not found" });
      memoryDb.pins.splice(index, 1);
      return reply.code(204).send();
    }
  );

  app.get<{ Params: { slug: string } }>("/l/:slug", async (request, reply) => {
    const layer = memoryDb.userLayers.find(
      (candidate) => candidate.slug === request.params.slug && candidate.isPublic === 1
    );
    if (!layer) return reply.code(404).send({ message: "Not found" });
    return { layer, pins: memoryDb.pins.filter((pin) => pin.layerId === layer.id) };
  });

  app.get<{ Querystring: { from: string; to: string; profile?: "foot" | "bike" | "car" } }>(
    "/routing",
    async (request, reply) => {
      try {
        if (offlineFixture) {
          return memoryRouteResult(
            request.query.from,
            request.query.to,
            request.query.profile ?? "foot"
          );
        }
        return await fetchRoute(
          request.query.from,
          request.query.to,
          request.query.profile ?? "foot"
        );
      } catch (err) {
        return reply
          .code(statusForClient(err))
          .send({ message: messageForClient(err, "Trasování je dočasně nedostupné") });
      }
    }
  );

  app.post<{ Body: { plan?: Partial<TripPlan>; provider?: DataProvider } }>(
    "/routing/plan",
    async (request, reply) => {
      try {
        return memoryTripPlanResult(
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
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return {
      plans: memoryDb.tripPlans.filter((row) => row.userId === user.id).map((row) => row.plan)
    };
  });

  app.post<{ Body: Partial<TripPlan> }>("/plans", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const plan = {
      ...normalizeTripPlan(request.body ?? {}),
      id: nanoid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    memoryDb.tripPlans.push({ userId: user.id, plan });
    return { plan };
  });

  app.patch<{ Params: { id: string }; Body: Partial<TripPlan> }>(
    "/plans/:id",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const row = memoryDb.tripPlans.find(
        (candidate) => candidate.userId === user.id && candidate.plan.id === request.params.id
      );
      if (!row) return reply.code(404).send({ message: "Plán nebyl nalezen" });
      row.plan = {
        ...normalizeTripPlan({ ...request.body, id: request.params.id }),
        id: request.params.id,
        createdAt: row.plan.createdAt,
        updatedAt: new Date().toISOString()
      };
      return { plan: row.plan };
    }
  );

  app.delete<{ Params: { id: string } }>("/plans/:id", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const index = memoryDb.tripPlans.findIndex(
      (candidate) => candidate.userId === user.id && candidate.plan.id === request.params.id
    );
    if (index < 0) return reply.code(404).send({ message: "Plán nebyl nalezen" });
    memoryDb.tripPlans.splice(index, 1);
    return reply.code(204).send();
  });

  app.post<{
    Body: {
      name?: string;
      lng?: number;
      lat?: number;
      category?: string;
      sources?: Array<{ source?: string; sourceRef?: string }>;
    };
  }>("/places/canonicalize", async (request, reply) => {
    const lng = Number(request.body?.lng);
    const lat = Number(request.body?.lat);
    if (!request.body?.name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return reply.code(400).send({ message: "Místo potřebuje název a platné souřadnice" });
    }
    const key = request.body.sources?.[0]?.sourceRef ?? `${lng.toFixed(5)}:${lat.toFixed(5)}`;
    return {
      place: {
        placeId: `memory-place-${encodeURIComponent(key)}`,
        name: request.body.name,
        lng,
        lat,
        category: request.body.category ?? null,
        sources: (request.body.sources ?? []).map((source) => ({
          source: source.source ?? "unknown",
          sourceRef: source.sourceRef ?? "unknown"
        })),
        social: { followers: 0, reviews: 0, rating: null, comments: 0 }
      }
    };
  });

  app.get("/follows", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return { follows: memoryDb.follows.filter((follow) => follow.userId === user.id) };
  });

  app.post<{ Body: { targetType?: string; targetId?: string } }>(
    "/follows",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      if (!request.body?.targetType || !request.body?.targetId)
        return reply.code(400).send({ message: "Neplatný sociální cíl" });
      const follow = {
        userId: user.id,
        targetType: request.body.targetType,
        targetId: request.body.targetId
      };
      if (
        !memoryDb.follows.some(
          (item) =>
            item.userId === follow.userId &&
            item.targetType === follow.targetType &&
            item.targetId === follow.targetId
        )
      )
        memoryDb.follows.push(follow);
      return { follow };
    }
  );

  app.delete<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/follows",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const index = memoryDb.follows.findIndex(
        (item) =>
          item.userId === user.id &&
          item.targetType === request.query.targetType &&
          item.targetId === request.query.targetId
      );
      if (index >= 0) memoryDb.follows.splice(index, 1);
      return reply.code(204).send();
    }
  );

  app.get<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/reviews",
    async (request) => ({
      reviews: memoryDb.reviews.filter(
        (item) =>
          item.targetType === request.query.targetType && item.targetId === request.query.targetId
      )
    })
  );

  app.post<{ Body: { targetType?: string; targetId?: string; rating?: number; body?: string } }>(
    "/reviews",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const rating = Math.round(Number(request.body?.rating));
      if (!request.body?.targetType || !request.body?.targetId || rating < 1 || rating > 5)
        return reply.code(400).send({ message: "Hodnocení musí být 1–5" });
      let review = memoryDb.reviews.find(
        (item) =>
          item.userId === user.id &&
          item.targetType === request.body.targetType &&
          item.targetId === request.body.targetId
      );
      if (review) Object.assign(review, { rating, body: request.body.body ?? null });
      else {
        review = {
          id: nanoid(),
          userId: user.id,
          targetType: request.body.targetType,
          targetId: request.body.targetId,
          rating,
          body: request.body.body ?? null
        };
        memoryDb.reviews.push(review);
      }
      return { review };
    }
  );

  app.get<{ Querystring: { targetType?: string; targetId?: string } }>(
    "/comments",
    async (request) => ({
      comments: memoryDb.comments.filter(
        (item) =>
          item.targetType === request.query.targetType && item.targetId === request.query.targetId
      )
    })
  );

  app.post<{ Body: { targetType?: string; targetId?: string; body?: string } }>(
    "/comments",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const body = String(request.body?.body ?? "")
        .replace(/<[^>]*>/g, "")
        .trim()
        .slice(0, 1600);
      if (!request.body?.targetType || !request.body?.targetId || !body)
        return reply.code(400).send({ message: "Komentář je prázdný" });
      const comment = {
        id: nanoid(),
        userId: user.id,
        targetType: request.body.targetType,
        targetId: request.body.targetId,
        body,
        createdAt: new Date().toISOString()
      };
      memoryDb.comments.push(comment);
      return { comment };
    }
  );

  app.get("/drafts", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    return {
      drafts: memoryDb.drafts.filter((item) => item.userId === user.id).map((item) => item.payload)
    };
  });

  app.post<{ Body: Partial<ContentDraft> }>("/drafts", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const draft = {
      ...createDraftPayload(user.id, request.body ?? {}),
      id: nanoid(),
      updatedAt: new Date().toISOString()
    } as Record<string, unknown> & { id: string };
    memoryDb.drafts.push({ userId: user.id, payload: draft });
    return { draft };
  });

  app.patch<{ Params: { id: string }; Body: Partial<ContentDraft> }>(
    "/drafts/:id",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const row = memoryDb.drafts.find(
        (item) => item.userId === user.id && item.payload.id === request.params.id
      );
      if (!row) return reply.code(404).send({ message: "Koncept nebyl nalezen" });
      Object.assign(
        row.payload,
        reviseDraftPayload(user.id, row.payload as unknown as ContentDraft, request.body ?? {}),
        {
          id: request.params.id,
          updatedAt: new Date().toISOString()
        }
      );
      return { draft: row.payload };
    }
  );

  app.post<{ Params: { id: string } }>("/drafts/:id/submit", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const row = memoryDb.drafts.find(
      (item) => item.userId === user.id && item.payload.id === request.params.id
    );
    if (!row) return reply.code(404).send({ message: "Koncept nebyl nalezen" });
    Object.assign(
      row.payload,
      submitDraftPayload(user.id, row.payload as unknown as ContentDraft),
      { id: request.params.id, updatedAt: new Date().toISOString() }
    );
    return { draft: row.payload };
  });

  app.delete<{ Params: { id: string } }>("/drafts/:id", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const index = memoryDb.drafts.findIndex(
      (item) => item.userId === user.id && item.payload.id === request.params.id
    );
    if (index < 0) return reply.code(404).send({ message: "Koncept nebyl nalezen" });
    memoryDb.drafts.splice(index, 1);
    return reply.code(204).send();
  });

  app.get<{ Querystring: { scope?: string; bbox?: string; tag?: string } }>(
    "/feed",
    async (request) => {
      let bbox: Bbox | undefined;
      try {
        bbox = request.query.bbox ? parseBbox(request.query.bbox) : undefined;
      } catch {
        bbox = undefined;
      }
      return memoryFeed(
        getSessionUser(request.cookies.session)?.id ?? null,
        request.query.scope === "following" ? "following" : "all",
        bbox,
        request.query.tag
      );
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
    let bbox: Bbox | undefined;
    if (request.query.bbox) {
      try {
        bbox = parseBbox(request.query.bbox);
        anchored = await anchoredQuestsForBbox(bbox);
      } catch {
        anchored = [];
      }
    }
    return {
      zones: composeGameZones(memoryDb.zones, anchored, bbox),
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

  // Quests bound to a place: same anchor source as `/game/zones`, scoped to a small radius.
  // Offline fixture mode already serves a deterministic `/game/quests/near`, so this only
  // registers for the live memory composition to avoid a duplicate route.
  if (!offlineFixture)
    app.get<{ Querystring: { lng?: string; lat?: string; radiusKm?: string } }>(
      "/game/quests/near",
      async (request, reply) => {
        const lng = Number(request.query.lng);
        const lat = Number(request.query.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return reply.code(400).send({ message: "lng and lat required" });
        }
        const radiusKm = Math.min(Math.max(Number(request.query.radiusKm) || 3, 0.25), 10);
        const dy = radiusKm / 111.32;
        const dx = dy / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
        const bbox: Bbox = [lng - dx, lat - dy, lng + dx, lat + dy];
        const anchored = await anchoredQuestsForBbox(bbox, 40);
        const rad = Math.PI / 180;
        const quests = anchored
          .map((quest) => {
            const a =
              Math.sin(((quest.lat - lat) * rad) / 2) ** 2 +
              Math.cos(lat * rad) *
                Math.cos(quest.lat * rad) *
                Math.sin(((quest.lng - lng) * rad) / 2) ** 2;
            const distanceM = Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
            return { ...quest, distanceM };
          })
          .filter((quest) => quest.distanceM <= radiusKm * 1000)
          .sort((left, right) => left.distanceM - right.distanceM)
          .slice(0, 12);
        return { quests };
      }
    );

  app.get<{ Querystring: { bbox?: string } }>("/game/roads", async (request, reply) => {
    try {
      return {
        roads: memoryGameRoads(parseBbox(request.query.bbox)),
        source: "deterministic test roads"
      };
    } catch (err) {
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Silniční pole je dočasně nedostupné") });
    }
  });

  app.get("/game/progress", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const collected = memoryDb.collectedOrbs.get(user.id) ?? new Set<string>();
    return {
      progress: {
        xpTotal: user.xpTotal,
        collectedOrbIds: [...collected],
        collectedCount: collected.size
      }
    };
  });

  app.get<{ Querystring: { gameId?: string } }>("/games/state", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const gameId = request.query.gameId ?? "aavegotchi";
    if (!["aavegotchi", "trail-signals"].includes(gameId))
      return reply.code(400).send({ message: "Neznámá hra" });
    const key = `${user.id}:${gameId}`;
    const state =
      memoryDb.gameProfiles.get(key) ?? (gameId === "aavegotchi" ? { xpTotal: user.xpTotal } : {});
    memoryDb.gameProfiles.set(key, state);
    return { gameId, state, updatedAt: new Date().toISOString() };
  });

  app.patch<{ Body: { gameId?: string; state?: Record<string, unknown> } }>(
    "/games/state",
    async (request, reply) => {
      const user = getSessionUser(request.cookies.session);
      if (!user) return reply.code(401).send({ message: "Unauthorized" });
      const gameId = request.body?.gameId ?? "aavegotchi";
      if (!["aavegotchi", "trail-signals"].includes(gameId))
        return reply.code(400).send({ message: "Neznámá hra" });
      const key = `${user.id}:${gameId}`;
      const state = { ...(memoryDb.gameProfiles.get(key) ?? {}), ...(request.body?.state ?? {}) };
      memoryDb.gameProfiles.set(key, state);
      return { gameId, state, updatedAt: new Date().toISOString() };
    }
  );

  app.post<{ Body: { orbIds?: string[] } }>("/game/orbs/collect", async (request, reply) => {
    const user = getSessionUser(request.cookies.session);
    if (!user) return reply.code(401).send({ message: "Unauthorized" });
    const raw = request.body?.orbIds;
    if (!Array.isArray(raw) || raw.length > 4000) {
      return reply.code(400).send({ message: "Invalid orb ids" });
    }
    const prefix = `orb:${user.id}:`;
    if (raw.some((id) => typeof id !== "string" || !id.startsWith(prefix))) {
      return reply.code(400).send({ message: "Invalid orb id" });
    }
    const collected = memoryDb.collectedOrbs.get(user.id) ?? new Set<string>();
    const before = collected.size;
    for (const id of raw) collected.add(id);
    const acceptedCount = collected.size - before;
    user.xpTotal += acceptedCount * 10;
    memoryDb.collectedOrbs.set(user.id, collected);
    return {
      progress: {
        xpTotal: user.xpTotal,
        collectedCount: collected.size,
        acceptedCount
      }
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
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Duchové jsou dočasně nedostupní") });
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
      return reply
        .code(statusForClient(err))
        .send({ message: messageForClient(err, "Encountery jsou dočasně nedostupné") });
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
      user.xpTotal += rewardPoints;
      return { ok: true, rewardPoints, rewardUsd: rewardPoints * 0.05, xpTotal: user.xpTotal };
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
    results: [
      {
        display_name: "Plzeň, Česko",
        lat: "49.7475",
        lon: "13.3775",
        type: "city",
        hierarchy: ["Plzeňský kraj", "Česko"],
        source: { id: "fixture", label: "MapOS offline geokodér" },
        confidence: { level: "high", label: "vysoká", basis: "provider-order" }
      }
    ]
  }));

  app.get("/geocode/reverse", async () => ({ country: "CZ", name: "Offline test area" }));

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
  if (isOfflineFixtureMode()) installOfflineFetchGuard();
  const rawRateLimitMultiplier = process.env.MAPOS_E2E_RATE_LIMIT_MULTIPLIER;
  if (rawRateLimitMultiplier && process.env.NODE_ENV === "production") {
    throw new Error("MAPOS_E2E_RATE_LIMIT_MULTIPLIER is forbidden in production");
  }
  const rateLimitMultiplier = rawRateLimitMultiplier ? Number(rawRateLimitMultiplier) : undefined;
  const app = await buildMemoryApp({ rateLimitMultiplier });
  const port = Number(process.env.PORT ?? 4033);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`MapOS API (memory) listening on :${port}`);
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntrypoint) {
  main().catch((error) => {
    console.error("MapOS memory API startup failed", safeErrorLogFields(error));
    process.exitCode = 1;
  });
}
