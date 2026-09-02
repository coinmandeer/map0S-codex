# Security and privacy release checklist

Status date: 2026-09-01. This checklist covers enabled MapOS core paths. Disabled external
integrations remain source/capability gates and are not silently counted as production-ready.

## Production controls

- Credentialed CORS uses an exact origin allowlist. Wildcards, opaque origins and URL paths are
  rejected. Same-origin requests need no CORS entry. The only explicitly exposed diagnostic
  response header is the server-generated `X-Request-ID`.
- Every browser mutation with an `Origin` header must match the effective public origin or the
  explicit allowlist. Session cookies are HTTP-only, secure in production and SameSite=Lax.
- Reverse-proxy trust is address/CIDR based. Wildcard and numeric-hop trust are rejected.
- Production uses PostgreSQL-backed request windows shared by all API instances. Bucket keys are
  HMACs under `MAPOS_RATE_LIMIT_SECRET`; raw client IP addresses are not stored.
- Auth, import, commerce, AI, game, general mutation, read and operations traffic have separate
  finite budgets. More restrictive route-specific limits may apply as a second boundary.
- Declarative partner connectors accept HTTPS and a server-side host allowlist only, block local,
  private, link-local and metadata targets, re-check redirects, cap timeout/pagination/body size,
  validate content type and contract output, and never execute extension JavaScript in the main
  origin. Trusted code connectors remain code-reviewed server modules.
- Embed probes use a fixed allowlist, HTTPS-only URLs, metadata-only bounded reads and manual
  redirect validation; every destination is independently DNS-checked and TLS-pinned. The shared
  provider client rejects any private or reserved member of a DNS answer, refuses automatic
  redirects, and bounds timeout/body/content type for JSON, text and tile responses. The exact-host
  declarative connector uses the same DNS/TLS rules and feeds the common circuit and telemetry.
  Requests are coalesced where response reuse is safe and retries/circuit breakers remain finite.
  Offline fixture mode is rechecked inside both server transports before DNS, so it cannot be
  bypassed by the native HTTPS implementation used for address pinning.
- Every production route receives bounded params/query schemas and every mutation a bounded body
  schema/body parser limit. Plan v2, SIWE/identity, Mapy and weather routes have exact domain
  schemas; a CI inventory prevents a new public route from appearing without a finite contract.
- SIWE binds exact domain, URI, address, chain, session, nonce and expiry. The nonce is single-use,
  the EOA signature is verified locally over the exact message and the session rotates on success.
- Commerce data is server-authoritative. Client flags do not grant entitlements; payment events
  are idempotent and real checkout remains disabled until a provider/use-case/compliance decision.
- Default logs contain server-generated request ID, method, route template, status and duration.
  They exclude query strings, raw errors, authorization/cookies, coordinates, prompts, notes,
  e-mail, wallet signatures and session identifiers. A static production-source test rejects raw
  `Error` variables passed to console or structured server loggers.
- Direct-browser provider health remains a bounded in-memory aggregate of code-owned provider ID,
  outcome, count, duration and timestamp. It accepts no URL, source ID, coordinates, filters or
  error text and is not exported without a future consent and retention policy. RainViewer and
  Base RPC calls use a bounded local failure circuit; radar metadata failures also receive a short
  negative TTL so repeated map refreshes cannot create a request storm.
- Secrets remain server-side environment values and are excluded from release archives. The
  deployment generates missing rate-limit/operations secrets directly on the VPS without sending
  them over the release upload.

## Threats and disposition

| Threat                       | Enabled control                                                            | Remaining gate                                                   |
| ---------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Malicious layer/SSRF         | schema + contract runner, declarative connector sandbox, server allowlist  | each new partner host/credential requires review                 |
| External-content XSS         | React text rendering, manifest field allowlist, safe HTTP(S) deep links    | HTML/plugin execution remains unsupported                        |
| Wallet replay/phishing       | EIP-4361 origin/session/nonce binding and rotation                         | EIP-1271 needs a bounded RPC policy                              |
| Private/paid data leak       | owner repositories, entitlement partition and server checks                | every new cache must include permission partition                |
| Precise-location/prompt leak | no raw request URL/error/prompt telemetry; AI data classes fail closed     | retention/consent required before opt-in history/analytics       |
| Provider outage/storm        | timeout, coalescing, bounded retry, circuit breaker, degraded source state | shared provider cache may be added after measurement             |
| Payment callback fraud       | provider-neutral signature boundary, idempotency ledger                    | real provider/compliance contract is not yet selected            |
| Malicious upload             | unsafe URLs and unmoderated assets cannot render                           | upload scan, MIME sniffing, EXIF/transcode and moderation worker |
| Supply chain                 | locked npm tree, CI install/build/test, minimal release archive            | periodic dependency/SBOM review remains operational work         |

No open P0 is known in the enabled core surface at this date. Media upload, EIP-1271, live wallet
inventory, real payments and arbitrary partner publication remain disabled gates, not accepted
risk hidden behind a UI flag.
