import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  paymentPercentBps: integer("payment_percent_bps").notNull().default(100),
  paymentFixedCents: integer("payment_fixed_cents").notNull().default(0),
  withdrawalPercentBps: integer("withdrawal_percent_bps").notNull().default(50),
  withdrawalFixedCents: integer("withdrawal_fixed_cents").notNull().default(25),
  stripeTestAccountId: text("stripe_test_account_id"),
  stripeLiveAccountId: text("stripe_live_account_id"),
  createdAt: text("created_at").notNull(),
  accountDisplayName: text("account_display_name"),
  contactEmail: text("contact_email"),
  businessType: text("business_type", { enum: ["individual", "company"] }),
  country: text("country"),
  onboardingCompletedAt: text("onboarding_completed_at"),
  updatedAt: text("updated_at"),
}, (t) => [uniqueIndex("merchants_owner_unique").on(t.ownerUserId)]);

export const paymentLinks = sqliteTable("payment_links", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  token: text("token").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  mode: text("mode").notNull(),
  active: integer("active").notNull().default(1),
  paymentPercentBps: integer("payment_percent_bps").notNull(),
  paymentFixedCents: integer("payment_fixed_cents").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("links_token_unique").on(t.token), index("links_merchant_mode").on(t.merchantId, t.mode)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  linkId: text("link_id").notNull().references(() => paymentLinks.id),
  linkTitle: text("link_title").notNull(),
  mode: text("mode").notNull(),
  engine: text("engine").notNull(),
  status: text("status").notNull().default("created"),
  grossCents: integer("gross_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  netCents: integer("net_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  receiptToken: text("receipt_token").notNull(),
  requestId: text("request_id").notNull(),
  sessionId: text("session_id"),
  checkoutUrl: text("checkout_url"),
  destinationAccountId: text("destination_account_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("orders_receipt_unique").on(t.receiptToken), uniqueIndex("orders_request_unique").on(t.linkId, t.requestId), uniqueIndex("orders_session_unique").on(t.sessionId), index("orders_merchant_mode").on(t.merchantId, t.mode)]);

export const testPayouts = sqliteTable("test_payouts", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  mode: text("mode").notNull().default("test"),
  debitCents: integer("debit_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  bankReceivesCents: integer("bank_receives_cents").notNull(),
  requestId: text("request_id").notNull(),
  status: text("status").notNull().default("simulated"),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("payouts_request_unique").on(t.merchantId, t.mode, t.requestId)]);

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  sessionId: text("session_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("webhooks_event_mode_unique").on(t.eventId, t.mode)]);

export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  emailVerified: integer("email_verified").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("auth_users_email_unique").on(t.email), uniqueIndex("auth_users_owner_unique").on(t.ownerUserId)]);

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => authUsers.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("auth_sessions_user").on(t.userId), index("auth_sessions_expiry").on(t.expiresAt)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (t) => [index("auth_rate_limits_expiry").on(t.expiresAt)]);
