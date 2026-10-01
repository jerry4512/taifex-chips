CREATE TABLE "twse_institutional_flows" (
	"date" text NOT NULL,
	"item" text NOT NULL,
	"buy" bigint NOT NULL,
	"sell" bigint NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "twse_institutional_flows_date_item_pk" PRIMARY KEY("date","item")
);
