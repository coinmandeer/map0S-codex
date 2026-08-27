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

/** Narrows the SDK's `cmlProvider: string` to the providers this build actually implements. */
export interface ServerCapabilities extends SdkCapabilities {
  cmlProvider: CmlProvider;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const config = {
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
    return env("OLLAMA_MODEL") ?? "deepseek-v3.1:671b";
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
      ticketmaster: env("TICKETMASTER_API_KEY")
    };
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

export function capabilities(): ServerCapabilities {
  const cmlProvider = config.cmlProvider;
  return {
    mapy: Boolean(config.mapyKey),
    cml: cmlProvider !== "none",
    cmlProvider,
    owm: Boolean(config.owmKey),
    windy: Boolean(config.windyKey),
    fsq: Boolean(config.fsqKey),
    // Derived, so adding a keyed layer means adding its key to `layerKeys` and nothing else —
    // the flag the browser needs follows automatically.
    ...Object.fromEntries(
      Object.entries(config.layerKeys).map(([name, value]) => [name, Boolean(value)])
    )
  };
}
