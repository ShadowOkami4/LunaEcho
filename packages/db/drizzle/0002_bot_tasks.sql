CREATE TABLE "bot_tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"guild_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "bot_tasks_open_idx" ON "bot_tasks" USING btree ("completed_at","id");