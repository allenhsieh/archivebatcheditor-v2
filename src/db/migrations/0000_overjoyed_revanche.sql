CREATE TABLE `activity_log_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_run_id` text NOT NULL,
	`identifier` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`operation_run_id`) REFERENCES `operation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ale_operation_run_id_idx` ON `activity_log_entries` (`operation_run_id`);--> statement-breakpoint
CREATE INDEX `ale_identifier_idx` ON `activity_log_entries` (`identifier`);--> statement-breakpoint
CREATE INDEX `ale_status_idx` ON `activity_log_entries` (`status`);--> statement-breakpoint
CREATE TABLE `operation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`total_items` integer NOT NULL,
	`successful_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`parameters` text
);
--> statement-breakpoint
CREATE TABLE `youtube_channel_cache_meta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `youtube_channel_cache_videos` (
	`video_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`published_at` integer NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `youtube_oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token` text,
	`access_token_expires_at` integer,
	`scope` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `youtube_retry_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`archive_identifier` text NOT NULL,
	`youtube_video_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`next_attempt_at` integer
);
