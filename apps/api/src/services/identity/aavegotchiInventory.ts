export interface AavegotchiSourceEvidence {
  verifiedAt: string;
  network: "base";
  chainId: 8453;
  diamondAddress: string;
  contractSourceUrl: string;
  networkSourceUrl: string;
  indexerSourceUrl: string | null;
  indexerEndpoint: string | null;
  status: "contract-verified-indexer-gated";
}

/**
 * Verified against official primary sources on 2026-09-01. This is evidence, not an eternal
 * assumption: the live adapter must refuse to start once its review window expires or while an
 * official Base inventory endpoint is unresolved.
 */
export const AAVEGOTCHI_SOURCE_EVIDENCE: AavegotchiSourceEvidence = Object.freeze({
  verifiedAt: "2026-09-01T00:00:00.000Z",
  network: "base",
  chainId: 8453,
  diamondAddress: "0xa99c4b08201f2913db8d28e71d020c4298f29dbf",
  contractSourceUrl: "https://github.com/aavegotchi/deployed-contract-addresses",
  networkSourceUrl: "https://docs.base.org/get-started/connect-to-base",
  indexerSourceUrl: "https://github.com/aavegotchi/aavegotchi-core-subgraph",
  indexerEndpoint: null,
  status: "contract-verified-indexer-gated"
});

export interface AavegotchiInventoryItem {
  tokenId: string;
  name: string | null;
  wearableIds: string[];
  metadataSourceUrl: string | null;
}

export type AavegotchiInventoryResult =
  | {
      status: "available";
      sourceMode: "live" | "simulation";
      address: string;
      chainId: number | null;
      items: AavegotchiInventoryItem[];
      fetchedAt: string;
      expiresAt: string;
      notice: string;
    }
  | {
      status: "unavailable";
      sourceMode: "disabled" | "live";
      reason:
        | "provider-disabled"
        | "source-review-expired"
        | "official-indexer-required"
        | "provider-error";
      notice: string;
      retryable: boolean;
      evidence: AavegotchiSourceEvidence;
    };

export interface AavegotchiInventoryAdapter {
  readonly id: string;
  load(address: string, signal?: AbortSignal): Promise<AavegotchiInventoryResult>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_ITEMS = 250;

function normalizeAddress(value: string): string {
  const clean = value.trim();
  if (!ADDRESS.test(clean)) throw new TypeError("Invalid inventory wallet address");
  return clean.toLowerCase();
}

function cleanItems(items: readonly AavegotchiInventoryItem[]): AavegotchiInventoryItem[] {
  if (items.length > MAX_ITEMS) throw new TypeError("Simulation inventory exceeds its item budget");
  const ids = new Set<string>();
  return items.map((item) => {
    const tokenId = item.tokenId.trim();
    if (!/^\d{1,78}$/.test(tokenId) || ids.has(tokenId)) {
      throw new TypeError("Invalid or duplicate inventory token id");
    }
    ids.add(tokenId);
    const name = item.name?.trim().slice(0, 120) || null;
    const wearableIds = [...new Set(item.wearableIds)].map(String).slice(0, 64);
    if (wearableIds.some((id) => !/^\d{1,78}$/.test(id))) {
      throw new TypeError("Invalid wearable id");
    }
    let metadataSourceUrl: string | null = null;
    if (item.metadataSourceUrl) {
      const parsed = new URL(item.metadataSourceUrl);
      if (parsed.protocol !== "https:") throw new TypeError("Inventory metadata must use HTTPS");
      metadataSourceUrl = parsed.toString();
    }
    return { tokenId, name, wearableIds, metadataSourceUrl };
  });
}

/** Production-safe default until GATE-007 has a current official Base inventory endpoint. */
export class GatedAavegotchiInventoryAdapter implements AavegotchiInventoryAdapter {
  readonly id = "aavegotchi-official-gated";

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly evidence: AavegotchiSourceEvidence = AAVEGOTCHI_SOURCE_EVIDENCE
  ) {}

  async load(address: string, signal?: AbortSignal): Promise<AavegotchiInventoryResult> {
    normalizeAddress(address);
    if (signal?.aborted) throw signal.reason;
    const reviewedAt = Date.parse(this.evidence.verifiedAt);
    const reviewExpired = this.now().getTime() - reviewedAt > 90 * 86_400_000;
    if (reviewExpired) {
      return {
        status: "unavailable",
        sourceMode: "disabled",
        reason: "source-review-expired",
        notice: "Zdroj Aavegotchi vyžaduje nové ověření před živým načtením.",
        retryable: false,
        evidence: structuredClone(this.evidence)
      };
    }
    return {
      status: "unavailable",
      sourceMode: "disabled",
      reason: this.evidence.indexerEndpoint ? "provider-disabled" : "official-indexer-required",
      notice: this.evidence.indexerEndpoint
        ? "Živý Aavegotchi provider není v tomto nasazení zapnutý."
        : "Oficiální Base inventory endpoint zatím není doložen; žádné vlastnictví se nepředstírá.",
      retryable: false,
      evidence: structuredClone(this.evidence)
    };
  }
}

/** Explicit test adapter. The caller owns the fixture and must present its simulation badge. */
export class SimulatedAavegotchiInventoryAdapter implements AavegotchiInventoryAdapter {
  readonly id = "aavegotchi-simulation";
  private readonly items: AavegotchiInventoryItem[];

  constructor(
    items: readonly AavegotchiInventoryItem[],
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date()
  ) {
    this.items = cleanItems(items);
  }

  async load(address: string, signal?: AbortSignal): Promise<AavegotchiInventoryResult> {
    const normalized = normalizeAddress(address);
    if (signal?.aborted) throw signal.reason;
    if (!this.enabled) {
      return {
        status: "unavailable",
        sourceMode: "disabled",
        reason: "provider-disabled",
        notice: "Testovací inventory je vypnutý.",
        retryable: false,
        evidence: structuredClone(AAVEGOTCHI_SOURCE_EVIDENCE)
      };
    }
    const fetchedAt = this.now();
    return {
      status: "available",
      sourceMode: "simulation",
      address: normalized,
      chainId: null,
      items: structuredClone(this.items),
      fetchedAt: fetchedAt.toISOString(),
      expiresAt: new Date(fetchedAt.getTime() + 5 * 60_000).toISOString(),
      notice: "Testovací data — nejde o tvrzení aktuálního on-chain vlastnictví."
    };
  }
}
