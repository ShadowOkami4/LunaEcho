CREATE TABLE "social_feeds" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"platform" text NOT NULL,
	"source_id" text NOT NULL,
	"display_name" text NOT NULL,
	"channel_id" text NOT NULL,
	"ping_role_id" text,
	"message" text,
	"last_item_id" text,
	"next_check_at" timestamp with time zone NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_feeds_source_idx" ON "social_feeds" USING btree ("guild_id","platform","source_id");--> statement-breakpoint
CREATE INDEX "social_feeds_next_check_idx" ON "social_feeds" USING btree ("next_check_at");