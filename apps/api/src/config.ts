/** Single place that reads process.env for optional upstreams. Everything else asks this
 *  module rather than touching env directly, so "is Mapy configured?" has one answer. */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ServerCapabilities as SdkCapabilities } from "@mapos/layer-sdk";

// In production the process gets its env from Docker/systemd. Locally we read the repo-root
// `.env` so `npm run dev` works without a wrapper — real env always wins over the file.
(function loadLocalEnv() {
  if (process.env.NODE_ENV === "production") return;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../../../.env"), resolve(here, "../../../../.env")]) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // Node < 20.12 has no loadEnvFile; the deployment path doesn't need it.
    }
    return;
  }
})();

export type CmlProvider = "ollama" | "openai" | "none";
export type CommerceProvider = "synthetic" | "none";

/** Narrows the SDK's `cmlProvider: string` to the providers this build actually implements. */
export interface ServerCapabilities extends SdkCapabilities {
  cmlProvider: CmlProvider;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const DEV_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

function normalizeHttpOrigin(value: string): string {
  if (value === "*" || value === "null") {
    throw new Error("MAPOS_CORS_ORIGINS cannot contain wildcard or opaque origins");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid CORS origin: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`CORS entries must be bare HTTP(S) origins: ${value}`);
  }
  return url.origin;
}

export function resolveSiweOrigin(
  value: string | undefined,
  enabled: boolean,
  nodeEnv = process.env.NODE_ENV
): string {
  if (value?.trim()) return normalizeHttpOrigin(value.trim());
  if (enabled && nodeEnv === "production") {
    throw new Error("MAPOS_PUBLIC_ORIGIN is required when SIWE is enabled in production");
  }
  return nodeEnv === "production" ? "https://disabled.mapos.invalid" : "http://localhost:5173";
}

export function resolveSiweChainIds(value: string | undefined): ReadonlySet<number> {
  const raw = value?.trim() ? value.split(",") : ["1", "8453"];
  const chainIds = raw.map((item) => Number(item.trim()));
  if (
    !chainIds.length ||
    chainIds.length > 16 ||
    chainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)
  ) {
    throw new Error("MAPOS_SIWE_CHAIN_IDS must contain 1–16 positive integer chain IDs");
  }
  return new Set(chainIds);
}

export function resolveEnsRpcUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("MAPOS_ENS_RPC_URL must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("MAPOS_ENS_RPC_URL must use HTTPS and contain no credentials");
  }
  return parsed.toString();
}

export function resolveCommerceProvider(
  input: {
    enabled?: string;
    provider?: string;
    syntheticEnabled?: string;
    syntheticSecret?: string;
  },
  nodeEnv = process.env.NODE_ENV
): CommerceProvider {
  if (input.enabled?.trim() !== "1") return "none";
  const requested = input.provider?.trim() || "none";
  if (requested === "none") return "none";
  if (requested !== "synthetic") {
    throw new Error("MAPOS_COMMERCE_PROVIDER has no implemented real provider adapter");
  }
  if (nodeEnv === "production") {
    throw new Error("The synthetic commerce adapter is forbidden in production");
  }
  if (input.syntheticEnabled?.trim() !== "1") return "none";
  if ((input.syntheticSecret?.trim().length ?? 0) < 32) {
    throw new Error("MAPOS_SYNTHETIC_COMMERCE_SECRET must contain at least 32 characters");
  }
  return "synthetic";
}

