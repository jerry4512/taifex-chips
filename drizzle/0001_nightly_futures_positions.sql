CREATE TABLE `nightly_futures_positions` (
	`date` text PRIMARY KEY NOT NULL,
	`tx_night_net` integer NOT NULL,
	`mtx_night_net` integer NOT NULL,
	`tmf_night_net` integer NOT NULL,
	`collected_at` text NOT NULL,
	`updated_at` text NOT NULL
);
