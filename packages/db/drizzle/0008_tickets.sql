CREATE TABLE "ticket_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"panel_channel_id" text,
	"panel_message_id" text,
	"panel_title" text,
	"panel_text" text,
	"staff_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"transcript_channel_id" text,
	"maximum_open_per_member" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"number" integer NOT NULL,
	"thread_id" text,
	"opener_id" text NOT NULL,
	"topic" text NOT NULL,
	"status" text NOT NULL,
	"claimed_by" text,
	"closed_by" text,
	"close_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_guild_number_idx" ON "tickets" USING btree ("guild_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_thread_idx" ON "tickets" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "tickets_opener_idx" ON "tickets" USING btree ("guild_id","opener_id","status");