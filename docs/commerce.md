# Commerce and entitlement boundary

## Current capability

This release supplies a complete provider-neutral core: contract-gated catalog metadata, orders,
subscriptions, entitlements, referrals, tips, verified payment events, an immutable entitlement
ledger and reconciliation. It works with `commerceProvider=none`; in that mode catalog and access
checks remain usable while checkout/tip creation returns a closed-provider response and webhook
processing is unavailable.

No live payment provider is selected. The sole adapter is an offline synthetic fixture. It is
triple-gated, requires a 32+ character HMAC secret, has no checkout URL or network call, and the
configuration layer rejects it in production.

`GET /config` advertises:

- `commerceCore: true` — catalog and server-side entitlement decisions exist;
- `commerce` and `commerceCheckout` — true only when the explicit synthetic development gate is
  active.

The selected adapter is intentionally not exposed to the browser. Provider identity is an
internal deployment concern; public capabilities remain boolean feature gates.

## Contract before provider

Every sellable product references a `CommerceUseCaseContractV2`. Approval requires concrete values
for all of the following; a provider credential cannot substitute for them.

| Gate                        | Required evidence                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Data rights                 | display, cache, export, offline, AI-tool and background-sync rights, plus post-termination retention |
| Identity and billing        | authentication method, billing unit and permitted regions/rates                                      |
| Commercial responsibilities | referral and revenue-share terms, support owner and refund owner                                     |
| Publication                 | exact attribution and branding obligations                                                           |
| Lifecycle                   | termination/deletion policy and approved retention behavior                                          |
| Legal/privacy               | accountable legal owner and privacy basis                                                            |
| Real provider               | separate `realProviderApproved=true` after provider terms and the controls below are evidenced       |

Production deliberately has no catalog seed. An approved contract/product/offer must arrive through
a reviewed operational process; this implementation does not turn an unlicensed scrape or a demo
fixture into a product.

## Public API

The same registrar is used by production and memory compositions:

| Route                                                 | Auth              | Meaning                                                                                                                           |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v2/commerce/catalog`                        | optional          | Returns only approved public metadata, price/period and `locked` action; never hidden features, grants or internal contract text. |
| `GET /api/v2/me/entitlements`                         | session           | Returns the server ledger projection and deterministic effective state.                                                           |
| `GET /api/v2/commerce/access/:productType/:productId` | session           | Server-side grant check; no client entitlement input exists.                                                                      |
| `POST /api/v2/commerce/checkout`                      | session           | Creates a pending server order only after provider and use-case gates.                                                            |
| `POST /api/v2/commerce/referrals`                     | session + consent | Stores a bounded one-way session hash separately from feature provenance.                                                         |
| `POST /api/v2/commerce/tips`                          | session           | Provider-gated tip intent; no wallet-login coupling or custody.                                                                   |
| `POST /api/v2/commerce/webhooks/:provider`            | HMAC              | Synthetic-only signed source of truth, bounded to 128 KiB and idempotent by provider/event ID.                                    |

All monetary values are integer minor units with an ISO currency. No card number, provider secret,
wallet private key or seed phrase has a storage field.

## Enforcement and lifecycle

`CommerceService` reads entitlements from its server repository. `loadEntitledResource` and
`loadEntitledSurface` authorize before invoking the feature/detail/export/AI/background/offline
resolver, so denial means premium data is not fetched and cannot be hidden merely with CSS.
Surface decisions combine the entitlement grant with the approved data-rights contract. The AI
projection helper returns only server-verified products whose contract explicitly permits AI use.

Intervals are half-open: an entitlement is valid at `startsAt` and invalid at `endsAt`. Refund is
terminal. A late paid event cannot reopen a refunded order or entitlement. `cancel_at_period_end`
keeps access only until the recorded period end. Reconciliation expires stale active/grace rows and
uses a unique operation key, making repeated runs deterministic.

Provider events are recorded once under `(provider, provider_event_id)`. The durable repository
takes an advisory lock for the affected order/tip, updates order/subscription/entitlement state and
appends the ledger entry in one database transaction. The memory repository provides the same
observable contract without external I/O.

## Gates still closed for live payments

Before adding any real adapter, an owner must supply evidence for legal entity, terms/privacy,
refund and tax responsibility; provider agreement; raw-body signature verification and secret
rotation; distributed fraud/rate limits; customer-support workflow; audit/reconciliation job and
alerts; payload retention/deletion; CSP/payment permissions; provider test-mode E2E; incident kill
switch; and the exact first partner use-case contract. Payout tables/workers are intentionally not
present because MapOS does not hold or disburse funds in this slice.

## Rollback

Set `MAPOS_COMMERCE_ENABLED` empty and `MAPOS_COMMERCE_PROVIDER=none`, then restart. Checkout, tips
and webhook processing fail closed while already issued entitlement/ledger evidence remains intact
for audit and deterministic expiry. Migration `0007_commerce_core` is additive; rollback does not
drop its tables or erase payment history.
