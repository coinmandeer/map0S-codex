# Privacy-safe operations and provider health

MapOS emits a server-generated `X-Request-ID` on every API response. Async provider work retains
that correlation ID internally, but metrics aggregate only fixed route templates, status classes
and provider adapter IDs. The request context is entered for the complete Fastify lifecycle (not
only the `onRequest` callback); a concurrent-request regression test verifies that the response
header and the matching asynchronous provider trace stay identical without crossing requests.
Credentialed CORS exposes only that response header (never the operations authorization header),
so an explicitly allowlisted browser origin can show the same support identifier.

Set a random 32+ character `MAPOS_OPERATIONS_TOKEN` to enable:

- `GET /internal/metrics` — OpenMetrics text counters/durations and provider circuit state;
- `GET /internal/status` — the same bounded aggregate plus the last 100 provider correlation
  records, containing request ID, fixed provider ID, outcome, duration and timestamp only.

Both routes return 404 when the token is absent, require `Authorization: Bearer …`, use constant-
time token comparison and `private, no-store`. CORS does not permit the authorization header, so
the endpoint is intended for server-side monitoring. Never place the token in browser code.

The following dimensions are intentionally impossible in the telemetry model: raw URL/query,
bbox/GPS, search text, prompts, private notes, e-mail, wallet, cookie, signature and API key. An
unrecognized route is collapsed to `unmatched`. Provider IDs are code-owned lowercase slugs;
invalid IDs fail fast instead of collapsing into a shared `unknown` circuit that could couple two
unrelated providers.

All enabled server-side network adapters are covered by the same fail-closed security and
telemetry boundary. Standard adapters use the DNS-pinned shared transport. The declarative partner
connector is the sole reviewed custom HTTPS transport because it additionally revalidates an
operator-owned exact-host allowlist across redirects; it feeds the same circuit, correlation and
provider telemetry. A source-level release test rejects a new direct `fetch()`, an unreviewed
`http`/`https` transport or an unreviewed third-party RPC transport. Provider fallback logs reduce
failures to a bounded error class name and never pass raw `Error` objects, messages, causes or
stacks to the logger.

## Initial operational views

- Core: request count and duration by method, route template and status class.
- Provider: success/error/timeout/aborted/circuit-open count, duration and current circuit state.
- Release: health, restart count, migration ledger, backup checksum and restore-drill evidence.
- Product-specific correctness remains in contract metrics/tests: plan revisions, event dedupe,
  entitlement transitions, import rollback and game performance budgets.

The machine-readable [dashboard contract](slo-dashboard.json) maps the provider, map, AI, routing
and 3D diagnostics to their exact latency, error, cache, abort, task-duration and frame fields. Core
and server-side provider aggregates are server-exported. Direct-browser RainViewer metadata,
RainViewer tile errors, Base RPC artwork calls and catalogue basemap loads feed a bounded
`BrowserProviderHealth` aggregate containing only a fixed provider ID, outcome, count, duration
sum/maximum and timestamp. A bounded local circuit stops direct RainViewer and Base RPC calls after
three consecutive errors, admits one probe after a one-minute cooldown, and treats caller aborts
separately. RainViewer metadata failures additionally have a 30-second negative TTL, so repeated
map refreshes do not retry the same failed call. Map/layer work remains in the bounded
`TaskRegistry`. All browser stores are local diagnostics only: they are not uploaded or used as a
fleet-wide client SLO until a future consent and retention policy explicitly permits export. The
contract labels MapOS-owned and external-provider failures separately and its automated test
rejects a missing signal or privacy exclusion.

Client routing creates one cancellable `TaskRecordV2` per plan calculation. Its terminal record
copies only bounded segment counters (`eligibleSegments`, provider calls, cache hits, maximum
concurrency and failed count), status/error code, duration and abort/cache state. The shared client
accepts `X-Request-ID` only when it matches the server's UUIDv4 grammar; a valid value is stored
with the code-owned provider slug in optional `TaskRecordV2.correlation`. The URL, plan identifier,
stops, coordinates and response geometry are never copied into the task. The bounded local
registry keeps at most 100 historical records while preserving active work; it remains in browser
memory and is not sent to the operations endpoints.

SLO targets are not invented before collecting a representative baseline. After a stable window,
set availability/latency objectives separately for MapOS-owned routes and provider-dependent
routes; a provider circuit opening must not be counted as an unexplained core process crash.
Caller cancellation is recorded as `aborted`, does not increment provider failures and cannot open
or reset a provider circuit.
