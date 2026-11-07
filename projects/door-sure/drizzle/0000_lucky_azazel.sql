CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`state` text DEFAULT 'OH' NOT NULL,
	`zip` text NOT NULL,
	`role` text NOT NULL,
	`property_type` text NOT NULL,
	`beds` integer NOT NULL,
	`baths` integer NOT NULL,
	`monthly_rent` integer NOT NULL,
	`verification_method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
