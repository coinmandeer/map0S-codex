# Production / memory API parity

The canonical evidence is [`api-route-parity.json`](./api-route-parity.json). It records every
current method/path difference together with auth intent, schema intent, why the difference is
currently allowed, and how it should converge. `apps/api/src/routeParity.test.ts` statically
follows the route registrars invoked by both composition roots and fails whenever the real sets
drift from that evidence.

This is deliberately static. Importing the production server would require database and provider
state, while parsing registration calls is deterministic, fast and safe in CI. The verifier also
understands Fastify `app.route({ method, url })` declarations and recursively follows imported
`register*` functions, so extracting more shared route modules does not weaken the check.

The inventory records the Fastify-internal path. The web and production proxies expose it beneath
the single `/api` prefix, so an internal `/v2/me` route is publicly addressed as `/api/v2/me`.

## Intentional differences that remain

- Production alone has legacy search/statistics endpoints, historical radar tiles, the legacy
  Wikipedia convenience route, and staking mutations. Memory does not fabricate production
  aggregates, archives, or monetary effects.
- Memory alone keeps a transitional Park4Night E2E alias; the production generic layer endpoint
  already covers that path's intent.
- Shared method/path does not yet mean identical storage or provider behavior. Auth, user content,
  planning, social and game handlers still use process-local repositories in memory. Place detail
  echoes fixture hints, while production resolves ACL-aware sources and enrichment.
- Linked-identity routes are shared. Production persists nonce/link/audit records and keeps SIWE
  plus live inventory behind explicit gates; memory exposes a visibly labeled simulation fixture.
- Commerce routes are shared. Production uses the durable provider-neutral ledger with no live
  provider or seeded offer; memory uses a clearly labelled synthetic catalog, while checkout stays
  disabled unless the explicit non-production HMAC fixture gate is enabled.
- Operational metrics/status routes are shared and indistinguishable from a missing route without a
  server-only token. Their payloads use bounded route templates and provider ids, never raw request
  URLs, coordinates, identities or prompts.
- Normal memory mode retains existing shared upstream behavior for developer convenience. The
  explicit offline profile replaces Mapy, basemap, weather-grid, info and guide provider routes
  with synthetic responses.

These are accepted current-state differences, not permission to add silent drift. A new route must
either be registered on both compositions or receive a complete evidence entry. The planned end
state is a shared `createApp(dependencies)` graph with production and memory adapters; the JSON
contains the migration sequence and exit criterion.

## Offline E2E contract

Run `npm run test:e2e:offline`. This profile:

1. starts the memory API with `MAPOS_FIXTURE_MODE=offline` and refuses to reuse a possibly live
   server;
2. installs a process-wide fetch guard that permits loopback only;
3. registers deterministic replacements for every currently shared provider-backed API route;
4. blocks service workers and every unlisted external browser request;
5. fulfills the expected CARTO style URL from an inline empty-map fixture before any network I/O;
6. runs one smoke spec and asserts the API identifies itself as the offline fixture profile.

If the browser starts requesting a new public asset/provider, the smoke fails with the redacted
origin and path. Add a tiny deterministic recorded/synthetic fixture only when the request is part of the intended
offline product surface; do not broaden the allowlist to a host wildcard.
