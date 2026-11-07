-- Harbor's original D1 schema, adapted to PostgreSQL. This migration creates
-- storage only; account data and credentials are never embedded in source.
CREATE TABLE merchants (
  id text PRIMARY KEY NOT NULL,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  payment_percent_bps integer DEFAULT 100 NOT NULL,
  payment_fixed_cents bigint DEFAULT 0 NOT NULL,
  withdrawal_percent_bps integer DEFAULT 50 NOT NULL,
  withdrawal_fixed_cents bigint DEFAULT 25 NOT NULL,
  stripe_test_account_id text,
  stripe_live_account_id text,
  created_at text NOT NULL,
  account_display_name text,
  contact_email text,
  business_type text,
  country text,
  onboarding_completed_at text,
  updated_at text
);
CREATE UNIQUE INDEX merchants_owner_unique ON merchants(owner_user_id);

CREATE TABLE payment_links (
  id text PRIMARY KEY NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  token text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  amount_cents bigint NOT NULL,
  currency text DEFAULT 'usd' NOT NULL,
  mode text NOT NULL,
  active integer DEFAULT 1 NOT NULL,
  payment_percent_bps integer NOT NULL,
  payment_fixed_cents bigint NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX links_token_unique ON payment_links(token);
CREATE INDEX links_merchant_mode ON payment_links(merchant_id,mode);

CREATE TABLE orders (
  id text PRIMARY KEY NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  link_id text NOT NULL REFERENCES payment_links(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  link_title text NOT NULL,
  mode text NOT NULL,
  engine text NOT NULL,
  status text DEFAULT 'created' NOT NULL,
  gross_cents bigint NOT NULL,
  platform_fee_cents bigint NOT NULL,
  net_cents bigint NOT NULL,
  currency text DEFAULT 'usd' NOT NULL,
  receipt_token text NOT NULL,
  request_id text NOT NULL,
  session_id text,
  checkout_url text,
  destination_account_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX orders_receipt_unique ON orders(receipt_token);
CREATE UNIQUE INDEX orders_request_unique ON orders(link_id,request_id);
CREATE UNIQUE INDEX orders_session_unique ON orders(session_id);
CREATE INDEX orders_merchant_mode ON orders(merchant_id,mode);

CREATE TABLE test_payouts (
  id text PRIMARY KEY NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  mode text DEFAULT 'test' NOT NULL,
  debit_cents bigint NOT NULL,
  platform_fee_cents bigint NOT NULL,
  bank_receives_cents bigint NOT NULL,
  request_id text NOT NULL,
  status text DEFAULT 'simulated' NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX payouts_request_unique ON test_payouts(merchant_id,mode,request_id);

CREATE TABLE webhook_events (
  id text PRIMARY KEY NOT NULL,
  mode text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  session_id text NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX webhooks_event_mode_unique ON webhook_events(event_id,mode);

CREATE TABLE auth_users (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  owner_user_id text NOT NULL,
  email_verified integer DEFAULT 0 NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX auth_users_email_unique ON auth_users(email);
CREATE UNIQUE INDEX auth_users_owner_unique ON auth_users(owner_user_id);

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES auth_users(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY NOT NULL,
  attempts integer NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);
