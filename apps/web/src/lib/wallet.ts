/**
 * What the Peněženka section needs beyond linking a wallet: which address is connected, on which
 * network, and what it holds.
 *
 * All three come from the wallet the user already connected, not from an RPC endpoint of ours.
 * That is deliberate — the alternative is configuring a node URL and sending someone's address to
 * it on every panel open, which is a privacy cost and an operational dependency for information
 * the wallet is already holding.
 *
 * `WalletConnector` is the seam for Reown AppKit (§28.1, blocker 25). AppKit is not wired yet
 * because it cannot run without a `projectId`: `createAppKit` fails with APKT008 when one is
 * missing, and APKT002 when the origin is not on the dashboard allowlist. There is no
 * injected-only degradation inside AppKit to fall back to — an AppKit build without the key is
 * simply a build that throws. So the injected connector below is the whole of it for now, and
 * adding AppKit means adding a second `WalletConnector` plus the lazy import that only resolves
 * when `import.meta.env.VITE_REOWN_PROJECT_ID` is set.
 *
 * AppKit's SIWX contract is implemented client-side, so it needs no new endpoints: its
 * `getNonce` maps onto `/v2/auth/siwe/challenge`, `addSession` onto `/v2/auth/siwe/verify` and
 * `getSessions` onto `/v2/me/identities`. Standing up a parallel `/v2/identity/siwe/*` trio
 * would mean two independent ways to mint a session, which is a real risk for no gain.
 */

import { apiGet, apiSend } from "./api";
import {
  injectedEthereum,
  linkInjectedWallet,
  type InjectedEthereumProvider,
  type PublicIdentityLink
} from "./linkedIdentity";

export interface WalletConnector {
  id: string;
  label: string;
  /** Why this connector cannot be used here, or null when it can. */
  unavailableReason(): string | null;
  /** Runs the link flow and returns the identity the server recorded. */
  connect(): Promise<PublicIdentityLink>;
  /** The provider to read chain state through, once connected. */
  provider(): InjectedEthereumProvider | null;
}

export const injectedWalletConnector: WalletConnector = {
  id: "injected",
  label: "Rozšíření v prohlížeči",
  unavailableReason: () =>
    injectedEthereum(globalThis) ? null : "V prohlížeči není dostupná kompatibilní peněženka.",
  async connect() {
    const provider = injectedEthereum(globalThis);
    if (!provider) throw new Error("V prohlížeči není dostupná kompatibilní peněženka.");
    return linkInjectedWallet(provider);
  },
  provider: () => injectedEthereum(globalThis)
};

/** Every connector this build can offer. One today; AppKit joins it with a project ID. */
export function walletConnectors(): WalletConnector[] {
  return [injectedWalletConnector];
}

/** True when mobile wallets are reachable. Without the Reown project ID they are not, and the
 *  panel says so once rather than failing at the moment someone taps connect. */
export function mobileWalletsAvailable(
  env: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >
): boolean {
  return Boolean(env.VITE_REOWN_PROJECT_ID?.trim());
}

/** The chains the server accepts a SIWE signature for, named. An unrecognised id is shown as its
 *  number rather than guessed at — claiming the wrong network would be worse than admitting it. */
const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  10: "Optimism",
  137: "Polygon",
  42161: "Arbitrum One",
  11155111: "Sepolia"
};

export function networkName(chainId: number): string {
  return NETWORK_NAMES[chainId] ?? `Síť ${chainId}`;
}

export interface WalletChainState {
  chainId: number;
  networkName: string;
  /** Native balance in whole units, already scaled from wei. */
  balance: number;
  symbol: string;
}

/** Base and the L2s above all use ether as their native unit; only add a symbol here when a
 *  chain genuinely differs, because showing the wrong ticker next to a number is a real error. */
const NATIVE_SYMBOLS: Record<number, string> = { 137: "POL" };

function hexToBigInt(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) {
    throw new Error("Peněženka nevrátila platný zůstatek.");
  }
  return BigInt(value === "0x" ? "0x0" : value);
}

/**
 * Reads the connected wallet's network and native balance.
 *
 * Returns null rather than throwing when the wallet is locked or has no account authorised for
 * this site: that is the ordinary state of a page you opened without touching the extension, and
 * an error card would make it look broken.
 */
export async function readWalletChainState(
  provider: InjectedEthereumProvider,
  address: string
): Promise<WalletChainState | null> {
  try {
    // `eth_accounts`, unlike `eth_requestAccounts`, never opens a prompt — reading the panel
    // must not pop the wallet open on its own.
    const accounts = await provider.request({ method: "eth_accounts" });
    const authorised =
      Array.isArray(accounts) &&
      accounts.some(
        (entry) => typeof entry === "string" && entry.toLowerCase() === address.toLowerCase()
      );
    if (!authorised) return null;

    const rawChain = await provider.request({ method: "eth_chainId" });
    if (typeof rawChain !== "string") return null;
    const chainId = Number.parseInt(rawChain.slice(2), 16);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) return null;

    const rawBalance = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"]
    });
    const wei = hexToBigInt(rawBalance);
    // Scaled through an integer division first, so a large balance never loses its whole part to
    // floating point before it is rounded for display.
    const milli = wei / 10n ** 15n;
    return {
      chainId,
      networkName: networkName(chainId),
      balance: Number(milli) / 1_000,
      symbol: NATIVE_SYMBOLS[chainId] ?? "ETH"
    };
  } catch {
    return null;
  }
}

/** Wallet identities on this account, newest first, revoked ones dropped. */
export async function listWalletIdentities(): Promise<PublicIdentityLink[]> {
  const data = await apiGet<{ identities: PublicIdentityLink[] }>("/v2/me/identities", {
    auth: true
  });
  return data.identities
    .filter(
      (identity) =>
        !identity.revokedAt && (identity.type === "wallet" || identity.type === "simulated-wallet")
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function revokeWalletIdentity(id: string): Promise<void> {
  await apiSend("DELETE", `/v2/me/identities/${encodeURIComponent(id)}`);
}

/** Shortened for display. The middle of an address carries no information a person reads, but
 *  the ends are what they check against their wallet. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** The name to show for a linked wallet: its ENS name when the server resolved one, otherwise
 *  the shortened address. */
export function walletDisplayName(identity: PublicIdentityLink): string {
  return identity.displayMetadata?.name ?? shortAddress(identity.subject);
}
