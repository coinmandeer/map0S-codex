import { defineMigration } from "./migration.js";

/** Provider-neutral commerce ledger. No table stores card or wallet private-key material. */
export const commerceMigration = defineMigration({
  version: "0007",
  name: "commerce_core",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_use_cases (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 120),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'approved', 'disabled')),
        product_type TEXT NOT NULL CHECK (
          product_type IN ('layer', 'layer-bundle', 'subscription', 'content', 'feature', 'world')
        ),
        product_id TEXT NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 200),
        provider_id TEXT,
        contract JSONB NOT NULL CHECK (
          jsonb_typeof(contract) = 'object' AND octet_length(contract::text) <= 65536
        ),
        real_provider_approved BOOLEAN NOT NULL DEFAULT FALSE,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (product_type, product_id)
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_products (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        use_case_id TEXT NOT NULL REFERENCES commerce_use_cases(id) ON DELETE RESTRICT,
        type TEXT NOT NULL CHECK (
          type IN ('layer', 'layer-bundle', 'subscription', 'content', 'feature', 'world')
        ),
        provider_id TEXT,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
        description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
        public_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
          jsonb_typeof(public_metadata) = 'object'
          AND octet_length(public_metadata::text) <= 32768
        ),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_offers (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        product_id TEXT NOT NULL REFERENCES commerce_products(id) ON DELETE RESTRICT,
        billing_unit TEXT NOT NULL
          CHECK (billing_unit IN ('one-time', 'month', 'year', 'usage', 'tip')),
        amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        grants JSONB NOT NULL CHECK (
          jsonb_typeof(grants) = 'array'
          AND jsonb_array_length(grants) BETWEEN 1 AND 16
          AND octet_length(grants::text) <= 2048
        ),
        period_count INTEGER NOT NULL DEFAULT 1 CHECK (period_count BETWEEN 1 AND 120),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
        provider_price_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_offers_product_idx ON commerce_offers (product_id, status)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_orders (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        offer_id TEXT NOT NULL REFERENCES commerce_offers(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'failed')),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'synthetic', 'stripe', 'crypto', 'external')),
        provider_order_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
        amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        referral_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_orders_user_idx ON commerce_orders (user_id, created_at, id)`
    },
    {
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_provider_order_unique
        ON commerce_orders (provider, provider_order_id) WHERE provider_order_id IS NOT NULL`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_subscriptions (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        offer_id TEXT NOT NULL REFERENCES commerce_offers(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (
          status IN ('trial', 'pending', 'active', 'past_due', 'cancel_at_period_end', 'cancelled', 'expired', 'refunded')
        ),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'synthetic', 'stripe', 'crypto', 'external')),
        provider_subscription_id TEXT,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        grace_ends_at TIMESTAMPTZ,
        cancel_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_subscriptions_user_idx ON commerce_subscriptions (user_id, status)`
    },
    {
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS commerce_subscriptions_provider_unique
        ON commerce_subscriptions (provider, provider_subscription_id)
        WHERE provider_subscription_id IS NOT NULL`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_entitlements (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 240),
        user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'wallet', 'session', 'organization')),
        subject_id TEXT NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 320),
        product_type TEXT NOT NULL CHECK (
          product_type IN ('layer', 'layer-bundle', 'subscription', 'content', 'feature', 'world')
        ),
        product_id TEXT NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 200),
        product_provider_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'grace', 'expired', 'revoked', 'refunded')),
        grants JSONB NOT NULL CHECK (
          jsonb_typeof(grants) = 'array'
          AND jsonb_array_length(grants) BETWEEN 1 AND 16
          AND octet_length(grants::text) <= 2048
        ),
        source_provider TEXT CHECK (
          source_provider IS NULL OR source_provider IN ('mapos', 'stripe', 'crypto', 'external', 'admin', 'promotion')
        ),
        external_customer_id TEXT,
        external_transaction_id TEXT,
        referral_id TEXT,
        order_id TEXT REFERENCES commerce_orders(id) ON DELETE RESTRICT,
        subscription_id TEXT REFERENCES commerce_subscriptions(id) ON DELETE RESTRICT,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
          jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 32768
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
        CHECK ((subject_type = 'user' AND user_id IS NOT NULL AND subject_id = user_id::text)
          OR (subject_type <> 'user' AND user_id IS NULL))
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_entitlements_access_idx
        ON commerce_entitlements (subject_type, subject_id, product_type, product_id, status, ends_at)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_entitlements_order_idx ON commerce_entitlements (order_id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_referrals (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        campaign TEXT NOT NULL CHECK (char_length(campaign) BETWEEN 1 AND 120),
        partner_id TEXT NOT NULL CHECK (char_length(partner_id) BETWEEN 1 AND 160),
        source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 160),
        session_hash TEXT NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
        dedupe_key TEXT NOT NULL UNIQUE CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
        clicked_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consented_at TIMESTAMPTZ,
        privacy_basis TEXT NOT NULL CHECK (char_length(privacy_basis) BETWEEN 1 AND 200),
        converted_order_id TEXT REFERENCES commerce_orders(id) ON DELETE SET NULL,
        converted_at TIMESTAMPTZ,
        payout_status TEXT NOT NULL DEFAULT 'not-applicable'
          CHECK (payout_status IN ('not-applicable', 'pending', 'eligible', 'paid', 'void')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
          jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (expires_at > clicked_at),
        CHECK ((converted_order_id IS NULL) = (converted_at IS NULL))
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_referrals_expiry_idx ON commerce_referrals (expires_at, payout_status)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_tips (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        recipient_type TEXT NOT NULL
          CHECK (recipient_type IN ('layer-publisher', 'poi-contributor', 'project', 'community-organization')),
        recipient_id TEXT NOT NULL CHECK (char_length(recipient_id) BETWEEN 1 AND 200),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'synthetic', 'stripe', 'crypto', 'external')),
        network TEXT,
        amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
        fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0 AND fee_minor <= amount_minor),
        currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
        provider_transaction_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_payment_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider TEXT NOT NULL CHECK (provider IN ('synthetic', 'stripe', 'crypto', 'external')),
        provider_event_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 120),
        payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        payload JSONB NOT NULL CHECK (
          jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072
        ),
        signature_verified BOOLEAN NOT NULL CHECK (signature_verified),
        occurred_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,
        outcome TEXT NOT NULL DEFAULT 'received'
          CHECK (outcome IN ('received', 'applied', 'ignored', 'failed')),
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_event_id)
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_ledger_entries (
        id TEXT PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 240),
        operation_key TEXT NOT NULL UNIQUE CHECK (char_length(operation_key) BETWEEN 8 AND 320),
        payment_event_id UUID REFERENCES commerce_payment_events(id) ON DELETE RESTRICT,
        order_id TEXT REFERENCES commerce_orders(id) ON DELETE RESTRICT,
        subscription_id TEXT REFERENCES commerce_subscriptions(id) ON DELETE RESTRICT,
        entitlement_id TEXT REFERENCES commerce_entitlements(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('payment', 'grant', 'revoke', 'refund', 'cancel', 'expire', 'reconcile', 'tip')),
        effective_at TIMESTAMPTZ NOT NULL,
        reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 240),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(metadata::text) <= 16384),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS commerce_ledger_entitlement_idx ON commerce_ledger_entries (entitlement_id, effective_at, id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS commerce_reconciliation_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'synthetic', 'stripe', 'crypto', 'external')),
        status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
        checked_count INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
        repaired_count INTEGER NOT NULL DEFAULT 0 CHECK (repaired_count >= 0),
        discrepancies JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
          jsonb_typeof(discrepancies) = 'array' AND octet_length(discrepancies::text) <= 65536
        ),
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    }
  ]
});
