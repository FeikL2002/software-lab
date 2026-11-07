CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`price` text NOT NULL,
	`condition` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`photo_keys` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`stripe_session_id` text,
	`created_at` integer NOT NULL
);
