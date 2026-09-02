import { apiPost } from "./api";

export interface InjectedEthereumProvider {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export interface PublicIdentityLink {
  id: string;
  type: "email" | "wallet" | "passkey" | "oauth" | "simulated-wallet";
  provider: string;
  subject: string;
  displayLabel: string | null;
  simulated: boolean;
  verifiedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  displayMetadata?: {
    name: string;
    source: "ens";
    resolvedAt: string;
    expiresAt: string;
  } | null;
}

export interface PublicAavegotchiInventory {
  status: "available" | "unavailable";
  sourceMode: "live" | "simulation" | "disabled";
  notice: string;
  items?: Array<{ tokenId: string; name: string | null; wearableIds: string[] }>;
  reason?: string;
}

type PostTransport = <T>(path: string, body?: unknown) => Promise<T>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function firstAddress(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !ADDRESS.test(value[0])) {
    throw new Error("Peněženka nevrátila platnou adresu.");
  }
  return value[0];
}

function chainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("Peněženka nevrátila platnou síť.");
  }
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Neplatná síť peněženky.");
  return parsed;
}

/** The wallet signs only the exact server challenge; no client-authored authorization text. */
export async function linkInjectedWallet(
  provider: InjectedEthereumProvider,
  post: PostTransport = apiPost
): Promise<PublicIdentityLink> {
  const address = firstAddress(await provider.request({ method: "eth_requestAccounts" }));
  const network = chainId(await provider.request({ method: "eth_chainId" }));
  const challengeResponse = await post<{
    challenge: { id: string; message: string; address: string; chainId: number };
  }>("/v2/auth/siwe/challenge", { address, chainId: network });
  const challenge = challengeResponse.challenge;
  if (
    !challenge ||
    typeof challenge.id !== "string" ||
    typeof challenge.message !== "string" ||
    challenge.address.toLowerCase() !== address.toLowerCase() ||
    challenge.chainId !== network
  ) {
    throw new Error("Server vrátil neplatnou výzvu k podpisu.");
  }
  const signature = await provider.request({
    method: "personal_sign",
    params: [challenge.message, address]
  });
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) {
    throw new Error("Peněženka nevrátila platný podpis.");
  }
  const verified = await post<{ identity: PublicIdentityLink }>("/v2/auth/siwe/verify", {
    challengeId: challenge.id,
    message: challenge.message,
    signature
  });
  if (!verified.identity || verified.identity.type !== "wallet" || verified.identity.simulated) {
    throw new Error("Server nepotvrdil připojení peněženky.");
  }
  return verified.identity;
}

export function injectedEthereum(windowValue: unknown): InjectedEthereumProvider | null {
  const candidate = windowValue as { ethereum?: { request?: unknown } } | null;
  return candidate?.ethereum && typeof candidate.ethereum.request === "function"
    ? (candidate.ethereum as InjectedEthereumProvider)
    : null;
}
