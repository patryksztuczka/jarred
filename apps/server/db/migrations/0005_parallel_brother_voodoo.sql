ALTER TABLE `runs` RENAME COLUMN "safe_error" TO "error";--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `correlation_id`;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `correlation_id`;--> statement-breakpoint
ALTER TABLE `run_loop_events` DROP COLUMN `iteration`;--> statement-breakpoint
ALTER TABLE `run_loop_events` DROP COLUMN `decision`;--> statement-breakpoint
ALTER TABLE `run_loop_events` DROP COLUMN `reason`;