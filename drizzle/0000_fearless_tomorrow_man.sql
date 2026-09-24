CREATE TABLE `daily_futures_positions` (
	`date` text PRIMARY KEY NOT NULL,
	`tx_net_open_interest` integer NOT NULL,
	`mtx_net_open_interest` integer NOT NULL,
	`tmf_net_open_interest` integer NOT NULL,
	`night_equivalent_net` integer NOT NULL,
	`collected_at` text NOT NULL,
	`updated_at` text NOT NULL
);
