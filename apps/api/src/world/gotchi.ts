import { optimizeGotchi } from "./gotchiOptimize.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createPublicClient, custom, parseAbi } from "viem";
import { base } from "viem/chains";
import { AAVEGOTCHI_BASE_DIAMOND } from "@mapos/layer-sdk";
import type { GotchiModel } from "@mapos/layer-sdk";
import type {
  AavegotchiInventoryAdapter,
  AavegotchiInventoryResult
} from "../services/identity/aavegotchiInventory.js";
import { AAVEGOTCHI_SOURCE_EVIDENCE } from "../services/identity/aavegotchiInventory.js";
import { ClientError } from "../utils/clientError.js";
import { fetchBytes, fetchJson, validateUpstreamUrl } from "../utils/upstream.js";

export const GOTCHI_DIAMOND = AAVEGOTCHI_BASE_DIAMOND;
export const GOTCHI_GRAPH =
  "https://api.goldsky.com/api/public/project_cmh3flagm0001r4p25foufjtt/subgraphs/aavegotchi-core-base/prod/gn";
const ORIGIN = "https://www.aavegotchi.com";
interface Gotchi {
  id: string;
  name?: string;
  collateral: string;
  hauntId: string;
  numericTraits: number[];
  equippedWearables: number[];
}
async function bounded(url: string, max = 10 * 1024 * 1024): Promise<Uint8Array> {
  const response = await fetchBytes(url, {
    providerId: "gotchi-assets",
    ttlMs: 0,
    timeoutMs: 15000,
    maxResponseBytes: max,
    acceptedContentTypes: ["model/gltf-binary", "application/octet-stream"]
  });
  return new Uint8Array(response.body);
}
async function json<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    providerId: url.startsWith(GOTCHI_GRAPH) ? "gotchi-indexer" : "gotchi-renderer",
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ttlMs: 0,
    timeoutMs: 15000,
    maxResponseBytes: 2 * 1024 * 1024
  });
}
export class LiveGotchiInventory implements AavegotchiInventoryAdapter {
  readonly id = "aavegotchi-base-live";
  private cache = new Map<string, { until: number; result: AavegotchiInventoryResult }>();
  async load(address: string): Promise<AavegotchiInventoryResult> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ClientError("Neplatná peněženka");
    address = address.toLowerCase();
    const cached = this.cache.get(address);
    if (cached && cached.until > Date.now()) return cached.result;
    try {
      const all: Gotchi[] = [];
      for (let skip = 0; skip <= 200; skip += 100) {
        const result = await json<{
          data?: {
            aavegotchis: Gotchi[];
            _meta: { hasIndexingErrors: boolean; block: { timestamp?: number } };
          };
          errors?: unknown;
        }>(GOTCHI_GRAPH, {
          query:
            "query($owner:String!,$skip:Int!){_meta{hasIndexingErrors block{timestamp}} aavegotchis(first:100,skip:$skip,where:{owner:$owner}){id name collateral hauntId numericTraits equippedWearables}}",
          variables: { owner: address, skip }
        });
        if (result.errors || !result.data || result.data._meta.hasIndexingErrors)
          throw new Error("Indexer unavailable");
        const time = result.data._meta.block.timestamp;
        if (!time || Date.now() / 1000 - time > 1800) throw new Error("Indexer stale");
        all.push(...result.data.aavegotchis);
        if (result.data.aavegotchis.length < 100) break;
        if (skip === 200) throw new Error("Inventory exceeds bounded page limit");
      }
      const result: AavegotchiInventoryResult = {
        status: "available",
        sourceMode: "live",
        address,
        chainId: 8453,
        items: all.map((g) => ({
          tokenId: g.id,
          name: g.name ?? null,
          wearableIds: g.equippedWearables.filter(Boolean).map(String),
          metadataSourceUrl: "https://www.aavegotchi.com"
        })),
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        notice: "Aavegotchi na Base · vlastnictví se ověřuje při výběru"
      };
      this.cache.set(address, { until: Date.now() + 60000, result });
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
      return result;
    } catch {
      return {
        status: "unavailable",
        sourceMode: "live",
        reason: "provider-error",
        notice: "Inventář Aavegotchi je dočasně nedostupný. Nejde o prázdnou peněženku.",
        retryable: true,
        evidence: AAVEGOTCHI_SOURCE_EVIDENCE
      };
    }
  }
}
export async function verifyGotchiOwner(addresses: string[], tokenId: string) {
  if (!/^\d{1,78}$/.test(tokenId) || !addresses.length)
    throw new ClientError("Připoj ověřenou peněženku", 403);
  const rpcUrl = validateUpstreamUrl(
    process.env.MAPOS_BASE_RPC_URL ?? "https://mainnet.base.org"
  ).href;
  const rpc = createPublicClient({
    chain: base,
    transport: custom(
      {
        async request({ method, params }) {
          const response = await fetchJson<{ result?: unknown; error?: unknown }>(rpcUrl, {
            providerId: "gotchi-base-rpc",
            method: "POST",
            ttlMs: 0,
            timeoutMs: 6000,
            retries: 0,
            maxResponseBytes: 512000,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
          });
          if (!response || response.error !== undefined || !("result" in response))
            throw new Error("Invalid Base RPC response");
          return response.result;
        }
      },
      { retryCount: 0 }
    )
  });
  let owner: string;
  try {
    owner = await rpc.readContract({
      address: GOTCHI_DIAMOND,
      abi: parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]),
      functionName: "ownerOf",
      args: [BigInt(tokenId)]
    });
  } catch {
    throw new ClientError("Vlastnictví na Base se nepodařilo ověřit", 503);
  }
  if (!addresses.some((a) => a.toLowerCase() === owner.toLowerCase()))
    throw new ClientError("Tento Aavegotchi nepatří připojené peněžence", 403);
}
/** Hash conventions follow the official aavegotchi-3d-render-skill (source attribution in docs). */
export function gotchiAppearance(g: Gotchi): string {
  const collateralMap: Record<string, string> = {
    "0x20d3922b4a1a8560e1ac99fba4fade0c849e2142": "Eth",
    "0x823cd4264c1b951c9209ad0deaea9988fe8429bf": "Aave",
    "0x1d2a0e5ec8e5bbdca5cb219e649b565d8e5c3360": "Aave",
    "0xe0b22e0037b130a9f56bbb537684e6fa18192341": "Dai",
    "0x27f8d03b3a2196956ed754badc28d73be8830a6e": "Dai",
    "0x1a13f4ca1d028320a707d99520abfefca3998b7f": "USDC",
    "0x9719d867a500ef117cc201206b8ab51e794d3f82": "USDC",
    "0x98ea609569bd25119707451ef982b90e3eb719cd": "Link",
    "0xdae5f1590db13e3b40423b5b5c5fbf175515910b": "USDT",
    "0x60d55f02a771d515e077c9c2403a1ef324885cec": "USDT",
    "0xf4b8888427b00d7caf21654408b7cba2ecf4ebd9": "TUSD",
    "0x8c8bdbe9cee455732525086264a4bf9cf821c498": "Uni",
    "0xe20f7d1f0ec39c4d5db01f53554f2ef54c71f613": "Yfi",
    "0x8df3aad3a84da6b69a4da8aec3ea40d9091b2ac4": "Polygon",
    "0x28424507fefb6f7f8e9d3860f56504e4e5f5f390": "wEth",
    "0x5c2ed810328349100a66b82b78a1791b101c9d61": "wBTC"
  };
  const collateral = collateralMap[g.collateral.toLowerCase()];
  if (!collateral) throw new Error("Unsupported collateral");
  const t = g.numericTraits[4]!,
    c = g.numericTraits[5]!;
  const ranges: [number, string][] = [
    [1, `MythicalLow${t === 0 ? 1 : 2}_H${Number(g.hauntId) === 1 ? 1 : 2}`],
    [4, "RareLow1"],
    [6, "RareLow2"],
    [9, "RareLow3"],
    [14, "UncommonLow1"],
    [19, "UncommonLow2"],
    [24, "UncommonLow3"],
    [41, "Common1"],
    [57, "Common2"],
    [74, "Common3"],
    [79, "UncommonHigh1"],
    [84, "UncommonHigh2"],
    [89, "UncommonHigh3"],
    [92, "RareHigh1"],
    [94, "RareHigh2"],
    [97, "RareHigh3"]
  ];
  const shape =
    ranges.find(([max]) => t <= max)?.[1] ??
    (
      {
        Eth: "ETH",
        Aave: "AAVE",
        Dai: "DAI",
        Link: "LINK",
        Polygon: "POLYGON",
        wEth: "wETH",
        wBTC: "wBTC",
        Yfi: "YFI",
        Uni: "UNI"
      } as Record<string, string>
    )[collateral] ??
    collateral;
  const color =
    c <= 1
      ? "Mythical_Low"
      : c <= 9
        ? "Rare_Low"
        : c <= 24
          ? "Uncommon_Low"
          : c <= 74
            ? "Common"
            : c <= 90
              ? "Uncommon_High"
              : c <= 97
                ? "Rare_High"
                : "Mythical_High";
  return [
    collateral,
    shape,
    color,
    ...Array.from({ length: 7 }, (_, i) => g.equippedWearables[i] ?? 0)
  ].join("-");
}
export class GotchiAssets {
  private status = new Map<string, GotchiModel>();
  private refreshed = new Map<string, number>();
  private running = 0;
  readonly directory = resolve(process.env.MAPOS_GOTCHI_CACHE_DIR ?? ".cache/mapos-gotchi");
  async defaultModel(): Promise<GotchiModel> {
    const current = this.status.get("100");
    if (current?.status === "ready") return current;
    try {
      const model = JSON.parse(
        await readFile(join(this.directory, "default-100.json"), "utf8")
      ) as GotchiModel;
      if (model.tokenId !== "100" || model.status !== "ready" || !model.url || !model.lods?.length)
        throw new Error("Invalid default");
      for (const url of [model.url, ...model.lods.map((l) => l.url)]) {
        const hash = url.match(/^\/api\/v2\/world\/models\/([a-f0-9]{64})\.glb$/)?.[1];
        if (!hash) throw new Error("Invalid default asset");
        await this.read(hash);
      }
      this.status.set("100", model);
      this.refreshed.set("100", Date.now());
      return model;
    } catch {
      return this.request("100");
    }
  }
  request(tokenId: string): GotchiModel {
    if (!/^\d{1,78}$/.test(tokenId)) throw new ClientError("Neplatný token");
    const old = this.status.get(tokenId);
    if (
      old &&
      (old.status === "pending" || Date.now() - (this.refreshed.get(tokenId) ?? 0) < 300000)
    )
      return old;
    this.refreshed.set(tokenId, Date.now());
    if (this.status.size > 500) {
      this.status.delete(this.status.keys().next().value!);
    }
    if (this.running >= 2)
      return {
        tokenId,
        status: "pending",
        notice: "Příprava modelů je vytížená. Zkus to za chvíli."
      };
    const result: GotchiModel = {
      tokenId,
      status: "pending",
      notice: "Připravuji skutečný 3D model a vybavení…"
    };
    this.status.set(tokenId, result);
    this.running++;
    void this.prepare(tokenId)
      .then((model) => this.status.set(tokenId, model))
      .catch(() =>
        this.status.set(tokenId, {
          tokenId,
          status: "unavailable",
          notice: "3D model není nyní dostupný od zdroje. Zobrazuje se dočasný průzkumník."
        })
      )
      .finally(() => {
        this.running--;
      });
    return result;
  }
  retry(tokenId: string) {
    if (this.status.get(tokenId)?.status !== "pending") this.status.delete(tokenId);
    return this.request(tokenId);
  }
  async read(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ClientError("Model nebyl nalezen", 404);
    return readFile(join(this.directory, `${hash}.glb`));
  }
  private async prepare(tokenId: string): Promise<GotchiModel> {
    // The fixed guest appearance is immutable and can start from the operator-warmed cache.
    if (tokenId === "100") {
      try {
        const model = JSON.parse(
          await readFile(join(this.directory, "default-100.json"), "utf8")
        ) as GotchiModel;
        if (
          model.tokenId === "100" &&
          model.status === "ready" &&
          model.url &&
          model.lods?.length
        ) {
          for (const lod of model.lods) {
            const hash = lod.url.match(/\/([a-f0-9]{64})\.glb$/)?.[1];
            if (!hash) throw new Error("Invalid default model cache");
            await this.read(hash);
          }
          return model;
        }
      } catch {
        /* Cold install: resolve and prepare from the original source. */
      }
    }
    const graph = await json<{ data?: { aavegotchis: Gotchi[] } }>(GOTCHI_GRAPH, {
      query:
        "query($id:String!){aavegotchis(where:{id:$id}){id collateral hauntId numericTraits equippedWearables}}",
      variables: { id: tokenId }
    });
    const gotchi = graph.data?.aavegotchis[0];
    if (!gotchi) throw new Error("Gotchi unavailable");
    const appearanceHash = gotchiAppearance(gotchi),
      rawHash = createHash("sha256").update(appearanceHash).digest("hex"),
      hash = createHash("sha256").update(`mapos-3d-v1:${appearanceHash}`).digest("hex");
    const ready: GotchiModel = {
      tokenId,
      status: "ready",
      notice: "3D Aavegotchi · vybavení podle Base",
      appearanceHash,
      url: `/api/v2/world/models/${hash}.glb`
    };
    try {
      return JSON.parse(
        await readFile(join(this.directory, `${hash}.json`), "utf8")
      ) as GotchiModel;
    } catch {
      /* cache miss */
    }
    const save = async (bytes: Uint8Array) => {
      const optimized = await optimizeGotchi(bytes);
      await mkdir(this.directory, { recursive: true });
      const lods: NonNullable<GotchiModel["lods"]> = [];
      for (const level of ["high", "low"] as const) {
        const variant = optimized[level],
          key =
            level === "high"
              ? hash
              : createHash("sha256").update(`mapos-3d-v1-low:${appearanceHash}`).digest("hex"),
          file = join(this.directory, `${key}.glb`);
        await writeFile(file + ".tmp", variant.data);
        await rename(file + ".tmp", file);
        const { data: _data, ...metrics } = variant;
        lods.push({ level, url: `/api/v2/world/models/${key}.glb`, ...metrics });
      }
      const model = { ...ready, lods };
      await writeFile(join(this.directory, `${hash}.json`), JSON.stringify(model));
      if (tokenId === "100")
        await writeFile(join(this.directory, "default-100.json"), JSON.stringify(model));
      return model;
    };
    try {
      const raw = await this.read(rawHash);
      return await save(raw);
    } catch {
      /* download when no original is cached */
    }
    const types = ["GLB_3DModel"];
    // Existing models must remain usable when the asynchronous generation service is down.
    let requested = false;
    for (let i = 0; i < 18; i++) {
      const result = await json<{
        data?: {
          results?: {
            availability?: Record<string, { exists?: boolean }>;
            proxyUrls?: Record<string, string>;
          }[];
        };
      }>(ORIGIN + "/api/renderer/batch", {
        hashes: [appearanceHash],
        renderTypes: types,
        verify: true
      });
      const item = result.data?.results?.[0],
        path = item?.proxyUrls?.GLB_3DModel;
      if (item?.availability?.GLB_3DModel?.exists && path) {
        const url = new URL(path, ORIGIN);
        if (url.origin !== ORIGIN) throw new Error("Unexpected asset origin");
        const bytes = await bounded(url.toString(), 10 * 1024 * 1024);
        if (Buffer.from(bytes.subarray(0, 4)).toString() !== "glTF") throw new Error("Invalid GLB");
        await mkdir(this.directory, { recursive: true });
        const file = join(this.directory, `${rawHash}.glb`);
        await writeFile(file + ".tmp", bytes);
        await rename(file + ".tmp", file);
        return save(bytes);
      }
      if (!requested) {
        requested = true;
        await json(ORIGIN + "/api/renderer/batch", {
          hashes: [appearanceHash],
          renderTypes: types,
          force: true,
          verify: false
        });
      }
      await new Promise((r) => setTimeout(r, 10000));
    }
    throw new Error("Renderer timed out");
  }
}
