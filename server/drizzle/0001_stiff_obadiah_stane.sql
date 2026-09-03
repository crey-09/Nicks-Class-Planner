CREATE TABLE `source_courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`external_key` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`url` text,
	`course_id` integer,
	`ignored` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_courses_key_idx` ON `source_courses` (`source_id`,`external_key`);