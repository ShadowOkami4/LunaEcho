CREATE TABLE "role_menus" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"style" text NOT NULL,
	"mode" text NOT NULL,
	"options" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "role_menus_guild_idx" ON "role_menus" USING btree ("guild_id");