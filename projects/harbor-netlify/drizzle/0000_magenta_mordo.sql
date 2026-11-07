CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`payment_percent_bps` integer DEFAULT 100 NOT NULL,
	`payment_fixed_cents` integer DEFAULT 0 NOT NULL,
	`withdrawal_percent_bps` integer DEFAULT 50 NOT NULL,
	`withdrawal_fixed_cents` integer DEFAULT 25 NOT NULL,
	`stripe_test_account_id` text,
	`stripe_live_account_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_owner_unique` ON `merchants` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`link_id` text NOT NULL,
	`link_title` text NOT NULL,
	`mode` text NOT NULL,
	`engine` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`gross_cents` integer NOT NULL,
	`platform_fee_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`receipt_token` text NOT NULL,
	`request_id` text NOT NULL,
	`session_id` text,
	`checkout_url` text,
	`destination_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`link_id`) REFERENCES `payment_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_receipt_unique` ON `orders` (`receipt_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_request_unique` ON `orders` (`link_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_session_unique` ON `orders` (`session_id`);--> statement-breakpoint
CREATE INDEX `orders_merchant_mode` ON `orders` (`merchant_id`,`mode`);--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`mode` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`payment_percent_bps` integer NOT NULL,
	`payment_fixed_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_token_unique` ON `payment_links` (`token`);--> statement-breakpoint
CREATE INDEX `links_merchant_mode` ON `payment_links` (`merchant_id`,`mode`);--> statement-breakpoint
CREATE TABLE `test_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`mode` text DEFAULT 'test' NOT NULL,
	`debit_cents` integer NOT NULL,
	`platform_fee_cents` integer NOT NULL,
	`bank_receives_cents` integer NOT NULL,
	`request_id` text NOT NULL,
	`status` text DEFAULT 'simulated' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_request_unique` ON `test_payouts` (`merchant_id`,`mode`,`request_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_event_mode_unique` ON `webhook_events` (`event_id`,`mode`);