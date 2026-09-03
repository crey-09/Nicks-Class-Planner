CREATE TABLE `google_events` (
	`key` text PRIMARY KEY NOT NULL,
	`google_event_id` text NOT NULL,
	`hash` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
