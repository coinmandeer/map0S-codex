import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { AAVEGOTCHI_DIAMOND } from "./aavegotchiConfig";
import {
  BrowserProviderBackoff,
  BrowserProviderHealth,
  browserProviderBackoff,
  browserProviderHealth
} from "../../../tasks/BrowserProviderHealth";

const abi = [
  {
    inputs: [{ name: "_tokenId", type: "uint256" }],
    name: "getAavegotchiSvg",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

// Public RPCs occasionally stall or retry for tens of seconds. Artwork is optional and the
// player has an immediate local fallback, so a short single attempt keeps avatar switching
// responsive even when Base is unreachable.
const client = createPublicClient({
  chain: base,
  transport: http(undefined, { timeout: 3_000, retryCount: 0 })
});

type AavegotchiSvgReader = (tokenId: bigint) => Promise<unknown>;

export async function fetchAavegotchiSvgWithReader(
  tokenId: string,
  reader: AavegotchiSvgReader,
  backoff: BrowserProviderBackoff = browserProviderBackoff,
  health: BrowserProviderHealth = browserProviderHealth
): Promise<string | null> {
  let numericTokenId: bigint;
  try {
    numericTokenId = BigInt(tokenId);
  } catch {
    return null;
  }

  if (!backoff.tryAcquire("base-rpc-browser")) {
    health.record({ providerId: "base-rpc-browser", outcome: "circuit-open", durationMs: 0 });
    return null;
  }
  const startedAt = performance.now();
  try {
    const svg = await reader(numericTokenId);
    backoff.success("base-rpc-browser");
    health.record({
      providerId: "base-rpc-browser",
      outcome: "success",
      durationMs: performance.now() - startedAt
    });
    return typeof svg === "string" && svg.length > 10 ? svg : null;
  } catch {
    backoff.failure("base-rpc-browser");
    health.record({
      providerId: "base-rpc-browser",
      outcome: "error",
      durationMs: performance.now() - startedAt
    });
    return null;
  }
}

export function fetchAavegotchiSvg(tokenId: string): Promise<string | null> {
  return fetchAavegotchiSvgWithReader(tokenId, (numericTokenId) =>
    client.readContract({
      address: AAVEGOTCHI_DIAMOND,
      abi,
      functionName: "getAavegotchiSvg",
      args: [numericTokenId]
    })
  );
}
