CREATE TABLE "automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"cooldown_seconds" integer NOT NULL,
	"next_run_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "automation_rules_guild_idx" ON "automation_rules" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "automation_rules_next_run_idx" ON "automation_rules" USING btree ("next_run_at");