import { createPublicClient, custom, getAddress, type Address } from "viem";
import { mainnet } from "viem/chains";
import { fetchJson, validateUpstreamUrl } from "../../utils/upstream.js";
import type { IdentityLink } from "./identityService.js";

export interface WalletDisplayMetadata {
  name: string;
  source: "ens";
  resolvedAt: string;
  expiresAt: string;
}

export interface WalletNameProvider {
  readonly id: "ens";
  resolve(address: Address): Promise<string | null>;
}

export interface WalletDisplayMetadataResolver {
  resolve(identity: IdentityLink): Promise<WalletDisplayMetadata | null>;
}

interface CacheEntry {
  value: WalletDisplayMetadata | null;
  expiresAtMs: number;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function cleanEnsName(value: string | null): string | null {
  const name = value?.trim() ?? "";
  if (!name || name.length > 255 || hasControlCharacter(name) || !name.includes(".")) {
    return null;
  }
  return name;
}

/**
 * Reverse-name enrichment is display-only. Both positive and negative results are cached so
 * opening a profile cannot turn into an unbounded RPC loop; provider failures fail closed.
 */
export class TtlWalletDisplayMetadataResolver implements WalletDisplayMetadataResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<WalletDisplayMetadata | null>>();

  constructor(
    private readonly provider: WalletNameProvider | null,
    private readonly options: {
      ttlMs?: number;
      maxEntries?: number;
      now?: () => Date;
    } = {}
  ) {}

  async resolve(identity: IdentityLink): Promise<WalletDisplayMetadata | null> {
    if (!this.provider || identity.type !== "wallet" || identity.simulated || identity.revokedAt) {
      return null;
    }
    let address: Address;
    try {
      address = getAddress(identity.subject);
    } catch {
      return null;
    }

    const now = (this.options.now ?? (() => new Date()))();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return null;
    const key = address.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAtMs > nowMs) return cached.value;
    const active = this.pending.get(key);
    if (active) return active;

    const lookup = this.lookup(address, now).finally(() => this.pending.delete(key));
    this.pending.set(key, lookup);
    return lookup;
  }

  private async lookup(address: Address, resolvedAt: Date): Promise<WalletDisplayMetadata | null> {
    const ttlMs = Math.min(24 * 60 * 60 * 1000, Math.max(60_000, this.options.ttlMs ?? 3_600_000));
    const maxEntries = Math.min(5_000, Math.max(1, this.options.maxEntries ?? 500));
    let name: string | null = null;
    try {
      name = cleanEnsName(await this.provider!.resolve(address));
    } catch {
      // Display enrichment must never break authentication or identity listing.
    }
    const expiresAtMs = resolvedAt.getTime() + ttlMs;
    const value: WalletDisplayMetadata | null = name
      ? {
          name,
          source: "ens",
          resolvedAt: resolvedAt.toISOString(),
          expiresAt: new Date(expiresAtMs).toISOString()
        }
      : null;
    if (this.cache.size >= maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(address.toLowerCase(), { value, expiresAtMs });
    return value;
  }
}

/** Explicitly configured Ethereum-mainnet ENS provider; there is no implicit public RPC. */
export class ViemEnsNameProvider implements WalletNameProvider {
  readonly id = "ens" as const;
  private readonly client;

  constructor(rpcUrl: string) {
    const safeRpcUrl = validateUpstreamUrl(rpcUrl).href;
    this.client = createPublicClient({
      chain: mainnet,
      transport: custom(
        {
          async request({ method, params }) {
            const response = await fetchJson<{
              jsonrpc?: string;
              id?: number | string | null;
              result?: unknown;
              error?: unknown;
            }>(safeRpcUrl, {
              providerId: "ens-rpc",
              method: "POST",
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
              headers: { "Content-Type": "application/json" },
              ttlMs: 0,
              timeoutMs: 3_000,
              retries: 0,
              maxResponseBytes: 512_000
            });
            if (!response || response.error !== undefined || !("result" in response)) {
              throw new Error("ENS RPC returned an invalid response");
            }
            return response.result;
          }
        },
        { retryCount: 0 }
      )
    });
  }

  resolve(address: Address): Promise<string | null> {
    return this.client.getEnsName({ address, strict: true });
  }
}
