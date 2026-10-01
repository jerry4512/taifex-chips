CREATE TABLE "daily_futures_positions" (
	"date" text PRIMARY KEY NOT NULL,
	"tx_net_open_interest" integer NOT NULL,
	"mtx_net_open_interest" integer NOT NULL,
	"tmf_net_open_interest" integer NOT NULL,
	"night_equivalent_net" integer NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_schedule_jobs" (
	"date" text NOT NULL,
	"job" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_schedule_jobs_date_job_pk" PRIMARY KEY("date","job")
);
--> statement-breakpoint
CREATE TABLE "nightly_futures_positions" (
	"date" text PRIMARY KEY NOT NULL,
	"tx_night_net" integer NOT NULL,
	"mtx_night_net" integer NOT NULL,
	"tmf_night_net" integer NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
