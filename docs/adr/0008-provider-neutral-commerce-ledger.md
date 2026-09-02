# ADR 0008: Provider-neutral commerce and server-owned entitlement ledger

- Status: accepted for synthetic/core slice; live-provider gate closed
- Date: 2026-09-01

## Context

MapOS needs one-time, subscription, referral and tip use cases without coupling layer data rights
to Stripe, crypto, wallet login or any other payment transport. A return URL or browser flag cannot
prove payment, and a paid catalog must never fetch premium features for an unauthorized actor.

## Decision

Define the use-case/data-rights contract before the provider. Keep product/offer, order,
subscription, entitlement, referral, tip, verified payment event, ledger and reconciliation as
separate aggregates. Only a signed, idempotently stored provider event may mutate payment-derived
entitlements. Enforce entitlements in server resolvers before data access; use the same verified
projection for AI. Keep the production provider at `none` until a specific provider and partner
contract pass the documented legal/security gates.

The development-only synthetic adapter uses HMAC, no network and no money. It is explicitly
labelled and rejected in production. MapOS does not hold funds, so payout execution is out of scope;
referral payout status exists only as reconciliation evidence.

## Consequences

- Duplicate webhooks and reconciliation runs cannot duplicate ledger effects.
- Refund/cancel/expiry decisions are deterministic and preserve audit history.
- Catalog metadata can work without a provider, while checkout fails closed.
- Adding a real provider requires a new adapter plus gate evidence, not a rewrite of product or
  entitlement semantics.
- Migration rollback is operational (disable provider) rather than destructive database reversal.
