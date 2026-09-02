import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IdentityConflictError,
  IdentityNotFoundError,
  IdentityVerificationError,
  LinkedIdentityService,
  MemoryIdentityRepository,
  type SiweSignatureVerifier
} from "./identityService.js";

const address = "0x1234567890abcdef1234567890abcdef12345678";
const signature = `0x${"ab".repeat(65)}`;

function fixture(options: { simulationEnabled?: boolean } = {}) {
  let now = new Date("2026-09-01T10:00:00.000Z");
  let sequence = 0;
  const verified: unknown[] = [];
  const verifier: SiweSignatureVerifier = {
    id: "fixture-eoa",
    async verify(input) {
      verified.push(structuredClone(input));
      return input.signature === signature;
    }
  };
  const repository = new MemoryIdentityRepository();
  const service = new LinkedIdentityService(repository, verifier, {
    domain: "mapos.example",
    uri: "https://mapos.example/api/v2/auth/siwe/verify",
    allowedChainIds: new Set([1, 8453]),
    siweEnabled: true,
    simulationEnabled: options.simulationEnabled,
    now: () => now,
    createId: () => `identity-fixture-${++sequence}`,
    createNonce: () => "A1B2C3D4E5F6G7H8"
  });
  return {
    service,
    repository,
    verified,
    setNow(value: string) {
      now = new Date(value);
    }
  };
}

describe("guest-first linked identity and SIWE", () => {
  it("builds a bounded, origin-bound EIP-4361 challenge", async () => {
    const { service, repository } = fixture();
    const challenge = await service.createChallenge({
      userId: "user-1",
      sessionId: "session-1",
      address,
      chainId: 8453
    });

    assert.match(
      challenge.message,
      /^mapos\.example wants you to sign in with your Ethereum account:/
    );
    assert.match(challenge.message, /URI: https:\/\/mapos\.example\/api\/v2\/auth\/siwe\/verify/);
    assert.match(challenge.message, /Chain ID: 8453/);
    assert.match(challenge.message, /Nonce: A1B2C3D4E5F6G7H8/);
    assert.match(challenge.message, /Expiration Time: 2026-09-01T10:05:00\.000Z/);
    assert.equal(repository.audits[0]?.action, "challenge-created");
  });

  it("links to the existing user, consumes the nonce once and records metadata-only audit", async () => {
    const { service, repository, verified } = fixture();
    const challenge = await service.createChallenge({
      userId: "guest-user",
      sessionId: "guest-session",
      address,
      chainId: 8453
    });
    const link = await service.verifyAndLink({
      userId: "guest-user",
      sessionId: "guest-session",
      challengeId: challenge.id,
      message: challenge.message,
      signature
    });

    assert.equal(link.userId, "guest-user");
    assert.equal(link.subject, address.toLowerCase());
    assert.equal(link.simulated, false);
    assert.equal(verified.length, 1);
    assert.equal(repository.audits.at(-1)?.action, "identity-linked");
    assert.doesNotMatch(JSON.stringify(repository.audits), /A1B2C3|abababab/);
    await assert.rejects(
      service.verifyAndLink({
        userId: "guest-user",
        sessionId: "guest-session",
        challengeId: challenge.id,
        message: challenge.message,
        signature
      }),
      IdentityVerificationError
    );
  });

  it("rejects message changes, wrong sessions, expiry and unsupported chains", async () => {
    const { service, verified, setNow } = fixture();
    await assert.rejects(
      service.createChallenge({
        userId: "user-1",
        sessionId: "session-1",
        address,
        chainId: 137
      }),
      IdentityVerificationError
    );
    const challenge = await service.createChallenge({
      userId: "user-1",
      sessionId: "session-1",
      address,
      chainId: 8453
    });
    await assert.rejects(
      service.verifyAndLink({
        userId: "user-1",
        sessionId: "other-session",
        challengeId: challenge.id,
        message: challenge.message,
        signature
      }),
      IdentityNotFoundError
    );
    await assert.rejects(
      service.verifyAndLink({
        userId: "user-1",
        sessionId: "session-1",
        challengeId: challenge.id,
        message: `${challenge.message}\nResources:\n- https://attacker.example`,
        signature
      }),
      IdentityVerificationError
    );
    assert.equal(verified.length, 0);
    setNow("2026-09-01T10:05:00.000Z");
    await assert.rejects(
      service.verifyAndLink({
        userId: "user-1",
        sessionId: "session-1",
        challengeId: challenge.id,
        message: challenge.message,
        signature
      }),
      IdentityVerificationError
    );
  });

  it("keeps globally unique wallet ownership and owner-scoped identity management", async () => {
    const { service } = fixture();
    const first = await service.createChallenge({
      userId: "user-1",
      sessionId: "session-1",
      address,
      chainId: 1
    });
    const linked = await service.verifyAndLink({
      userId: "user-1",
      sessionId: "session-1",
      challengeId: first.id,
      message: first.message,
      signature
    });
    const second = await service.createChallenge({
      userId: "user-2",
      sessionId: "session-2",
      address,
      chainId: 1
    });
    await assert.rejects(
      service.verifyAndLink({
        userId: "user-2",
        sessionId: "session-2",
        challengeId: second.id,
        message: second.message,
        signature
      }),
      IdentityConflictError
    );
    assert.equal((await service.list("user-1"))[0]?.id, linked.id);
    assert.deepEqual(await service.list("user-2"), []);
    await assert.rejects(service.revoke("user-2", linked.id), IdentityNotFoundError);
    assert.ok((await service.revoke("user-1", linked.id)).revokedAt);
  });

  it("exposes simulation only when explicitly enabled and labels it throughout", async () => {
    const disabled = fixture();
    await assert.rejects(disabled.service.linkSimulation("user-1"), IdentityNotFoundError);

    const enabled = fixture({ simulationEnabled: true });
    const link = await enabled.service.linkSimulation("user-1", "Vývojová peněženka");
    assert.equal(link.type, "simulated-wallet");
    assert.equal(link.simulated, true);
    assert.equal(link.provider, "simulation");
    assert.equal(link.displayLabel, "Vývojová peněženka");
  });

  it("refuses a challenge origin whose domain and URI do not match", () => {
    assert.throws(
      () =>
        new LinkedIdentityService(
          new MemoryIdentityRepository(),
          { id: "noop", verify: async () => true },
          {
            domain: "mapos.example",
            uri: "https://evil.example/verify",
            allowedChainIds: new Set([1])
          }
        ),
      /domain and URI origin/
    );
  });
});
