import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress } from "viem";

export type IdentityLinkType = "email" | "wallet" | "passkey" | "oauth" | "simulated-wallet";

export interface IdentityLink {
  id: string;
  userId: string;
  type: IdentityLinkType;
  provider: string;
  subject: string;
  displayLabel: string | null;
  simulated: boolean;
  verifiedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface IdentityAuditEvent {
  id: string;
  userId: string;
  identityId: string | null;
  action: "challenge-created" | "identity-linked" | "identity-revoked";
  provider: string;
  createdAt: string;
}

export interface SiweChallenge {
  id: string;
  userId: string;
  sessionId: string;
  address: string;
  chainId: number;
  domain: string;
  uri: string;
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface IdentityRepository {
  createChallenge(challenge: SiweChallenge, audit: IdentityAuditEvent): Promise<void>;
  getChallengeForOwner(userId: string, challengeId: string): Promise<SiweChallenge | null>;
  /** Must atomically consume an unused challenge and create/reactivate the unique identity. */
  consumeChallengeAndLink(
    challengeId: string,
    usedAt: string,
    link: IdentityLink,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink>;
  linkSimulated(link: IdentityLink, audit: IdentityAuditEvent): Promise<IdentityLink>;
  listForOwner(userId: string): Promise<IdentityLink[]>;
  revokeForOwner(
    userId: string,
    identityId: string,
    revokedAt: string,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink | null>;
}

export interface SiweSignatureVerifier {
  readonly id: string;
  verify(input: {
    address: string;
    chainId: number;
    message: string;
    signature: string;
  }): Promise<boolean>;
}

export interface IdentityServiceOptions {
  domain: string;
  uri: string;
  allowedChainIds: ReadonlySet<number>;
  challengeTtlMs?: number;
  siweEnabled?: boolean;
  simulationEnabled?: boolean;
  now?: () => Date;
  createId?: () => string;
  createNonce?: () => string;
}

export class IdentityNotFoundError extends Error {
  readonly name = "IdentityNotFoundError";
}

export class IdentityConflictError extends Error {
  readonly name = "IdentityConflictError";
}

export class IdentityVerificationError extends Error {
  readonly name = "IdentityVerificationError";
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130,}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = 10 * 60 * 1000;

function cleanId(value: string, label: string): string {
  const clean = value.trim();
  if (!IDENTIFIER.test(clean)) throw new TypeError(`Invalid ${label}`);
  return clean;
}

function normalizeAddress(value: string): string {
  const clean = value.trim();
  if (!ADDRESS.test(clean)) throw new TypeError("Invalid Ethereum address");
  try {
    return getAddress(clean);
  } catch {
    throw new TypeError("Invalid Ethereum address checksum");
  }
}

function cleanSignature(value: string): string {
  const clean = value.trim();
  if (!SIGNATURE.test(clean) || clean.length > 16_384) {
    throw new TypeError("Invalid wallet signature");
  }
  return clean;
}

function validateOrigin(domain: string, uri: string): { domain: string; uri: string } {
  const cleanDomain = domain.trim().toLowerCase();
  if (!cleanDomain || cleanDomain.includes("/") || cleanDomain.includes("@")) {
    throw new TypeError("Invalid SIWE domain");
  }
  const parsed = new URL(uri);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new TypeError("SIWE URI must use HTTPS outside localhost");
  }
  if (parsed.host.toLowerCase() !== cleanDomain) {
    throw new TypeError("SIWE domain and URI origin do not match");
  }
  parsed.hash = "";
  return { domain: cleanDomain, uri: parsed.toString() };
}

function siweMessage(
  input: Pick<
    SiweChallenge,
    "domain" | "address" | "uri" | "chainId" | "nonce" | "issuedAt" | "expiresAt"
  >
) {
  return `${input.domain} wants you to sign in with your Ethereum account:\n${input.address}\n\nSign in to MapOS and link this wallet to your current account.\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class LinkedIdentityService {
  private readonly domain: string;
  private readonly uri: string;
  private readonly allowedChainIds: ReadonlySet<number>;
  private readonly challengeTtlMs: number;
  private readonly siweEnabled: boolean;
  private readonly simulationEnabled: boolean;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly createNonce: () => string;

  constructor(
    private readonly repository: IdentityRepository,
    private readonly verifier: SiweSignatureVerifier,
    options: IdentityServiceOptions
  ) {
    const origin = validateOrigin(options.domain, options.uri);
    if (!options.allowedChainIds.size) throw new TypeError("At least one SIWE chain is required");
    this.domain = origin.domain;
    this.uri = origin.uri;
    this.allowedChainIds = new Set(options.allowedChainIds);
    this.challengeTtlMs = Math.min(
      MAX_CHALLENGE_TTL_MS,
      Math.max(30_000, options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS)
    );
    this.siweEnabled = options.siweEnabled === true;
    this.simulationEnabled = options.simulationEnabled === true;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.createNonce = options.createNonce ?? (() => randomBytes(16).toString("hex"));
  }

  async createChallenge(input: {
    userId: string;
    sessionId: string;
    address: string;
    chainId: number;
  }): Promise<SiweChallenge> {
    if (!this.siweEnabled) throw new IdentityNotFoundError("SIWE identity provider is disabled");
    const userId = cleanId(input.userId, "user id");
    const sessionId = cleanId(input.sessionId, "session id");
    const address = normalizeAddress(input.address);
    if (!Number.isSafeInteger(input.chainId) || !this.allowedChainIds.has(input.chainId)) {
      throw new IdentityVerificationError("Wallet chain is not allowed");
    }
    const now = this.now();
    if (Number.isNaN(now.getTime())) throw new TypeError("Invalid identity clock");
    const nonce = this.createNonce();
    if (!/^[A-Za-z0-9]{8,96}$/.test(nonce)) throw new TypeError("Invalid SIWE nonce generator");
    const base = {
      address,
      chainId: input.chainId,
      domain: this.domain,
      uri: this.uri,
      nonce,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.challengeTtlMs).toISOString()
    };
    const challenge: SiweChallenge = {
      id: cleanId(this.createId(), "challenge id"),
      userId,
      sessionId,
      ...base,
      message: siweMessage(base),
      usedAt: null
    };
    await this.repository.createChallenge(
      challenge,
      this.audit(userId, null, "challenge-created", "siwe", now)
    );
    return clone(challenge);
  }

  async verifyAndLink(input: {
    userId: string;
    sessionId: string;
    challengeId: string;
    message: string;
    signature: string;
  }): Promise<IdentityLink> {
    if (!this.siweEnabled) throw new IdentityNotFoundError("SIWE identity provider is disabled");
    const userId = cleanId(input.userId, "user id");
    const challenge = await this.repository.getChallengeForOwner(
      userId,
      cleanId(input.challengeId, "challenge id")
    );
    if (!challenge || challenge.sessionId !== cleanId(input.sessionId, "session id")) {
      throw new IdentityNotFoundError("SIWE challenge not found");
    }
    const now = this.now();
    if (challenge.usedAt || now.getTime() >= Date.parse(challenge.expiresAt)) {
      throw new IdentityVerificationError("SIWE challenge is expired or already used");
    }
    if (input.message !== challenge.message) {
      throw new IdentityVerificationError("Signed SIWE message does not match the challenge");
    }
    const signature = cleanSignature(input.signature);
    if (
      !(await this.verifier.verify({
        address: challenge.address,
        chainId: challenge.chainId,
        message: challenge.message,
        signature
      }))
    ) {
      throw new IdentityVerificationError("Wallet signature could not be verified");
    }

    const link: IdentityLink = {
      id: cleanId(this.createId(), "identity id"),
      userId,
      type: "wallet",
      provider: "siwe",
      subject: challenge.address.toLowerCase(),
      displayLabel: null,
      simulated: false,
      verifiedAt: now.toISOString(),
      revokedAt: null,
      createdAt: now.toISOString()
    };
    return this.repository.consumeChallengeAndLink(
      challenge.id,
      now.toISOString(),
      link,
      this.audit(userId, link.id, "identity-linked", "siwe", now)
    );
  }

  async linkSimulation(userIdValue: string, label = "Test wallet"): Promise<IdentityLink> {
    if (!this.simulationEnabled) {
      throw new IdentityNotFoundError("Simulation identity provider is disabled");
    }
    const userId = cleanId(userIdValue, "user id");
    const cleanLabel = label.trim().slice(0, 80) || "Test wallet";
    const now = this.now();
    const link: IdentityLink = {
      id: cleanId(this.createId(), "identity id"),
      userId,
      type: "simulated-wallet",
      provider: "simulation",
      subject: `0x${createHash("sha256")
        .update(`mapos-simulation:${userId}`)
        .digest("hex")
        .slice(0, 40)}`,
      displayLabel: cleanLabel,
      simulated: true,
      verifiedAt: now.toISOString(),
      revokedAt: null,
      createdAt: now.toISOString()
    };
    return this.repository.linkSimulated(
      link,
      this.audit(userId, link.id, "identity-linked", "simulation", now)
    );
  }

  list(userId: string): Promise<IdentityLink[]> {
    return this.repository.listForOwner(cleanId(userId, "user id"));
  }

  async revoke(userIdValue: string, identityId: string): Promise<IdentityLink> {
    const userId = cleanId(userIdValue, "user id");
    const now = this.now();
    const revoked = await this.repository.revokeForOwner(
      userId,
      cleanId(identityId, "identity id"),
      now.toISOString(),
      this.audit(userId, identityId, "identity-revoked", "identity", now)
    );
    if (!revoked) throw new IdentityNotFoundError("Identity not found");
    return revoked;
  }

  private audit(
    userId: string,
    identityId: string | null,
    action: IdentityAuditEvent["action"],
    provider: string,
    now: Date
  ): IdentityAuditEvent {
    return {
      id: cleanId(this.createId(), "audit id"),
      userId,
      identityId,
      action,
      provider,
      createdAt: now.toISOString()
    };
  }
}

/** In-memory contract adapter used by tests and the offline fixture server. */
export class MemoryIdentityRepository implements IdentityRepository {
  readonly challenges = new Map<string, SiweChallenge>();
  readonly identities = new Map<string, IdentityLink>();
  readonly audits: IdentityAuditEvent[] = [];

  async createChallenge(challenge: SiweChallenge, audit: IdentityAuditEvent): Promise<void> {
    if (this.challenges.has(challenge.id)) throw new IdentityConflictError("Duplicate challenge");
    this.challenges.set(challenge.id, clone(challenge));
    this.audits.push(clone(audit));
  }

  async getChallengeForOwner(userId: string, challengeId: string): Promise<SiweChallenge | null> {
    const challenge = this.challenges.get(challengeId);
    return challenge?.userId === userId ? clone(challenge) : null;
  }

  async consumeChallengeAndLink(
    challengeId: string,
    usedAt: string,
    link: IdentityLink,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.usedAt) {
      throw new IdentityVerificationError("SIWE challenge is expired or already used");
    }
    const conflicting = [...this.identities.values()].find(
      (candidate) =>
        candidate.type === link.type &&
        candidate.provider === link.provider &&
        candidate.subject === link.subject
    );
    if (conflicting && conflicting.userId !== link.userId) {
      throw new IdentityConflictError("Identity is linked to another account");
    }
    challenge.usedAt = usedAt;
    const stored = conflicting
      ? { ...conflicting, revokedAt: null, verifiedAt: link.verifiedAt }
      : clone(link);
    this.identities.set(stored.id, stored);
    this.audits.push(clone({ ...audit, identityId: stored.id }));
    return clone(stored);
  }

  async linkSimulated(link: IdentityLink, audit: IdentityAuditEvent): Promise<IdentityLink> {
    if (!link.simulated || link.type !== "simulated-wallet" || link.provider !== "simulation") {
      throw new IdentityVerificationError("Invalid simulation identity");
    }
    const conflicting = [...this.identities.values()].find(
      (candidate) =>
        candidate.type === link.type &&
        candidate.provider === link.provider &&
        candidate.subject === link.subject
    );
    if (conflicting && conflicting.userId !== link.userId) {
      throw new IdentityConflictError("Identity is linked to another account");
    }
    const stored = conflicting
      ? { ...conflicting, revokedAt: null, verifiedAt: link.verifiedAt }
      : clone(link);
    this.identities.set(stored.id, stored);
    this.audits.push(clone({ ...audit, identityId: stored.id }));
    return clone(stored);
  }

  async listForOwner(userId: string): Promise<IdentityLink[]> {
    return [...this.identities.values()]
      .filter((identity) => identity.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((identity) => clone(identity));
  }

  async revokeForOwner(
    userId: string,
    identityId: string,
    revokedAt: string,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink | null> {
    const identity = this.identities.get(identityId);
    if (!identity || identity.userId !== userId) return null;
    if (!identity.revokedAt) {
      identity.revokedAt = revokedAt;
      this.audits.push(clone(audit));
    }
    return clone(identity);
  }
}
