CREATE TABLE `run_loop_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`iteration` integer,
	`event_type` text NOT NULL,
	`decision` text,
	`reason` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