export function resolveOperationsToken(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string | undefined {
  if (!value?.trim()) return undefined;
  const token = value.trim();
  const minimum = nodeEnv === "production" ? 32 : 16;
  if (token.length < minimum || token.length > 512 || /\s/.test(token)) {
    throw new Error(`MAPOS_OPERATIONS_TOKEN must be ${minimum}–512 non-whitespace characters`);
  }
  return token;
}

export function resolveRateLimitSecret(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string {
  const secret = value?.trim();
  if (!secret) {
    if (nodeEnv === "production") {
      throw new Error("MAPOS_RATE_LIMIT_SECRET is required in production");
    }
    return "local-development-rate-limit-secret";
  }
  if (secret.length < 32 || secret.length > 512 || /\s/.test(secret)) {
    throw new Error("MAPOS_RATE_LIMIT_SECRET must be 32–512 non-whitespace characters");
  }
  return secret;
}

/** Explicit origin allowlist used with credentialed CORS. An empty production list is valid:
 * same-origin browser requests do not need CORS headers at all. */
export function resolveCorsOrigins(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string[] {
  if (!value?.trim()) return nodeEnv === "production" ? [] : [...DEV_CORS_ORIGINS];
  return [
    ...new Set(
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map(normalizeHttpOrigin)
    )
  ];
}

/** Address/CIDR based trust only. Numeric hop counts are intentionally rejected because a route
 * reachable through fewer proxies could otherwise accept a client-supplied X-Forwarded-For. */
export function resolveTrustedProxies(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV
): string | false {
  if (!value?.trim()) {
    return nodeEnv === "production" ? "loopback,linklocal,uniquelocal" : false;
  }
  const normalized = value.trim();
  if (normalized === "false" || normalized === "none") return false;
  if (normalized === "true" || normalized === "*" || /^\d+$/.test(normalized)) {
    throw new Error(
      "MAPOS_TRUSTED_PROXIES must list trusted addresses/CIDRs, not hops or wildcard"
    );
  }
  return normalized;
}

export const config = {
  get corsOrigins() {
    return resolveCorsOrigins(env("MAPOS_CORS_ORIGINS"));
  },
  get trustedProxies() {
    return resolveTrustedProxies(env("MAPOS_TRUSTED_PROXIES"));
  },
  get prototypeStakingEnabled() {
    return env("MAPOS_PROTOTYPE_STAKING_ENABLED") === "1";
  },
  /** A configured provider key alone must never opt the deployment into outbound model calls. */
  get aiGatewayEnabled() {
    return env("MAPOS_AI_GATEWAY_ENABLED") === "1";
  },
  get siweEnabled() {
    return env("MAPOS_SIWE_ENABLED") === "1";
  },
  get siweOrigin() {
    return resolveSiweOrigin(env("MAPOS_PUBLIC_ORIGIN"), this.siweEnabled);
  },
  get siweChainIds() {
    return resolveSiweChainIds(env("MAPOS_SIWE_CHAIN_IDS"));
  },
  get ensRpcUrl() {
    return resolveEnsRpcUrl(env("MAPOS_ENS_RPC_URL"));
  },
  get operationsToken() {
    return resolveOperationsToken(env("MAPOS_OPERATIONS_TOKEN"));
  },
  get rateLimitSecret() {
    return resolveRateLimitSecret(env("MAPOS_RATE_LIMIT_SECRET"));
  },
  /** Simulation needs two explicit production gates and remains visibly labeled in responses. */
  get identitySimulationEnabled() {
    if (env("MAPOS_IDENTITY_SIMULATION_ENABLED") !== "1") return false;
    return (
      process.env.NODE_ENV !== "production" || env("MAPOS_ALLOW_PRODUCTION_SIMULATION") === "1"
    );
  },
  get commerceProvider(): CommerceProvider {
    return resolveCommerceProvider({
      enabled: env("MAPOS_COMMERCE_ENABLED"),
      provider: env("MAPOS_COMMERCE_PROVIDER"),
      syntheticEnabled: env("MAPOS_SYNTHETIC_COMMERCE_ENABLED"),
      syntheticSecret: env("MAPOS_SYNTHETIC_COMMERCE_SECRET")
    });
  },
  get commerceSyntheticSecret() {
    return this.commerceProvider === "synthetic"
      ? env("MAPOS_SYNTHETIC_COMMERCE_SECRET")
      : undefined;
  },
  get mapyKey() {
    return env("MAPY_API_KEY");
  },
  get owmKey() {
    return env("OWM_API_KEY");
  },
  get windyKey() {
    return env("WINDY_API_KEY");
  },
  get fsqKey() {
    return env("FSQ_API_KEY");
  },
  /** BRouter answers the "Dobrodružná" preference (§16.6). Keyless and self-hostable, so the
   *  base URL is configurable: a busy public instance is a reason to run your own, not to lose
   *  the feature. */
  get brouterBaseUrl() {
    return env("BROUTER_BASE_URL") ?? "https://brouter.de/brouter";
  },
  get openaiKey() {
    return env("OPENAI_API_KEY");
  },
  get openaiModel() {
    return env("OPENAI_MODEL") ?? "gpt-4o-mini";
  },
  get ollamaKey() {
    return env("OLLAMA_API_KEY");
  },
  get ollamaBaseUrl() {
    return env("OLLAMA_BASE_URL") ?? "https://ollama.com/v1";
  },
  get ollamaModel() {
    // Ollama Cloud retires models on a few months' notice — v3.1 went in July 2026 and every
    // call started answering 410. `GET /v1/models` lists what the account can currently reach.
    return env("OLLAMA_MODEL") ?? "deepseek-v4-flash:0731";
  },
  /** Two slots rather than one model (§30.2): the intent router and the tool loop run dozens of
   *  short calls where latency is the whole experience, while a multi-day plan is one slow call
   *  that has to be right. `OLLAMA_MODEL` stays the alias for the fast slot. */
  get ollamaModelFast() {
    return env("OLLAMA_MODEL_FAST") ?? env("OLLAMA_MODEL") ?? "glm-5.3-flash";
  },
  get ollamaModelStrong() {
    return env("OLLAMA_MODEL_STRONG") ?? "deepseek-v4-pro:0813";
  },
  /** Web search and fetch are our tools, not a model feature: the same Ollama key reaches
   *  `ollama.com/api/web_search`, and without a key the tools are simply not offered. */
  get ollamaWebToolsEnabled() {
    return this.aiGatewayEnabled && Boolean(this.ollamaKey);
  },
  /** The provider CML should use, downgraded to "none" when its key is missing so callers
   *  never have to re-check the key alongside the provider name. */
  get cmlProvider(): CmlProvider {
    const requested = env("CML_PROVIDER") ?? "ollama";
    if (requested === "openai") return this.openaiKey ? "openai" : "none";
    if (requested === "none") return "none";
    return this.ollamaKey ? "ollama" : "none";
  },
  /**
   * Keys for layers that need free registration. Every one of these is optional: without it the
   * layer is hidden rather than shown broken. `docs/data-sources.md` lists where to sign up.
   */
  get layerKeys(): Record<string, string | undefined> {
    return {
      ocm: env("OPENCHARGEMAP_API_KEY"),
      mapillary: env("MAPILLARY_ACCESS_TOKEN"),
      firms: env("NASA_FIRMS_MAP_KEY"),
      openaq: env("OPENAQ_API_KEY"),
      ebird: env("EBIRD_API_TOKEN"),
      ticketmaster: env("TICKETMASTER_API_KEY"),
      opentripmap: env("OPENTRIPMAP_API_KEY")
    };
  },
  /**
   * Keys for basemap tile providers. Every one of these has a free tier; without the key the
   * background simply isn't offered in the picker. See `docs/basemaps.md` for where to sign up
   * and which of them ask for a credit card.
   */
  get tileKeys(): Record<string, string | undefined> {
    return {
      google: env("GOOGLE_MAPS_API_KEY"),
      here: env("HERE_API_KEY"),
      maptiler: env("MAPTILER_API_KEY"),
      thunderforest: env("THUNDERFOREST_API_KEY"),
      stadia: env("STADIA_API_KEY"),
      tomtom: env("TOMTOM_API_KEY"),
      geoapify: env("GEOAPIFY_API_KEY")
    };
  },
  /**
   * Opencaching keys, one per national OKAPI instance — the network is federated, so there is
   * no single key that covers Europe. A deployment with none simply has no cache quests.
   */
  get okapiInstances(): Array<{ code: string; host: string; key: string }> {
    const instances = [
      { code: "pl", host: "opencaching.pl", envKey: "OKAPI_KEY_PL" },
      // The German instance shares its database with the Italian and French ones.
      { code: "de", host: "www.opencaching.de", envKey: "OKAPI_KEY_DE" },
      { code: "nl", host: "www.opencaching.nl", envKey: "OKAPI_KEY_NL" },
      { code: "us", host: "www.opencaching.us", envKey: "OKAPI_KEY_US" },
      { code: "uk", host: "opencache.uk", envKey: "OKAPI_KEY_UK" }
    ];
    return instances.flatMap(({ code, host, envKey }) => {
      const key = env(envKey);
      return key ? [{ code, host, key }] : [];
    });
  },
  /** Prototype operator switch. Rights metadata is advisory and does not alter capabilities. */
  get park4nightEnabled() {
    return env("PARK4NIGHT_ENABLED") === "1";
  },
  get contact() {
    return env("MAPOS_CONTACT");
  },
  /** Nominatim, Overpass and the Wikimedia APIs all require a User-Agent identifying the
   *  deployment, and block generic ones. A fork must be able to put its own contact here —
   *  otherwise its traffic gets attributed to (and rate-limited with) whoever it forked from. */
  get userAgent() {
    const contact = this.contact;
    return contact ? `MapOS/3.0 (+${contact})` : "MapOS/3.0 (https://github.com/mapos/mapos)";
  }
};

export function advertisedCmlCapability(
  aiGatewayEnabled: boolean,
  cmlProvider: CmlProvider
): Pick<ServerCapabilities, "cml" | "cmlProvider"> {
  const cmlEnabled = aiGatewayEnabled && cmlProvider !== "none";
  return { cml: cmlEnabled, cmlProvider: cmlEnabled ? cmlProvider : "none" };
}

export function capabilities(): ServerCapabilities {
  const commerceProvider = config.commerceProvider;
  return {
    mapy: Boolean(config.mapyKey),
    siwe: config.siweEnabled,
    identitySimulation: config.identitySimulationEnabled,
    ens: Boolean(config.ensRpcUrl),
    // Contract/network evidence is current, but the official Base inventory indexer is gated.
    aavegotchiInventoryLive: false,
    commerceCore: true,
    commerce: commerceProvider !== "none",
    commerceCheckout: commerceProvider !== "none",
    // A key only configures a possible transport. The browser must not advertise generation
    // until the separate deployment gate has explicitly enabled outbound model calls.
    ...advertisedCmlCapability(config.aiGatewayEnabled, config.cmlProvider),
    owm: Boolean(config.owmKey),
    windy: Boolean(config.windyKey),
    fsq: Boolean(config.fsqKey),
    opencaching: config.okapiInstances.length > 0,
    park4night: config.park4nightEnabled,
    // Derived, so adding a keyed layer means adding its key to `layerKeys` and nothing else —
    // the flag the browser needs follows automatically.
    ...Object.fromEntries(
      Object.entries(config.layerKeys).map(([name, value]) => [name, Boolean(value)])
    ),
    // Basemap providers use the same pattern. "google" is spelled out because the key also
    // unlocks non-tile Google services one day, and a flag called `google` would over-promise.
    ...Object.fromEntries(
      Object.entries(config.tileKeys).map(([name, value]) => [
        name === "google" ? "googleTiles" : name,
        Boolean(value)
      ])
    )
  };
}
