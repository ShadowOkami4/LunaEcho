CREATE TABLE "welcome_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"welcome_channel_id" text,
	"welcome_message" text,
	"goodbye_channel_id" text,
	"goodbye_message" text,
	"direct_message" text,
	"autorole_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"verification_channel_id" text,
	"verification_role_id" text,
	"verification_text" text,
	"verification_message_id" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
