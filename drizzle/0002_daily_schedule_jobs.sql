CREATE TABLE `daily_schedule_jobs` (
	`date` text NOT NULL,
	`job` text NOT NULL,
	`completed_at` text NOT NULL,
	PRIMARY KEY(`date`, `job`)
);
